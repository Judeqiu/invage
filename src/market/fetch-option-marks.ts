/**
 * Live option marks: Yahoo chain for listed public underlyings,
 * stored mark for private/manual contracts.
 *
 * Yahoo quotes lastPrice/bid/ask **per share**. Invage mark is **$ per contract**
 * = perShare × multiplier.
 */

import { yf } from './yf-client.js';
import type { Holding, OptionQuoteSource, OptionRight, OptionSpec } from './types.js';
import { isOptionHolding } from './position-value.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';

export type OptionMarkSource = 'manual' | 'yahoo';

export interface OptionProbabilityQuote {
  mark: number;
  spot: number;
  optionAsOf: string;
  spotAsOf: string;
}

export interface ProviderImpliedVolatility {
  iv: number;
  source: 'yahoo';
  /** Retrieval time only: Yahoo does not timestamp its IV field. */
  fetchedAt: string;
  asOf: null;
  optionAsOf: string | null;
  contractSymbol?: string;
}

export interface OptionLiveMark {
  providerIv?: ProviderImpliedVolatility;
  /** Timestamp-checked model inputs, separate from the portfolio valuation. */
  probabilityQuote?: OptionProbabilityQuote;
  /** Premium $ per contract used for MTM. */
  mark: number;
  source: OptionMarkSource;
  /** Yahoo last/mid per share when source=yahoo. */
  perShare?: number;
  contractSymbol?: string;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  /** Why manual was used under auto mode (missing chain, private, etc.). */
  note?: string;
}

/** Yahoo CallOrPut-like row (subset we need). */
export interface YahooContractRow {
  contractSymbol?: string;
  strike: number;
  lastPrice: number;
  bid?: number;
  ask?: number;
  expiration?: Date | string;
  lastTradeDate?: Date | string | number;
  impliedVolatility?: number;
}

export function providerIvFromYahooRow(row: YahooContractRow, now = new Date()): ProviderImpliedVolatility | undefined {
  if (typeof row.impliedVolatility !== 'number' || !Number.isFinite(row.impliedVolatility)) return undefined;
  const rawTime = row.lastTradeDate;
  const date = rawTime == null ? null : new Date(typeof rawTime === 'number' && rawTime < 1e12 ? rawTime * 1000 : rawTime);
  return { iv: row.impliedVolatility, source: 'yahoo', fetchedAt: now.toISOString(), asOf: null,
    optionAsOf: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
    contractSymbol: row.contractSymbol };
}

/** Pair a recent option trade with the regular-session stock quote from its chain.
 * Bid/ask have no timestamps in this API, so cannot establish a matching pair.
 */
export function matchingProbabilityQuote(
  row: YahooContractRow,
  quote: { regularMarketPrice?: number; regularMarketTime?: Date | string | number } | undefined,
  multiplier: number,
  now = Date.now(),
): OptionProbabilityQuote | undefined {
  const time = (v: Date | string | number | undefined) => v == null ? NaN
    : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : new Date(v).getTime();
  const optionTime = time(row.lastTradeDate);
  const spotTime = time(quote?.regularMarketTime);
  const spot = quote?.regularMarketPrice;
  if (!(spot != null && Number.isFinite(spot) && spot > 0)
    || !(Number.isFinite(row.lastPrice) && row.lastPrice > 0)
    || !(Number.isFinite(multiplier) && multiplier > 0)
    || !Number.isFinite(optionTime) || !Number.isFinite(spotTime)
    || Math.abs(optionTime - spotTime) > 15 * 60_000
    || Math.max(optionTime, spotTime) > now + 60_000
    || now - Math.min(optionTime, spotTime) > 7 * 86400_000) return undefined;
  const optionAsOf = new Date(optionTime).toISOString();
  const spotAsOf = new Date(spotTime).toISOString();
  if (optionAsOf.slice(0, 10) !== spotAsOf.slice(0, 10)) return undefined;
  return { mark: perShareToContractMark(row.lastPrice, multiplier), spot, optionAsOf, spotAsOf };
}

