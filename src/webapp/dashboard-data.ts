/**
 * Load a live portfolio dashboard model for a user slug.
 * Used by the WebUI domain API (dynamic tab) — same math as the HTML report.
 */

import { loadState } from 'utarus';
import {
  fetchFxRates,
  fetchHistoricalCloses,
  fetchPrices,
  resolvePortfolioMarket,
} from '../market/index.js';
import {
  getCashes,
  getDeposits,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  getTreasury,
  type HouseholdInvestorState,
} from '../state/household-state.js';
import { loadSnapshots, type Snapshot } from '../state/snapshot.js';
import {
  buildDashboardModel,
  buildLivePositions,
  type DashboardFxOptions,
  type DashboardModel,
} from '../report/dashboard-model.js';
import type { Holding } from '../market/types.js';

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
  const deposits = getDeposits(state);
  const displayName = state.profile.display_name;
  const generatedAt = new Date().toISOString();
  const tickers = Object.keys(portfolio);

  if (tickers.length === 0 && deposits.length === 0) {
    return {
      slug,
      displayName,
      generatedAt,
      empty: true,
      message:
        'No holdings or fixed deposits yet. Add positions or deposits in chat, then refresh this dashboard.',
      model: null,
      benchmark: null,
    };
  }

  let valuedPortfolio: Record<string, Holding>;
  let prices: Record<string, number>;
  let optionMarks: Awaited<ReturnType<typeof resolvePortfolioMarket>>['optionMarks'];

  if (tickers.length === 0) {
    valuedPortfolio = {};
    prices = {};
    optionMarks = {};
  } else if (priceOverride) {
    // Tests / overrides: equity prices forced; still resolve option marks unless empty options
    const resolved = await resolvePortfolioMarket(portfolio);
    valuedPortfolio = resolved.portfolio;
    prices = priceOverride;
    optionMarks = resolved.optionMarks;
  } else {
    const resolved = await resolvePortfolioMarket(portfolio);
    valuedPortfolio = resolved.portfolio;
    prices = resolved.equityPrices;
    optionMarks = resolved.optionMarks;
  }

  const cashes = getCashes(state);
  const moneyCurrencies = [
    ...new Set(
      [
        ...cashes.map((c) => c.currency.trim().toUpperCase()),
        ...deposits.map((d) => d.currency.trim().toUpperCase()),
      ].filter(Boolean),
    ),
  ];
  let fx: DashboardFxOptions | undefined;
  if (moneyCurrencies.length > 1) {
    const hh = state as HouseholdInvestorState;
    const treasury = getTreasury(hh);
    if (treasury == null) {
      throw new Error(
        `Cannot sum dashboard money across currencies (${moneyCurrencies.join(', ')}). ` +
          'Set treasury.reporting_currency (set_treasury) so totals convert with live FX.',
      );
    }
    const rep = treasury.reporting_currency;
    const rates = await fetchFxRates(moneyCurrencies, rep);
    fx = { reportingCurrency: rep, fxRates: rates };
  }

  const live = buildLivePositions(
    valuedPortfolio,
    prices,
    optionMarks,
    cashes.length > 0
      ? cashes.map((c) => ({
          amount: c.amount,
          currency: c.currency,
          channel: c.channel,
        }))
      : null,
    deposits.length > 0
      ? deposits.map((d) => ({
          id: d.id,
          amount: d.amount,
          interest: d.interest,
          currency: d.currency,
          start_date: d.start_date,
          end_date: d.end_date,
          channel: d.channel,
          label: d.label,
        }))
      : null,
    undefined,
    fx,
  );
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
