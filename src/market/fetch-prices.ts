import { yf } from './yf-client.js';
import type { MarketQuote } from './types.js';

/** Yahoo quote fields we care about for "current price" selection. */
export interface YahooPriceSnapshot {
  ticker: string;
  /** Best current price for portfolio MTM (see pickCurrentPrice). */
  price: number;
  /** Which Yahoo field fed `price`. */
  priceField:
    | 'regularMarketPrice'
    | 'postMarketPrice'
    | 'preMarketPrice'
    | 'regularMarketPreviousClose';
  previousClose: number | null;
  regularMarketPrice: number | null;
  preMarketPrice: number | null;
  postMarketPrice: number | null;
  marketState: string | null;
  currency: string;
  shortName: string;
  /** ISO time of the selected price when Yahoo provides one. */
  asOf: string | null;
}

type LooseQuote = {
  symbol?: string;
  shortName?: string;
  currency?: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketTime?: Date | string | number;
  preMarketPrice?: number;
  preMarketTime?: Date | string | number;
  postMarketPrice?: number;
  postMarketTime?: Date | string | number;
};

function num(v: unknown): number | null {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Yahoo sometimes returns unix seconds
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/**
 * Pick the best "current" price for display / MTM.
 *
 * Never treat previousClose as live while a regular/session price exists.
 * - REGULAR → regularMarketPrice
 * - PRE / POST → the session's extended-hours price, unless its timestamp
 *   establishes that it predates the regular-session quote
 * - CLOSED / other → latest timestamped session price
 * - when timestamps are unavailable → session price, then regular/post/pre
 * - only if all missing → previousClose (last resort, labeled)
 */
export function pickCurrentPrice(q: LooseQuote): {
  price: number;
  priceField: YahooPriceSnapshot['priceField'];
  asOf: string | null;
} {
  const state = (q.marketState ?? '').toUpperCase();
  const regular = num(q.regularMarketPrice);
  const pre = num(q.preMarketPrice);
  const post = num(q.postMarketPrice);
  const prev = num(q.regularMarketPreviousClose);

  if (state === 'REGULAR' && regular != null) {
    return { price: regular, priceField: 'regularMarketPrice', asOf: toIso(q.regularMarketTime) };
  }
  const sessions = [
    { price: regular, priceField: 'regularMarketPrice' as const, asOf: toIso(q.regularMarketTime) },
    { price: post, priceField: 'postMarketPrice' as const, asOf: toIso(q.postMarketTime) },
    { price: pre, priceField: 'preMarketPrice' as const, asOf: toIso(q.preMarketTime) },
  ].filter((s): s is typeof s & { price: number } => s.price != null);
  const activeField = state === 'PRE' || state === 'PREPRE' ? 'preMarketPrice'
    : state === 'POST' || state === 'POSTPOST' ? 'postMarketPrice' : null;
  const active = sessions.find(s => s.priceField === activeField);
  const regularSession = sessions.find(s => s.priceField === 'regularMarketPrice');
  if (active && (!active.asOf || !regularSession?.asOf || active.asOf >= regularSession.asOf)) {
    return active;
  }
  // Yahoo can retain old pre/post fields. Compare source times rather than
  // letting a prior day's extended-hours print override a newer session.
  const latest = sessions.filter(s => s.asOf != null)
    .sort((a, b) => b.asOf!.localeCompare(a.asOf!))[0];
  if (latest) return latest;
  if (sessions[0]) return sessions[0];
  if (prev != null) {
    return {
      price: prev,
      priceField: 'regularMarketPreviousClose',
      asOf: null,
    };
  }
  throw new Error(
    `No usable price fields on Yahoo quote for ${q.symbol ?? 'unknown'} ` +
      `(marketState=${q.marketState ?? 'n/a'}).`,
  );
}

export function snapshotFromYahooQuote(ticker: string, q: LooseQuote): YahooPriceSnapshot {
  const picked = pickCurrentPrice(q);
  return {
    ticker: (q.symbol ?? ticker).toUpperCase(),
    price: picked.price,
    priceField: picked.priceField,
    previousClose: num(q.regularMarketPreviousClose),
    regularMarketPrice: num(q.regularMarketPrice),
    preMarketPrice: num(q.preMarketPrice),
    postMarketPrice: num(q.postMarketPrice),
    marketState: q.marketState ?? null,
    currency: q.currency?.trim().toUpperCase() || 'UNKNOWN',
    shortName: q.shortName ?? ticker,
    asOf: picked.asOf,
  };
}

/** One-line agent-safe label so previous close is never called "live". */
export function formatPriceSnapshot(s: YahooPriceSnapshot): string {
  const parts = [
    `${s.ticker}: $${s.price.toFixed(2)} (${s.priceField}`,
    s.marketState ? `state=${s.marketState}` : null,
    s.asOf ? `asOf=${s.asOf}` : null,
  ].filter(Boolean);
  let line = parts.join(', ') + ')';
  if (s.previousClose != null && s.priceField !== 'regularMarketPreviousClose') {
    line += ` | prevClose=$${s.previousClose.toFixed(2)}`;
  }
  if (s.postMarketPrice != null && s.priceField !== 'postMarketPrice') {
    line += ` | post=$${s.postMarketPrice.toFixed(2)}`;
  }
  if (s.preMarketPrice != null && s.priceField !== 'preMarketPrice') {
    line += ` | pre=$${s.preMarketPrice.toFixed(2)}`;
  }
  if (s.priceField === 'regularMarketPreviousClose') {
    line += ' ⚠ using previous close only — no session price on quote';
  }
  return line;
}

export async function fetchPriceSnapshots(
  tickers: string[],
): Promise<Record<string, YahooPriceSnapshot>> {
  const results: Record<string, YahooPriceSnapshot> = {};

  const promises = tickers.map(async (raw) => {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) throw new Error('fetchPriceSnapshots: empty ticker');
    try {
      const quote = (await yf.quote(ticker)) as LooseQuote | undefined;
      if (!quote) {
        throw new Error(`Yahoo quote returned empty for ${ticker}`);
      }
      results[ticker] = snapshotFromYahooQuote(ticker, quote);
    } catch (err) {
      console.error(`Failed to fetch price for ${ticker}:`, err);
      // Do not invent a price; omit key so callers fail-fast on missing
    }
  });

  await Promise.all(promises);
  return results;
}

export async function fetchPrices(tickers: string[]): Promise<Record<string, number>> {
  const snaps = await fetchPriceSnapshots(tickers);
  const results: Record<string, number> = {};
  for (const [t, s] of Object.entries(snaps)) {
    results[t] = s.price;
  }
  return results;
}

export async function fetchQuote(ticker: string): Promise<MarketQuote | null> {
  try {
    const snaps = await fetchPriceSnapshots([ticker]);
    const s = snaps[ticker.toUpperCase()];
    if (!s) return null;
    return {
      ticker: s.ticker,
      price: s.price,
      currency: s.currency,
      shortName: s.shortName,
    };
  } catch {
    return null;
  }
}