export function toDateKey(d: Date | string): string {
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid date string for option expiry: ${d}`);
    }
    return parsed.toISOString().slice(0, 10);
  }
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`Invalid Date for option expiry: ${String(d)}`);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Prefer mid when bid and ask are both finite and ask >= bid >= 0 with ask > 0.
 * Else lastPrice. Never invent zeros when lastPrice is missing.
 */
export function pickPerSharePremium(row: {
  lastPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
}): number {
  const bid = row.bid;
  const ask = row.ask;
  if (
    bid != null &&
    ask != null &&
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    bid >= 0 &&
    ask > 0 &&
    ask >= bid
  ) {
    return (bid + ask) / 2;
  }
  if (row.lastPrice != null && Number.isFinite(row.lastPrice) && row.lastPrice >= 0) {
    return row.lastPrice;
  }
  throw new Error('Yahoo contract row has no usable lastPrice or bid/ask mid.');
}

export function perShareToContractMark(perShare: number, multiplier: number): number {
  if (!(multiplier > 0)) throw new Error('multiplier must be positive.');
  if (!(perShare >= 0) || !Number.isFinite(perShare)) {
    throw new Error('per-share premium must be a finite number ≥ 0.');
  }
  return Number((perShare * multiplier).toFixed(2));
}

export function findYahooContract(
  rows: YahooContractRow[],
  strike: number,
  expiryYmd: string,
): YahooContractRow | null {
  const matches = rows.filter((r) => {
    if (Math.abs(r.strike - strike) > 1e-6) return false;
    if (r.expiration != null && toDateKey(r.expiration) !== expiryYmd) return false;
    return true;
  });
  if (matches.length === 0) return null;
  return matches[0];
}

function resolveSourceMode(o: OptionSpec): OptionQuoteSource | 'auto' {
  if (o.quote_source === 'manual' || o.quote_source === 'yahoo') return o.quote_source;
  return 'auto';
}

function manualMark(o: OptionSpec, note?: string): OptionLiveMark {
  return {
    mark: o.mark,
    source: 'manual',
    note,
  };
}

/**
 * Fetch Yahoo options chain for one underlying expiry and return matching contract.
 * Throws on hard Yahoo/API errors when mode is yahoo; caller handles auto.
 */
export async function fetchYahooContractMark(
  o: OptionSpec,
): Promise<{ row: YahooContractRow; mark: number; perShare: number; probabilityQuote?: OptionProbabilityQuote }> {
  const underlying = canonicalOptionUnderlying(o.underlying, o);
  const expiryYmd = o.expiry;

  let chain;
  try {
    // Request specific expiry when possible (Yahoo accepts Date / epoch / string)
    chain = await yf.options(underlying, { date: expiryYmd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Yahoo options chain failed for ${underlying} expiry ${expiryYmd}: ${msg}`);
  }

  if (!chain?.options?.length) {
    throw new Error(`Yahoo returned no options series for ${underlying} @ ${expiryYmd}.`);
  }

  // Prefer the series whose expirationDate matches; else first series
  let series = chain.options.find(
    (s) => s.expirationDate != null && toDateKey(s.expirationDate) === expiryYmd,
  );
  if (!series) {
    // Some Yahoo responses only return the nearest series unless date matches an available exp
    const available = (chain.expirationDates ?? []).map((d) => toDateKey(d));
    if (available.length > 0 && !available.includes(expiryYmd)) {
      throw new Error(
        `Expiry ${expiryYmd} not in Yahoo expiration list for ${underlying}. ` +
          `Available sample: ${available.slice(0, 8).join(', ')}${available.length > 8 ? '…' : ''}`,
      );
    }
    if (chain.options.length !== 1 || chain.options[0].expirationDate != null) {
      throw new Error(`Yahoo returned a different option expiry for ${underlying} @ ${expiryYmd}.`);
    }
    series = chain.options[0];
  }

  const sideRows: YahooContractRow[] =
    o.right === 'call' ? (series.calls as YahooContractRow[]) : (series.puts as YahooContractRow[]);
  if (!sideRows?.length) {
    throw new Error(`Yahoo ${o.right} chain empty for ${underlying} @ ${expiryYmd}.`);
  }

  const row = findYahooContract(sideRows, o.strike, expiryYmd);
  if (!row) {
    const strikes = sideRows.map((r) => r.strike).sort((a, b) => a - b);
    const near = strikes.filter((s) => Math.abs(s - o.strike) <= 5).slice(0, 10);
    throw new Error(
      `No Yahoo ${o.right} strike ${o.strike} for ${underlying} @ ${expiryYmd}. ` +
        (near.length ? `Nearby strikes: ${near.join(', ')}` : `Strikes on series: ${strikes.slice(0, 12).join(', ')}…`),
    );
  }
  if (series.expirationDate == null && row.expiration == null) {
    throw new Error(`Yahoo option expiry cannot be verified for ${underlying} @ ${expiryYmd}.`);
  }

  const perShare = pickPerSharePremium(row);
  const mark = perShareToContractMark(perShare, o.multiplier);
  const quote = chain.quote && 'regularMarketPrice' in chain.quote ? {
    regularMarketPrice: typeof chain.quote.regularMarketPrice === 'number' ? chain.quote.regularMarketPrice : undefined,
    regularMarketTime: 'regularMarketTime' in chain.quote && chain.quote.regularMarketTime instanceof Date
      ? chain.quote.regularMarketTime : undefined,
  } : undefined;
  return { row, mark, perShare, probabilityQuote: matchingProbabilityQuote(row, quote, o.multiplier) };
}

