import { yf } from '../market/yf-client.js';
import { snapshotFromYahooQuote, type YahooPriceSnapshot } from '../market/fetch-prices.js';

export type AnnualFinancials = {
  end: string; revenue: number | null; operatingIncome: number | null; netIncome: number | null;
  operatingCashFlow: number | null; freeCashFlow: number | null; totalAssets: number | null;
  totalDebt: number | null; cash: number | null; dilutedEPS: number | null;
};
export type StockData = {
  ticker: string; fetchedAt: string; name: string; sector: string | null; industry: string | null;
  country: string | null; exchange: string | null; website: string | null; description: string | null;
  quote: YahooPriceSnapshot | null; quoteCurrency: string | null; financialCurrency: string | null;
  marketCap: number | null; enterpriseValue: number | null; trailingPE: number | null; forwardPE: number | null;
  priceToSales: number | null; priceToBook: number | null;
  analyst: { recommendation: string | null; count: number | null; low: number | null; mean: number | null; high: number | null };
  latestFiscalEnd: string | null; annual: AnnualFinancials[]; gaps: string[];
};
export interface ResearchProvider {
  quote(ticker: string, signal?: AbortSignal): Promise<unknown>;
  summary(ticker: string, signal?: AbortSignal): Promise<unknown>;
  annual(ticker: string, since: string, until: string, signal?: AbortSignal): Promise<unknown>;
}
const provider: ResearchProvider = {
  quote: (ticker, signal) => yf.quote(ticker, {}, { fetchOptions: { signal } }),
  summary: (ticker, signal) => yf.quoteSummary(ticker, { modules: ['assetProfile', 'price', 'financialData', 'defaultKeyStatistics'] }, { fetchOptions: { signal } }),
  annual: (ticker, since, until, signal) => yf.fundamentalsTimeSeries(ticker, { period1: since, period2: until, type: 'annual', module: 'all' }, { fetchOptions: { signal } }),
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const string = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
function date(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
export function stockTicker(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(value.trim().toUpperCase()))
    throw new Error('Provide a listed equity ticker, for example RKLB, MSFT or 0700.HK.');
  return value.trim().toUpperCase();
}
const ratio = (a: number | null, b: number | null) => a !== null && b !== null && b > 0 ? finite(a / b) : null;

/** Separate provider failures preserve the rest of the public evidence. No user books are accessed. */
export async function collectStockData(raw: string, options: { provider?: ResearchProvider; now?: Date; signal?: AbortSignal } = {}): Promise<StockData> {
  const ticker = stockTicker(raw), now = options.now ?? new Date(), p = options.provider ?? provider;
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const results = await Promise.allSettled([p.quote(ticker, signal), p.summary(ticker, signal),
    p.annual(ticker, new Date(now.getTime() - 6 * 366 * 86400_000).toISOString().slice(0, 10), now.toISOString().slice(0, 10), signal)]);
  options.signal?.throwIfAborted();
  const gaps: string[] = [];
  const read = (index: number, label: string) => {
    const r = results[index];
    if (r.status === 'fulfilled') return r.value;
    // Do not publish provider bodies, credentials, URLs with tokens or arbitrary exception text.
    gaps.push(`${label} unavailable from Yahoo Finance.`); return null;
  };
  const q = object(read(0, 'Quote')), s = object(read(1, 'Company snapshot')), history = read(2, 'Annual statements');
  if (q.symbol && q.symbol !== ticker) throw new Error('Provider returned a different ticker; report stopped.');
  if (q.quoteType && q.quoteType !== 'EQUITY') throw new Error('This workflow supports listed equities; funds and other instruments need a different methodology.');
  const profile = object(s.assetProfile), price = object(s.price), stats = object(s.defaultKeyStatistics), fd = object(s.financialData);
  if (price.symbol && price.symbol !== ticker) throw new Error('Provider returned a different ticker; report stopped.');
  if (price.quoteType && price.quoteType !== 'EQUITY') throw new Error('This workflow supports listed equities; funds and other instruments need a different methodology.');
  const annual: AnnualFinancials[] = [];
  const duplicated = new Set<string>();
  if (Array.isArray(history)) for (const value of history) {
    const r = object(value), end = date(r.date);
    if (!end || end > now.toISOString().slice(0, 10) || r.periodType !== '12M') continue;
    if (duplicated.has(end)) continue;
    const prior = annual.findIndex(a => a.end === end);
    if (prior !== -1) {
      annual.splice(prior, 1); duplicated.add(end);
      gaps.push(`Duplicate annual period ${end}; conflicting period excluded.`); continue;
    }
    annual.push({ end, revenue: finite(r.totalRevenue), operatingIncome: finite(r.operatingIncome), netIncome: finite(r.netIncome),
      operatingCashFlow: finite(r.operatingCashFlow), freeCashFlow: finite(r.freeCashFlow), totalAssets: finite(r.totalAssets),
      totalDebt: finite(r.totalDebt), cash: finite(r.cashAndCashEquivalents), dilutedEPS: finite(r.dilutedEPS) });
  }
  annual.sort((a, b) => b.end.localeCompare(a.end));
  if (!annual.length) gaps.push('No dated annual statements available; no statement figures were inferred from estimates.');
  let quote: YahooPriceSnapshot | null = null;
  try { quote = snapshotFromYahooQuote(ticker, q); } catch { gaps.push('A usable stock price is unavailable.'); }
  const financialCurrency = string(fd.financialCurrency);
  if (!financialCurrency) gaps.push('Financial statement currency is unverified; amounts must not be combined with quote-currency values.');
  if (annual[0] && now.getTime() - Date.parse(annual[0].end) > 550 * 86400_000) gaps.push('Latest annual statements are older than 550 days; peer rankings are withheld.');
  if (!q.symbol && !price.symbol && !profile.longBusinessSummary && !annual.length) throw new Error(`No company evidence available for ${ticker}.`);
  return { ticker, fetchedAt: now.toISOString(), name: string(q.longName) ?? string(q.shortName) ?? string(price.longName) ?? ticker,
    sector: string(profile.sector), industry: string(profile.industry), country: string(profile.country), exchange: string(q.fullExchangeName) ?? string(q.exchange),
    website: string(profile.website), description: string(profile.longBusinessSummary), quote,
    quoteCurrency: string(q.currency) ?? string(price.currency), financialCurrency, marketCap: finite(q.marketCap) ?? finite(price.marketCap),
    enterpriseValue: finite(stats.enterpriseValue), trailingPE: finite(q.trailingPE), forwardPE: finite(q.forwardPE),
    priceToSales: finite(q.priceToSalesTrailing12Months), priceToBook: finite(stats.priceToBook),
    analyst: { recommendation: string(fd.recommendationKey), count: finite(fd.numberOfAnalystOpinions),
      low: finite(fd.targetLowPrice), mean: finite(fd.targetMeanPrice), high: finite(fd.targetHighPrice) },
    latestFiscalEnd: date(stats.mostRecentQuarter), annual: annual.slice(0, 5), gaps };
}

export const RANK_METRICS = [
  { id: 'growth', label: 'Revenue growth', detail: 'Annual revenue YoY; higher is better', higher: true },
  { id: 'profitability', label: 'Operating margin', detail: 'Annual operating income / revenue; higher is better', higher: true },
  { id: 'balanceSheet', label: 'Debt / assets', detail: 'Annual total debt / assets; lower is better', higher: false },
  { id: 'valuation', label: 'Trailing P/E', detail: 'Yahoo trailing P/E; positive earnings only; lower is better', higher: false },
] as const;
export type RankMetric = typeof RANK_METRICS[number]['id'];
export type RankRow = { ticker: string; values: Record<RankMetric, number | null>; reason: string | null };
export type PeerRanking = {
  rows: RankRow[]; eligible: string[]; targetRank: number | null; targetScore: number | null;
  scores: { ticker: string; score: number; rank: number }[]; explanation: string; methodology: string;
};
export function rankingValues(stock: StockData): Record<RankMetric, number | null> {
  const a = stock.annual[0], b = stock.annual[1];
  const adjacent = a && b && Date.parse(a.end) - Date.parse(b.end) >= 330 * 86400_000 && Date.parse(a.end) - Date.parse(b.end) <= 400 * 86400_000;
  const growthRatio = adjacent ? ratio(a.revenue, b.revenue) : null;
  return { growth: growthRatio === null ? null : growthRatio - 1,
    profitability: a ? ratio(a.operatingIncome, a.revenue) : null,
    balanceSheet: a && a.totalDebt !== null && a.totalDebt >= 0 ? ratio(a.totalDebt, a.totalAssets) : null,
    valuation: stock.trailingPE !== null && stock.trailingPE > 0 ? stock.trailingPE : null };
}
/** One complete, named cohort for all four factors; no hidden imputation or market-wide percentile. */
export function rankStockPeers(stocks: StockData[], now = new Date()): PeerRanking {
  const target = stocks[0];
  if (!target || new Set(stocks.map(s => s.ticker)).size !== stocks.length) throw new Error('A unique target and peer universe is required.');
  const special = /bank|insurance|reit|mortgage|capital markets|credit services/i;
  const rows = stocks.map((s): RankRow => {
    const values = rankingValues(s), end = s.annual[0]?.end, targetEnd = target.annual[0]?.end;
    let reason: string | null = null;
    if (!target.industry || !s.industry || s.industry !== target.industry) reason = 'Industry differs or is unverified.';
    else if (special.test(s.industry)) reason = 'Financial firms and REITs require a sector-specific ranking model.';
    else if (!end || !targetEnd || Date.parse(end) > now.getTime() || now.getTime() - Date.parse(end) > 550 * 86400_000 || Math.abs(Date.parse(end) - Date.parse(targetEnd)) > 120 * 86400_000)
      reason = 'Annual periods are missing, stale or more than 120 days apart.';
    else if (!s.quote?.asOf || !Number.isFinite(Date.parse(s.quote.asOf)) || now.getTime() - Date.parse(s.quote.asOf) > 7 * 86400_000 || Date.parse(s.quote.asOf) > now.getTime() + 60_000)
      reason = 'Quote timestamp is missing, more than seven days old or in the future.';
    else if (RANK_METRICS.some(m => values[m.id] === null)) reason = 'Incomplete factors or non-positive trailing earnings; excluded from the composite.';
    return { ticker: s.ticker, values, reason };
  });
  const eligible = rows.filter(r => !r.reason);
  const methodology = 'Velovest peer screen v1. Four equally weighted factors: annual revenue growth, annual operating margin, annual debt/assets and positive trailing P/E. Each factor uses the same complete, same-industry cohort, annual ends within 120 days and no older than 550 days. Quote timestamps must be available and no older than seven days. A factor score is 100 × (number of peers with worse values + half the number of other peers tied) / (cohort size − 1). Composite is the mean of the four factor scores; rank is 1 + the number of strictly higher composites. At least four eligible companies, including the target, are required. Missing inputs exclude a company, never become zero. This is a relative screening rank within the listed sample, not an analyst recommendation, a market-wide rank, an MSCI rating or a forecast of returns.';
  if (eligible.length < 4 || !eligible.some(r => r.ticker === target.ticker)) return { rows, eligible: eligible.map(r => r.ticker),
    targetRank: null, targetScore: null, scores: [], explanation: 'Composite rank unavailable: at least four complete, comparable companies including the target are required.', methodology };
  const scores = eligible.map(row => ({ ticker: row.ticker, score: RANK_METRICS.reduce((sum, metric) => {
    const value = row.values[metric.id]!;
    const others = eligible.filter(r => r !== row);
    const worse = others.filter(r => metric.higher ? r.values[metric.id]! < value : r.values[metric.id]! > value).length;
    const ties = others.filter(r => r.values[metric.id] === value).length;
    return sum + 100 * (worse + ties / 2) / others.length / RANK_METRICS.length;
  }, 0), rank: 0 }));
  scores.forEach(s => { s.rank = 1 + scores.filter(other => other.score > s.score + 1e-9).length; });
  scores.sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
  const result = scores.find(s => s.ticker === target.ticker)!;
  return { rows, eligible: eligible.map(r => r.ticker), scores, targetRank: result.rank, targetScore: result.score,
    explanation: `Rank ${result.rank} of ${eligible.length} companies in the disclosed peer sample.`, methodology };
}
