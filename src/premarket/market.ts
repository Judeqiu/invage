import type { OptionsResult } from 'yahoo-finance2/modules/options';
import { combinedCredentials, readBrokerAccountModel } from '../brokers/accounts.js';
import { validDate } from '../brokers/option-executions.js';
import { parseBrokerOptionCode } from '../brokers/option-symbol.js';
import { snapshotFromYahooQuote } from '../market/fetch-prices.js';
import { yf } from '../market/yf-client.js';
import { moomooMarketData, type MooMooCredentials } from '../moomoo/moomoo-client.js';
import { parseSignAlg } from '../moomoo/moomoo-sign.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { ListedOption, OptionQuote, StockQuote } from './decisions.js';
import { usSessionDate } from './session.js';

type YahooSeries = OptionsResult['options'][number];
const OCC_STANDARD = 'https://www.theocc.com/clearance-and-settlement/clearing/equity-options-product-specifications';
// Published OCC standard US stock-option terms, applied only to exact regular equity series.
const OCC_STANDARD_SHARES = 100;
const yahooReference = (symbol: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/options/`;
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const ymd = (value: Date) => value.toISOString().slice(0, 10);
function reportedDate(value: unknown) {
  const date = typeof value === 'string' ? value.replaceAll('/', '-') : '';
  return validDate(date) ? date : null;
}
export interface CalendarEvent {
  kind: 'earnings' | 'ex-dividend' | 'split';
  date: string;
  source: string;
  detail: string;
}
export interface UnderlyingEvidence {
  stock: StockQuote | null;
  isUsEquity: boolean;
  earnings: CalendarEvent | null;
}
export interface ChainEvidence {
  options: ListedOption[];
  events: CalendarEvent[];
  notices: string[];
}

export async function readStock(symbol: string): Promise<UnderlyingEvidence> {
  const yahooSymbol = symbol.replaceAll('.', '-');
  const quote = await yf.quote(yahooSymbol);
  if (quote.symbol !== yahooSymbol || quote.currency !== 'USD' || quote.exchangeTimezoneName !== 'America/New_York' ||
      (quote.quoteType !== 'EQUITY' && quote.quoteType !== 'ETF')) return { stock: null, isUsEquity: false, earnings: null };
  let stock: StockQuote | null = null;
  try {
    const snap = snapshotFromYahooQuote(yahooSymbol, quote);
    if (snap.asOf !== null) stock = { price: snap.price, currency: snap.currency, asOf: snap.asOf,
      source: yahooReference(yahooSymbol), field: snap.priceField };
  } catch { /* Terms are independent of a priced quote. */ }
  const earnings = quote.isEarningsDateEstimate === false && quote.earningsTimestamp instanceof Date
    ? { kind: 'earnings' as const, date: usSessionDate(quote.earningsTimestamp), source: yahooReference(yahooSymbol),
      detail: `Provider flags this earnings release as confirmed. Reported time ${quote.earningsTimestamp.toISOString()}.` }
    : null;
  return { stock, isUsEquity: true, earnings };
}

/** Option books from Yahoo have collection time and last trade time, but no book timestamp. */
function yahooOptions(symbol: string, series: YahooSeries, collectedAt: string): ListedOption[] {
  const expiry = ymd(series.expirationDate);
  return (['call', 'put'] as const).flatMap(right => (right === 'put' ? series.puts : series.calls).flatMap(row => {
    if (ymd(row.expiration) !== expiry) return [];
    const code = parseBrokerOptionCode(row.contractSymbol);
    const standard = row.contractSize === 'REGULAR' && row.currency === 'USD' && !('skip' in code) &&
      code.root === symbol.replaceAll('.', '') && code.right === right && code.strike === row.strike && code.expiry === expiry;
    return [{ id: row.contractSymbol, underlying: symbol, right, strike: row.strike, expiry,
      currency: row.currency ?? '', premiumMultiplier: standard ? OCC_STANDARD_SHARES : null,
      shares: standard ? OCC_STANDARD_SHARES : null, exercise: standard ? 'american' as const : null,
      shareOnly: standard, source: standard ? OCC_STANDARD : yahooReference(symbol),
      quote: { source: yahooReference(symbol), collectedAt, bookAsOf: null, lastTradeAt: row.lastTradeDate?.toISOString() ?? null,
        bid: asNumber(row.bid), ask: asNumber(row.ask), bidSize: null, askSize: null, volume: asNumber(row.volume),
        openInterest: asNumber(row.openInterest), ivPercent: typeof row.impliedVolatility === 'number' ? row.impliedVolatility * 100 : null,
        delta: null, gamma: null, theta: null, vega: null, rho: null } }];
  }));
}

function cloudReader(state: InvestorState) {
  const model = readBrokerAccountModel(state);
  for (const connection of Object.values(model.connections)) {
    const broker = connection.broker_id;
    if (!connection.enabled || (broker !== 'moomoo' && broker !== 'futubull')) continue;
    const saved = combinedCredentials(model, connection);
    if (!saved.app_key || !saved.private_key) continue;
    const credentials: MooMooCredentials = { broker, app_key: saved.app_key, private_key: saved.private_key, sign_alg: parseSignAlg(saved.sign_alg) };
    return {
      broker,
      get: (path: string, params?: Record<string, string>) => moomooMarketData({ path, credentials,
        query: params && new URLSearchParams(params).toString() }),
      quotes: (code_list: string[]) => moomooMarketData({ path: '/api/v1.0/quote/stock-quote', credentials, body: { code_list } }),
    };
  }
  return null;
}

async function corporateEvents(cloud: NonNullable<ReturnType<typeof cloudReader>>, path: string, date: string, notices: string[]) {
  const events: CalendarEvent[] = [];
  for (const kind of ['ex-dividend', 'split'] as const) {
    const endpoint = kind === 'ex-dividend' ? 'dividends' : 'splits';
    try {
      const rows = (await cloud.get(`${path}/corporate-actions/${endpoint}`))[kind === 'ex-dividend' ? 'dividend_list' : 'split_list'];
      if (!Array.isArray(rows)) throw new Error('Calendar response missing');
      for (const row of rows) {
        const effective = reportedDate(kind === 'ex-dividend' ? row.ex_date : row.ex_date_str);
        const announced = reportedDate(kind === 'ex-dividend' ? row.pub_date : row.dir_deci_pub_date_str);
        if (!effective || effective < date || !announced || announced > date) continue;
        const detail = kind === 'ex-dividend' ? [row.dividend_per_share, row.currency].filter(x => x != null).join(' ')
          : typeof row.rate === 'string' ? row.rate : '';
        events.push({ kind, date: effective, source: `${cloud.broker} Cloud ${path}/corporate-actions/${endpoint}`,
          detail: [`Announced ${announced}`, detail].filter(Boolean).join(' · ') });
      }
    } catch { notices.push(`Confirmed ${endpoint} unavailable from ${cloud.broker} Cloud.`); }
  }
  return events;
}

function cloudCodeKey(code: string) {
  const parsed = parseBrokerOptionCode(code.replace(/^US\./, ''));
  return 'skip' in parsed ? null : JSON.stringify(parsed);
}

export async function readChain(state: InvestorState, symbol: string, date: string, heldDates: string[],
  stock: UnderlyingEvidence): Promise<ChainEvidence> {
  const notices: string[] = [];
  const events = stock.earnings && stock.earnings.date >= date ? [stock.earnings] : [];
  if (!events.length) notices.push('No confirmed upcoming earnings date was available.');
  notices.push('Issuer and OCC notices may contain additional corporate actions beyond the dividend and split feeds.');
  const yahooSymbol = symbol.replaceAll('.', '-');
  const options = new Map<string, ListedOption>();
  const yahooDates = new Set(heldDates);
  const source = await yf.options(yahooSymbol).catch(() => null);
  if (source?.quote.symbol === yahooSymbol) {
    for (const expiry of source.expirationDates) if (ymd(expiry) >= date) yahooDates.add(ymd(expiry));
  } else notices.push('Yahoo expiration list unavailable or did not match the underlying.');
  for (const expiry of [...yahooDates].sort()) {
    try {
      const raw = source?.options.some(series => ymd(series.expirationDate) === expiry)
        ? source : await yf.options(yahooSymbol, { date: new Date(expiry) });
      const matches = raw.options.filter(series => ymd(series.expirationDate) === expiry);
      if (raw.quote.symbol !== yahooSymbol || matches.length !== 1) throw new Error('Exact expiry missing');
      for (const option of yahooOptions(symbol, matches[0], new Date().toISOString())) options.set(option.id, option);
    } catch { notices.push(`Yahoo chain unavailable for ${expiry}.`); }
  }

  const cloud = cloudReader(state);
  if (!cloud) {
    notices.push('Connected broker option terms, Greeks, quote sizes and announced company-action feeds are unavailable.');
    return { options: [...options.values()], events, notices };
  }
  const owner = `US.${symbol}`, path = `/api/v1.0/quote/${owner}`;
  const actions = corporateEvents(cloud, path, date, notices);
  const expiries = new Set(heldDates);
  try {
    const listing = await cloud.get(`${path}/option-expiration`);
    if (!Array.isArray(listing.expiration_list)) throw new Error('Cloud option expiries unavailable');
    for (const item of listing.expiration_list) if (validDate(item.strike_time) && item.strike_time >= date) expiries.add(item.strike_time);
  } catch { notices.push(`Full ${cloud.broker} Cloud expiration list unavailable.`); }
  const yahooByCode = new Map([...options.values()].map(option => [cloudCodeKey(option.id), option]));
  for (const expiry of [...expiries].sort()) {
    try {
      const data = await cloud.get(`${path}/option-chain`, {start: expiry, end: expiry});
      if (!Array.isArray(data.option_chain)) throw new Error('Cloud chain unavailable');
      const rows = data.option_chain.filter(row => row.stock_owner === owner && row.strike_time === expiry &&
        typeof row.code === 'string' && asNumber(row.strike_price) !== null && (row.option_type === 'PUT' || row.option_type === 'CALL'));
      if (!rows.length || rows.length !== data.option_chain.length) notices.push(`${cloud.broker} Cloud returned incomplete contract rows for ${expiry}.`);
      // Documented 400-code request size. Every returned option is included.
      const quotes = new Map<string, { row: Record<string, any>; collectedAt: string }>();
      for (let cursor = 0; cursor < rows.length; cursor += 400) {
        try {
          const result = await cloud.quotes(rows.slice(cursor, cursor + 400).map(row => row.code));
          if (!Array.isArray(result.quote_list)) throw new Error('Cloud quotes unavailable');
          const collectedAt = new Date().toISOString();
          for (const row of result.quote_list) quotes.set(row.code, { row, collectedAt });
        } catch { notices.push(`Some ${cloud.broker} Cloud quotes are unavailable for ${expiry}.`); }
      }
      for (const row of rows) {
        const code = cloudCodeKey(row.code);
        const yahoo = code ? yahooByCode.get(code) : undefined;
        const live = quotes.get(row.code), extra = live?.row.option_ex_data;
        const confirmed = extra?.strike_price === row.strike_price && extra?.option_type === row.option_type;
        const contractSource = `${cloud.broker} Cloud ${path}/option-chain and /stock-quote`;
        const baseQuote: OptionQuote = yahoo?.quote ?? { source: contractSource, collectedAt: live?.collectedAt ?? new Date().toISOString(),
          bookAsOf: null, lastTradeAt: null, bid: null, ask: null, bidSize: null, askSize: null, volume: null, openInterest: null,
          ivPercent: null, delta: null, gamma: null, theta: null, vega: null, rho: null };
        const shares = asNumber(row.lot_size), multiplier = confirmed ? asNumber(extra.contract_multiplier) : null;
        const shareOnly = row.option_standard_type === 'STANDARD' && shares !== null && shares > 0 && shares === asNumber(extra?.contract_size);
        // A partial Cloud quote must not erase differently sourced, exact OCC terms.
        if (!confirmed && yahoo?.shareOnly && row.option_standard_type === 'STANDARD') continue;
        if (yahoo) options.delete(yahoo.id);
        options.set(row.code, { id: row.code, underlying: symbol, right: row.option_type === 'PUT' ? 'put' : 'call',
          strike: row.strike_price, expiry, currency: 'USD', shares: shareOnly ? shares : null,
          premiumMultiplier: multiplier !== null && multiplier > 0 ? multiplier : null, shareOnly, source: contractSource,
          exercise: confirmed && extra.option_area_type === 'AMERICAN' ? 'american'
            : confirmed && extra.option_area_type === 'EUROPEAN' ? 'european' : null,
          quote: { ...baseQuote, ...(confirmed ? { greeksSource: contractSource, greeksCollectedAt: live?.collectedAt ?? null,
            openInterest: asNumber(extra.open_interest) ?? baseQuote.openInterest, ivPercent: asNumber(extra.implied_volatility) ?? baseQuote.ivPercent,
            delta: asNumber(extra.delta), gamma: asNumber(extra.gamma), theta: asNumber(extra.theta),
            vega: asNumber(extra.vega), rho: asNumber(extra.rho) } : {}) } });
      }
    } catch { notices.push(`${cloud.broker} Cloud chain unavailable for ${expiry}.`); }
  }
  events.push(...await actions);
  return { options: [...options.values()], events, notices: [...new Set(notices)] };
}