/**
 * Resolve live marks for all option positions in a portfolio.
 * Equity holdings are ignored.
 *
 * Does not write YAML — returns marks for valuation only.
 */
export async function fetchOptionMarks(
  portfolio: Record<string, Holding>,
): Promise<Record<string, OptionLiveMark>> {
  const out: Record<string, OptionLiveMark> = {};
  const optionEntries = Object.entries(portfolio).filter(([, h]) => isOptionHolding(h));

  await Promise.all(
    optionEntries.map(async ([key, h]) => {
      const o = h.option!;
      const mode = resolveSourceMode(o);

      if (mode === 'manual') {
        out[key] = manualMark(o, 'quote_source=manual');
        return;
      }

      try {
        const { row, mark, perShare, probabilityQuote } = await fetchYahooContractMark(o);
        out[key] = {
          mark,
          source: 'yahoo',
          probabilityQuote,
          providerIv: providerIvFromYahooRow(row),
          perShare,
          contractSymbol: row.contractSymbol,
          bid: row.bid,
          ask: row.ask,
          lastPrice: row.lastPrice,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mode === 'yahoo') {
          throw new Error(
            `Option ${key}: quote_source=yahoo but live mark unavailable. ${msg}`,
          );
        }
        // auto → stored mark (private / unlisted / chain miss)
        out[key] = manualMark(o, `auto→manual: ${msg}`);
      }
    }),
  );

  return out;
}

/**
 * Clone portfolio with option.mark replaced by live marks (yahoo or resolved).
 * Used only for in-memory valuation — does not persist.
 */
export function applyOptionMarks(
  portfolio: Record<string, Holding>,
  marks: Record<string, OptionLiveMark>,
): Record<string, Holding> {
  const next: Record<string, Holding> = {};
  for (const [key, h] of Object.entries(portfolio)) {
    if (!isOptionHolding(h) || !h.option) {
      next[key] = h;
      continue;
    }
    const live = marks[key];
    if (!live) {
      next[key] = h;
      continue;
    }
    next[key] = {
      ...h,
      option: {
        ...h.option,
        mark: live.mark,
      },
    };
  }
  return next;
}

/**
 * Equities → Yahoo prices; options → hybrid marks; returns portfolio ready to value.
 */
export async function resolvePortfolioForValuation(
  portfolio: Record<string, Holding>,
  fetchEquityPrices: (tickers: string[]) => Promise<Record<string, number>>,
  equityTickers: string[],
): Promise<{
  equityPrices: Record<string, number>;
  portfolio: Record<string, Holding>;
  optionMarks: Record<string, OptionLiveMark>;
}> {
  const [equityPrices, optionMarks] = await Promise.all([
    equityTickers.length > 0 ? fetchEquityPrices(equityTickers) : Promise.resolve({}),
    fetchOptionMarks(portfolio),
  ]);
  return {
    equityPrices,
    portfolio: applyOptionMarks(portfolio, optionMarks),
    optionMarks,
  };
}
