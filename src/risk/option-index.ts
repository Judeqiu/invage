/** Automatic public-contract scoring. No manual market inputs or account credentials. */
import { yf } from '../market/yf-client.js';
import { validDate } from '../brokers/option-executions.js';
import { equityExpiry, fredRate, RATE_URL } from './market-provider.js';
import { readOptionRiskCostModel } from '../webapp/dashboard-config.js';
import { calculateRisk } from '../../webui/option-risk/model.js';

const DAY = 86400_000;
export interface IndexContract { underlying: string; expiry: string; strike: number; right: 'call' | 'put'; symbol: string }
export interface IndexRequest { contract: string; side?: 'long' | 'short' | 'both' }
export class OptionIndexError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function parseIndexRequest(raw: unknown): IndexRequest & IndexContract {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OptionIndexError(400, 'Provide an exact option contract.');
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).some(k => !['contract', 'side'].includes(k)) || typeof p.contract !== 'string' || p.contract.length > 100 ||
      (p.side !== undefined && !['long', 'short', 'both'].includes(String(p.side))))
    throw new OptionIndexError(400, 'Provide only contract and optional side (long, short or both).');
  const value = p.contract.trim().toUpperCase();
  const occ = /^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/.exec(value.replace(/\s+/g, ''));
  const plain = /^([A-Z]{1,6})\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d{1,3})?)\s+(CALL|PUT|C|P)$/.exec(value);
  const underlying = occ?.[1] ?? plain?.[1];
  const expiry = occ ? `20${occ[2].slice(0, 2)}-${occ[2].slice(2, 4)}-${occ[2].slice(4, 6)}` : plain?.[2];
  const strike = occ ? Number(occ[4]) / 1000 : Number(plain?.[3]);
  const right = (occ?.[3] ?? plain?.[4])?.startsWith('P') ? 'put' : 'call';
  if (!underlying || !expiry || !validDate(expiry) || !(strike > 0 && strike < 100000))
    throw new OptionIndexError(400, 'Use an OCC symbol, or TICKER YYYY-MM-DD STRIKE PUT/CALL. Standard US stock and ETF options only.');
  return { contract: value, side: p.side as IndexRequest['side'] ?? 'both', underlying, expiry, strike, right,
    symbol: `${underlying}${expiry.replaceAll('-', '').slice(2)}${right === 'put' ? 'P' : 'C'}${String(Math.round(strike * 1000)).padStart(8, '0')}` };
}

export interface IndexDependencies {
  options: (symbol: string, expiry: string, signal: AbortSignal) => Promise<any>;
  dividends: (symbol: string, start: Date, end: Date, signal: AbortSignal) => Promise<any>;
  rate: (start: string, signal: AbortSignal) => Promise<string>;
  now: () => number;
}
const provider: IndexDependencies = {
  options: (symbol, date, signal) => yf.options(symbol, { date }, { fetchOptions: { signal } }),
  dividends: (symbol, period1, period2, signal) => yf.chart(symbol, { period1, period2, interval: '1d', events: 'div|split' }, { fetchOptions: { signal } }),
  rate: async (start, signal) => {
    const r = await fetch(`${RATE_URL}?id=DGS1&cosd=${start}`, { signal });
    if (!r.ok) throw new Error('Official rate unavailable');
    const csv = await r.text();
    if (csv.length > 100000) throw new Error('Rate response too large');
    return csv;
  },
  now: Date.now,
};
/** Request-scoped sharing for a report: repeated strikes reuse the exact same feed responses. */
export function createOptionIndexBatchDependencies(source: IndexDependencies = provider): IndexDependencies {
  const chains = new Map<string, Promise<any>>(), dividends = new Map<string, Promise<any>>();
  let rate: Promise<string> | undefined;
  return {
    now: source.now,
    options: (symbol, expiry, signal) => {
      const key = `${symbol}|${expiry}`;
      if (!chains.has(key)) chains.set(key, source.options(symbol, expiry, signal));
      return chains.get(key)!;
    },
    dividends: (symbol, start, end, signal) => {
      if (!dividends.has(symbol)) dividends.set(symbol, source.dividends(symbol, start, end, signal));
      return dividends.get(symbol)!;
    },
    rate: (start, signal) => rate ??= source.rate(start, signal),
  };
}
function timestamp(value: unknown, label: string, now: number): string {
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value)
    : typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : NaN;
  if (!Number.isFinite(time) || time <= 0 || time > now + 60_000) throw new OptionIndexError(422, `${label} timestamp unavailable or invalid.`);
  return new Date(time).toISOString();
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const dateKey = (value: any): string | null => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
};

