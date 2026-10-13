import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { equityQuoteSymbols } from './position-value.js';
import type { Holding } from './types.js';

/** Quotes needed for valuation and the underlying spot of every option holding. */
export function portfolioQuoteSymbols(portfolio: Record<string, Holding>): string[] {
  const symbols = new Set(equityQuoteSymbols(portfolio));
  for (const holding of Object.values(portfolio)) {
    if (!holding.option) continue;
    try {
      symbols.add(canonicalOptionUnderlying(holding.option.underlying, holding.option));
    } catch { /* Invalid option symbols must not prevent quotes for other holdings. */ }
  }
  return [...symbols].filter(Boolean);
}
