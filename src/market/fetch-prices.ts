import { yf } from './yf-client.js';
import type { MarketQuote } from './types.js';

export async function fetchPrices(tickers: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  const promises = tickers.map(async (ticker) => {
    try {
      const quote = await yf.quote(ticker);
      if (quote?.regularMarketPrice != null) {
        results[ticker] = Number(quote.regularMarketPrice.toFixed(2));
      }
    } catch (err) {
      console.error(`Failed to fetch price for ${ticker}:`, err);
    }
  });

  await Promise.all(promises);
  return results;
}

export async function fetchQuote(ticker: string): Promise<MarketQuote | null> {
  try {
    const quote = await yf.quote(ticker);
    if (!quote?.regularMarketPrice) return null;
    return {
      ticker,
      price: Number(quote.regularMarketPrice.toFixed(2)),
      currency: quote.currency ?? 'USD',
      shortName: quote.shortName ?? ticker,
    };
  } catch {
    return null;
  }
}