/** Reported trailing dividends. Ambiguous corporate-action share bases are rejected. */
export function trailingDividendYield(history: any, spot: number, now: number) {
  const dates = (Array.isArray(history?.quotes) ? history.quotes : [])
    .filter((q: any) => finite(q.close) && q.close > 0).map((q: any) => Date.parse(q.date)).filter(Number.isFinite);
  if (history?.meta?.currency !== 'USD' || dates.length < 200 || Math.min(...dates) > now - 360 * DAY || Math.max(...dates) < now - 7 * DAY)
    throw new OptionIndexError(422, 'A complete recent year of dividend/price history is unavailable. Dividend yield cannot be verified.');
  const dividends = history.events?.dividends ?? [], splits = history.events?.splits ?? [];
  if (!Array.isArray(dividends) || !Array.isArray(splits)) throw new OptionIndexError(422, 'Malformed dividend history.');
  let cash = 0;
  for (const d of dividends) {
    if (!finite(d.amount) || d.amount < 0 || !Number.isFinite(Date.parse(d.date))) throw new OptionIndexError(422, 'Invalid dividend record.');
    if (Date.parse(d.date) < now - 365 * DAY || Date.parse(d.date) > now) continue;
    for (const split of splits) {
      if (!finite(split.numerator) || !finite(split.denominator) || split.numerator <= 0 || split.denominator <= 0 || !Number.isFinite(Date.parse(split.date)))
        throw new OptionIndexError(422, 'Invalid stock split record.');
      if (Date.parse(split.date) > Date.parse(d.date) && Date.parse(split.date) <= now)
        throw new OptionIndexError(422, 'A split after a trailing dividend makes its current-share basis uncertain. No dividend yield was invented.');
    }
    cash += d.amount;
  }
  return { yield: cash / spot, reference: `Yahoo reported trailing-year cash dividends: ${cash.toFixed(6)} USD per share / spot; continuous yield proxy, not a forward dividend schedule` };
}

