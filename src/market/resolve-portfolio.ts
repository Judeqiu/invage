/**
 * Shared portfolio market-data resolution: equities via Yahoo quote,
 * options via hybrid Yahoo chain + manual mark.
 */

import type { Holding } from './types.js';
import { equityKeys } from './position-value.js';
import { fetchPrices } from './fetch-prices.js';
import {
  applyOptionMarks,
  fetchOptionMarks,
  type OptionLiveMark,
} from './fetch-option-marks.js';

export interface ResolvedPortfolioMarket {
  /** Portfolio with option.mark updated to live marks where available. */
  portfolio: Record<string, Holding>;
  equityPrices: Record<string, number>;
  optionMarks: Record<string, OptionLiveMark>;
}

export async function resolvePortfolioMarket(
  portfolio: Record<string, Holding>,
): Promise<ResolvedPortfolioMarket> {
  const eqKeys = equityKeys(portfolio);
  const [equityPrices, optionMarks] = await Promise.all([
    eqKeys.length > 0 ? fetchPrices(eqKeys) : Promise.resolve({} as Record<string, number>),
    fetchOptionMarks(portfolio),
  ]);
  return {
    equityPrices,
    optionMarks,
    portfolio: applyOptionMarks(portfolio, optionMarks),
  };
}
