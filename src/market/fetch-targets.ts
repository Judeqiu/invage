import { yf } from './yf-client.js';
import type { AnalystTarget } from './types.js';

export async function fetchTargets(tickers: string[]): Promise<Record<string, AnalystTarget>> {
  const results: Record<string, AnalystTarget> = {};

  const promises = tickers.map(async (ticker) => {
    try {
      const summary = await yf.quoteSummary(ticker, {
        modules: ['financialData'],
      });
      const fd = summary.financialData;
      results[ticker] = {
        ticker,
        targetLowPrice: fd?.targetLowPrice ?? null,
        targetMedianPrice: fd?.targetMedianPrice ?? null,
        targetMeanPrice: fd?.targetMeanPrice ?? null,
        targetHighPrice: fd?.targetHighPrice ?? null,
      };
    } catch (err) {
      console.error(`Failed to fetch targets for ${ticker}:`, err);
      results[ticker] = {
        ticker,
        targetLowPrice: null,
        targetMedianPrice: null,
        targetMeanPrice: null,
        targetHighPrice: null,
      };
    }
  });

  await Promise.all(promises);
  return results;
}
