import { yf } from './yf-client.js';
import type { FinancialMetrics } from './types.js';
import { deriveYields, emptyMetrics } from './value-assess.js';

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return v;
}

export async function fetchMetrics(tickers: string[]): Promise<Record<string, FinancialMetrics>> {
  if (tickers.length === 0) {
    throw new Error('fetchMetrics: tickers must be non-empty');
  }

  const results: Record<string, FinancialMetrics> = {};

  const promises = tickers.map(async (raw) => {
    const ticker = raw.trim().toUpperCase();
    if (!ticker) {
      throw new Error('fetchMetrics: empty ticker in list');
    }

    try {
      const [quote, summary] = await Promise.all([
        yf.quote(ticker),
        yf.quoteSummary(ticker, {
          modules: ['defaultKeyStatistics', 'financialData', 'assetProfile', 'summaryProfile'],
        }),
      ]);
      const stats = summary.defaultKeyStatistics;
      const fd = summary.financialData;
      const sector =
        (quote.sector as string | undefined) ??
        summary.assetProfile?.sector ??
        summary.summaryProfile?.sector ??
        'N/A';

      const trailingPE = num(quote.trailingPE);
      const marketCap = num(quote.marketCap);
      const enterpriseValue = num(stats?.enterpriseValue);
      const freeCashflow = num(fd?.freeCashflow);

      const yields = deriveYields({
        trailingPE,
        marketCap,
        enterpriseValue,
        freeCashflow,
      });

      results[ticker] = {
        ticker,
        shortName: (quote.shortName as string) ?? ticker,
        sector,
        trailingPE,
        forwardPE: num(quote.forwardPE),
        pegRatio: num(stats?.pegRatio),
        priceToBook: num(stats?.priceToBook),
        returnOnEquity: num(fd?.returnOnEquity),
        returnOnAssets: num(fd?.returnOnAssets),
        marketCap,
        enterpriseValue,
        enterpriseToEbitda: num(stats?.enterpriseToEbitda),
        ebitda: num(fd?.ebitda),
        freeCashflow,
        operatingCashflow: num(fd?.operatingCashflow),
        totalCash: num(fd?.totalCash),
        totalDebt: num(fd?.totalDebt),
        debtToEquity: num(fd?.debtToEquity),
        currentRatio: num(fd?.currentRatio),
        profitMargins: num(fd?.profitMargins) ?? num(stats?.profitMargins),
        operatingMargins: num(fd?.operatingMargins),
        grossMargins: num(fd?.grossMargins),
        revenueGrowth: num(fd?.revenueGrowth),
        earningsGrowth: num(fd?.earningsGrowth),
        fcfYield: yields.fcfYield,
        earningsYield: yields.earningsYield,
        fcfYieldOnEv: yields.fcfYieldOnEv,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to fetch metrics for ${ticker}:`, message);
      results[ticker] = emptyMetrics(ticker, message);
    }
  });

  await Promise.all(promises);
  return results;
}
