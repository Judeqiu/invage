/**
 * Live FX rates via Yahoo finance pairs.
 *
 * Symbol `{FROM}{TO}=X` = units of TO per 1 unit of FROM.
 * Example: USDSGD=X ≈ 1.35 → amount_SGD = amount_USD * rate.
 *
 * Fail-fast: missing quote or non-positive rate throws. No cache, no silent 1:1.
 */

import { yf } from './yf-client.js';

const CURRENCY_RE = /^[A-Z]{3,4}$/;

function assertCurrency(code: string, label: string): string {
  const c = code.trim().toUpperCase();
  if (!CURRENCY_RE.test(c)) {
    throw new Error(`${label} must be a 3–4 letter currency code (got "${code}").`);
  }
  return c;
}

/** Yahoo FX pair symbol: units of `to` per 1 unit of `from`. */
export function fxPairSymbol(from: string, to: string): string {
  const f = assertCurrency(from, 'from currency');
  const t = assertCurrency(to, 'to currency');
  return `${f}${t}=X`;
}

/**
 * Convert amount into reporting currency.
 * `rates[ccy]` = units of reporting per 1 unit of ccy.
 */
export function toReportingLive(
  amount: number,
  currency: string,
  reportingCurrency: string,
  rates: Record<string, number>,
  context: string,
): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount for FX convert (${context}): ${amount}`);
  }
  const ccy = assertCurrency(currency, 'currency');
  const rep = assertCurrency(reportingCurrency, 'reporting currency');
  if (ccy === rep) return amount;
  const rate = rates[ccy];
  if (rate == null) {
    throw new Error(
      `Missing FX rate for ${ccy}→${rep} (${context}). ` +
        `Need live rate ${fxPairSymbol(ccy, rep)} (units of ${rep} per 1 ${ccy}).`,
    );
  }
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new Error(`Invalid FX rate for ${ccy}→${rep}: ${rate}`);
  }
  return amount * rate;
}

function num(v: unknown): number | null {
  if (v == null || typeof v !== 'number' || Number.isNaN(v)) return null;
  return v;
}

/**
 * Fetch units of `toCurrency` per 1 unit of each distinct `from` currency.
 * Same-currency entries return 1 without a network call.
 */
export async function fetchFxRates(
  fromCurrencies: string[],
  toCurrency: string,
): Promise<Record<string, number>> {
  const to = assertCurrency(toCurrency, 'toCurrency');
  const froms = [
    ...new Set(
      fromCurrencies.map((c) => assertCurrency(c, 'from currency')).filter((c) => c.length > 0),
    ),
  ];
  if (froms.length === 0) {
    throw new Error('fetchFxRates: fromCurrencies must not be empty.');
  }

  const rates: Record<string, number> = {};
  const needFetch: string[] = [];
  for (const from of froms) {
    if (from === to) {
      rates[from] = 1;
    } else {
      needFetch.push(from);
    }
  }

  await Promise.all(
    needFetch.map(async (from) => {
      const symbol = fxPairSymbol(from, to);
      let quote: { regularMarketPrice?: number; regularMarketPreviousClose?: number } | undefined;
      try {
        quote = (await yf.quote(symbol)) as
          | { regularMarketPrice?: number; regularMarketPreviousClose?: number }
          | undefined;
      } catch (err) {
        throw new Error(
          `Missing live FX for ${from}→${to} (Yahoo ${symbol}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (!quote) {
        throw new Error(`Missing live FX for ${from}→${to} (Yahoo ${symbol}): empty quote.`);
      }
      const price = num(quote.regularMarketPrice) ?? num(quote.regularMarketPreviousClose);
      if (price == null || !(price > 0) || !Number.isFinite(price)) {
        throw new Error(
          `Invalid live FX for ${from}→${to} (Yahoo ${symbol}): price=${price ?? 'n/a'}.`,
        );
      }
      rates[from] = price;
    }),
  );

  return rates;
}
