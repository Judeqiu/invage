import { yf } from './yf-client.js';
import type { FinancialMetrics } from './types.js';

export async function fetchMetrics(tickers: string[]): Promise<Record<string, FinancialMetrics>> {
  const results: Record<string, FinancialMetrics> = {};

  const promises = tickers.map(async (ticker) => {
    try {
      const [quote, summary] = await Promise.all([
        yf.quote(ticker),
        yf.quoteSummary(ticker, {
          modules: ['defaultKeyStatistics', 'financialData'],
        }),
      ]);
      const stats = summary.defaultKeyStatistics;
      const fd = summary.financialData;
      results[ticker] = {
        ticker,
        trailingPE: (quote.trailingPE as number | null) ?? null,
        pegRatio: (stats?.pegRatio as number | null) ?? null,
        forwardPE: (quote.forwardPE as number | null) ?? null,
        priceToBook: (stats?.priceToBook as number | null) ?? null,
        returnOnEquity: (fd?.returnOnEquity as number | null) ?? null,
        shortName: (quote.shortName as string) ?? ticker,
        sector: (quote.sector as string) ?? 'N/A',
      };
    } catch (err) {
      console.error(`Failed to fetch metrics for ${ticker}:`, err);
      results[ticker] = {
        ticker,
        trailingPE: null,
        pegRatio: null,
        forwardPE: null,
        priceToBook: null,
        returnOnEquity: null,
        shortName: ticker,
        sector: 'N/A',
      };
    }
  });

  await Promise.all(promises);
  return results;
}
