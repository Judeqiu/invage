/**
 * Shared portfolio market-data resolution: equities via Yahoo quote,
 * options via hybrid Yahoo chain + manual mark.
 */

import type { Holding } from './types.js';
import { holdingBrokerValues } from './position-value.js';
import { portfolioQuoteSymbols } from './portfolio-quote-symbols.js';
import { fetchPrices } from './fetch-prices.js';
import {
  applyOptionMarks,
  fetchOptionMarks,
  type OptionLiveMark,
} from './fetch-option-marks.js';

export interface ResolvedPortfolioMarket {
  /** Portfolio with option.mark updated to live marks where available. */
  portfolio: Record<string, Holding>;
  /** Yahoo prices keyed by bare equity symbol (not composite portfolio keys). */
  equityPrices: Record<string, number>;
  optionMarks: Record<string, OptionLiveMark>;
}

export async function resolvePortfolioMarket(
  portfolio: Record<string, Holding>,
): Promise<ResolvedPortfolioMarket> {
  const symbols = portfolioQuoteSymbols(portfolio);
  const [equityPrices, optionMarks] = await Promise.all([
    symbols.length > 0
      ? fetchPrices(symbols)
      : Promise.resolve({} as Record<string, number>),
    fetchOptionMarks(portfolio),
  ]);
  const valued = applyOptionMarks(portfolio, optionMarks);
  for (const [key, h] of Object.entries(portfolio)) {
    const b = holdingBrokerValues(h);
    if (b?.mark === undefined) continue;
    if (h.option) {
      valued[key] = { ...h, option: { ...h.option, mark: b.mark } };
      optionMarks[key] = { ...optionMarks[key], mark: b.mark, source: 'broker', note: `${b.source} as of ${b.as_of}` };
    }
  }
  return {
    equityPrices,
    optionMarks,
    portfolio: valued,
  };
}
