/**
 * Load a live portfolio dashboard model for a user slug.
 * Used by the WebUI domain API (dynamic tab) — same math as the HTML report.
 */

import { loadState } from 'utarus';
import { equityKeys, fetchHistoricalCloses, fetchPrices } from '../market/index.js';
import { getPortfolio, type InvestorState } from '../state/portfolio-state.js';
import { loadSnapshots, type Snapshot } from '../state/snapshot.js';
import {
  buildDashboardModel,
  buildLivePositions,
  type DashboardModel,
} from '../report/dashboard-model.js';

export const BENCHMARK_TICKER = 'SPY';

export interface BenchmarkData {
  ticker: string;
  /** First snapshot date — benchmark index is rebased to 100 here. */
  baseDate: string;
  currentPrice: number | null;
  /** Adjusted close at each snapshot date (trading day on or before). */
  closes: Record<string, number>;
}

export interface DashboardPayload {
  slug: string;
  displayName: string;
  generatedAt: string;
  empty: boolean;
  message?: string;
  model: DashboardModel | null;
  /** Null when there are no snapshots to anchor a base date, or SPY fetch failed. */
  benchmark: BenchmarkData | null;
}

/** Fetch SPY adjusted closes at snapshot dates + current price. Soft-fails to null. */
async function loadBenchmark(snapshots: Snapshot[]): Promise<BenchmarkData | null> {
  if (snapshots.length === 0) return null;
  try {
    const dates = snapshots.map((s) => s.date);
    const [closes, prices] = await Promise.all([
      fetchHistoricalCloses(BENCHMARK_TICKER, dates),
      fetchPrices([BENCHMARK_TICKER]),
    ]);
    return {
      ticker: BENCHMARK_TICKER,
      baseDate: snapshots[0].date,
      currentPrice: prices[BENCHMARK_TICKER] ?? null,
      closes,
    };
  } catch (e) {
    console.error('Benchmark fetch failed; dashboard continues without it:', e);
    return null;
  }
}

/**
 * Build dashboard JSON for a user.
 * Empty portfolio → empty:true (no invented holdings).
 * Missing price for a held ticker → throws (fail-fast).
 */
export async function loadDashboardForSlug(
  slug: string,
  priceOverride?: Record<string, number>,
  benchmarkOverride?: BenchmarkData | null,
): Promise<DashboardPayload> {
  const state = loadState(slug) as InvestorState;
  const portfolio = getPortfolio(state);
  const displayName = state.profile.display_name;
  const generatedAt = new Date().toISOString();
  const tickers = Object.keys(portfolio);

  if (tickers.length === 0) {
    return {
      slug,
      displayName,
      generatedAt,
      empty: true,
      message: 'No holdings yet. Add positions in chat, then refresh this dashboard.',
      model: null,
      benchmark: null,
    };
  }

  const eqKeys = equityKeys(portfolio);
  const prices =
    priceOverride ?? (eqKeys.length > 0 ? await fetchPrices(eqKeys) : {});
  const live = buildLivePositions(portfolio, prices);
  const snapshots = loadSnapshots(slug);
  const model = buildDashboardModel(live, snapshots);
  const benchmark =
    benchmarkOverride !== undefined ? benchmarkOverride : await loadBenchmark(snapshots);

  return {
    slug,
    displayName,
    generatedAt,
    empty: false,
    model,
    benchmark,
  };
}