export async function generateOptionIndex(raw: unknown, dependencies: IndexDependencies = provider, signal?: AbortSignal) {
  const contract = parseIndexRequest(raw), now = dependencies.now();
  const days = (Date.parse(equityExpiry(contract.expiry)) - now) / DAY;
  if (days <= 0 || days > 1825) throw new OptionIndexError(400, 'Use an unexpired option with at most five years remaining.');
  const deadline = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  let chain: any, history: any, csv: string;
  try {
    deadline.throwIfAborted();
    [chain, history, csv] = await Promise.all([
      dependencies.options(contract.underlying, contract.expiry, deadline),
      dependencies.dividends(contract.underlying, new Date(now - 373 * DAY), new Date(now), deadline),
      dependencies.rate(new Date(now - 20 * DAY).toISOString().slice(0, 10), deadline),
    ]);
    deadline.throwIfAborted();
  } catch { throw new OptionIndexError(503, 'Market-data lookup unavailable or timed out. No index was calculated; try again later.'); }
  const q = chain?.quote;
  if (chain?.underlyingSymbol !== contract.underlying || q?.symbol !== contract.underlying || q?.currency !== 'USD' ||
      !['EQUITY', 'ETF'].includes(q?.quoteType) || !['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'BZX'].includes(q?.exchange))
    throw new OptionIndexError(422, 'Only verified USD options on US-listed stocks and ETFs are supported.');
  if (history?.meta?.symbol !== contract.underlying) throw new OptionIndexError(422, 'Dividend history does not match the underlying.');
  const series = (Array.isArray(chain.options) ? chain.options : []).filter((s: any) => dateKey(s.expirationDate) === contract.expiry);
  if (series.length !== 1) throw new OptionIndexError(422, 'The exact option expiry could not be verified.');
  const rows = (contract.right === 'put' ? series[0].puts : series[0].calls) ?? [];
  const matches = (Array.isArray(rows) ? rows : []).filter((r: any) => r.contractSymbol === contract.symbol && r.strike === contract.strike &&
    dateKey(r.expiration) === contract.expiry && r.contractSize === 'REGULAR' && (!r.currency || r.currency === 'USD'));
  if (matches.length !== 1) throw new OptionIndexError(422, 'The exact regular option contract could not be verified. Adjusted contracts are unsupported.');
  const row = matches[0], spot = q.regularMarketPrice;
  if (!finite(spot) || spot <= 0 || !finite(row.lastPrice) || row.lastPrice <= 0 || !finite(row.impliedVolatility) || row.impliedVolatility < .01 || row.impliedVolatility > 5)
    throw new OptionIndexError(422, 'Underlying price, option trade price or implied volatility is unavailable. No index was calculated.');
  const optionAsOf = timestamp(row.lastTradeDate, 'Option last trade', now), spotAsOf = timestamp(q.regularMarketTime, 'Underlying quote', now);
  const dividend = trailingDividendYield(history, spot, now);
  let rate;
  try { rate = fredRate(csv, new Date(now).toISOString().slice(0, 10), now); }
  catch { throw new OptionIndexError(422, 'A recent official interest-rate observation is unavailable. No index was calculated.'); }
  const costs = readOptionRiskCostModel();
  const exitCost = Math.max(costs.minimumOrderFee, costs.feePerContract) + row.lastPrice * 100 * costs.slippageBps / 10000;
  const sides: Array<'long' | 'short'> = contract.side === 'both' ? ['long', 'short'] : [contract.side!];
  const scores = sides.map(side => {
    const result = calculateRisk({ right: contract.right, side, style: 'american', spot, strike: contract.strike, premium: row.lastPrice,
      contracts: 1, multiplier: 100, days, horizon: 5, iv: row.impliedVolatility, rate: rate.rate, dividendYield: dividend.yield,
      equity: spot * 100, spotShock: .3, ivShock: .2, exitCost });
    return { side, index: result.index, stressLoss: result.stressLoss, maximumLoss: result.maximumLoss,
      unboundedLoss: result.unlimited, stressLossAsPctPremium: result.stressLoss / (row.lastPrice * 100) * 100,
      modelPrice: result.modelPrice, worst: result.worst, scenarios: result.scenarios,
      grossPutFunding: result.grossPutFunding, callDeliveryShares: result.callDeliveryShares };
  });
  const warnings = ['Indicative score from reported market data, not an executable quote or probability of loss.',
    'Standard US equity/ETF American option approximation; adjusted contracts, discrete dividends, portfolio hedges and broker margin are outside scope.',
    'A finite stress grid cannot bound naked-call losses; a low or zero index does not establish safety.'];
  if (Math.abs(Date.parse(optionAsOf) - Date.parse(spotAsOf)) > 15 * 60000) warnings.push('Option and underlying quote times are not synchronized.');
  if (now - Math.min(Date.parse(optionAsOf), Date.parse(spotAsOf)) > DAY) warnings.push('One or more quotes are over 24 hours old. This is a conditional estimate using dated inputs.');
  if (Math.abs(scores[0].modelPrice - row.lastPrice) / row.lastPrice > .1) warnings.push('Theoretical price differs from the reported option trade by more than 10%; the quote/model mismatch can materially affect the index.');
  return { version: 'automatic-option-stress-v2', generatedAt: new Date(now).toISOString(), contract,
    normalization: { basis: 'underlying-notional', denominator: spot * 100, formula: '100 × worst nonnegative scenario loss / current underlying notional', unit: '% of underlying notional', contracts: 1, multiplier: 100 },
    assumptions: { horizonCalendarDays: Math.min(5, days), spotShocks: [-.3, -.15, 0, .15, .3], ivPointShocks: [-20, 0, 20], ivFloorPct: 1,
      pricing: 'American 200-step Jarrow–Rudd tree, continuous dividend yield', estimatedExitCost: exitCost, costReference: costs.reference },
    market: { spot, premiumPerShare: row.lastPrice, impliedVolatility: row.impliedVolatility, dividendYield: dividend.yield,
      rate: rate.rate, currency: 'USD', optionAsOf, spotAsOf, ivAsOf: null, fetchedAt: new Date(now).toISOString(),
      source: 'Yahoo Finance exact regular contract last trade and regular-session underlying quote', rateReference: rate.reference, dividendReference: dividend.reference,
      bid: finite(row.bid) ? row.bid : null, ask: finite(row.ask) ? row.ask : null },
    scores, expectedShortfall: null, accountEquityImpact: null, warnings,
  };
}
export type OptionIndexResult = Awaited<ReturnType<typeof generateOptionIndex>>;
