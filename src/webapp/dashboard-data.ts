/**
 * Load a live portfolio dashboard model for a user slug.
 * Used by the WebUI domain API (dynamic tab) — same math as the HTML report.
 *
 * Dashboard loads are **resilient**: data issues become `warnings` / model.live.issues
 * rather than a hard 500. Market prices are never invented — unpriced equities use
 * book cost with an explicit warning.
 */

import { loadState } from 'utarus';
import {
  equityQuoteSymbols,
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
  type DashboardIssue,
  type DashboardModel,
} from '../report/dashboard-model.js';
import type { Holding } from '../market/types.js';
import type { OptionLiveMark } from '../market/fetch-option-marks.js';

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
  /**
   * Non-fatal load issues (also mirrored on model.live.issues when model present).
   * UI shows a banner; NAV may exclude unpriced cash or use book cost for marks.
   */
  warnings?: DashboardIssue[];
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

async function resolveMarketResilient(
  portfolio: Record<string, Holding>,
  priceOverride?: Record<string, number>,
): Promise<{
  valuedPortfolio: Record<string, Holding>;
  prices: Record<string, number>;
  optionMarks: Record<string, OptionLiveMark>;
  issues: DashboardIssue[];
}> {
  const issues: DashboardIssue[] = [];
  if (Object.keys(portfolio).length === 0) {
    return { valuedPortfolio: {}, prices: {}, optionMarks: {}, issues };
  }

  if (priceOverride) {
    try {
      const resolved = await resolvePortfolioMarket(portfolio);
      return {
        valuedPortfolio: resolved.portfolio,
        prices: priceOverride,
        optionMarks: resolved.optionMarks,
        issues,
      };
    } catch (e) {
      issues.push({
        code: 'option_mark_failed',
        message: e instanceof Error ? e.message : String(e),
        severity: 'warning',
      });
      return {
        valuedPortfolio: portfolio,
        prices: priceOverride,
        optionMarks: {},
        issues,
      };
    }
  }

  try {
    const resolved = await resolvePortfolioMarket(portfolio);
    return {
      valuedPortfolio: resolved.portfolio,
      prices: resolved.equityPrices,
      optionMarks: resolved.optionMarks,
      issues,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    issues.push({
      code: 'market_resolve_failed',
      message: `${msg} Falling back to equity quotes only (option marks use stored values).`,
      severity: 'warning',
    });
    try {
      const symbols = equityQuoteSymbols(portfolio);
      const prices =
        symbols.length > 0 ? await fetchPrices(symbols) : ({} as Record<string, number>);
      return {
        valuedPortfolio: portfolio,
        prices,
        optionMarks: {},
        issues,
      };
    } catch (e2) {
      issues.push({
        code: 'price_fetch_failed',
        message: e2 instanceof Error ? e2.message : String(e2),
        severity: 'error',
      });
      return {
        valuedPortfolio: portfolio,
        prices: {},
        optionMarks: {},
        issues,
      };
    }
  }
}

/**
 * Build dashboard JSON for a user.
 * Empty portfolio → empty:true.
 * Data problems → warnings + partial model (never invent market prices).
 */
export async function loadDashboardForSlug(
  slug: string,
  priceOverride?: Record<string, number>,
  benchmarkOverride?: BenchmarkData | null,
): Promise<DashboardPayload> {
  const warnings: DashboardIssue[] = [];
  const generatedAt = new Date().toISOString();

  let state: InvestorState;
  try {
    state = loadState(slug) as InvestorState;
  } catch (e) {
    throw e; // auth / missing user still hard-fails
  }

  const portfolio = getPortfolio(state);
  const deposits = getDeposits(state);
  const displayName = state.profile.display_name;
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
      warnings: [],
    };
  }

  const market = await resolveMarketResilient(portfolio, priceOverride);
  warnings.push(...market.issues);

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
      warnings.push({
        code: 'mixed_currency_no_reporting',
        message:
          `Multiple currencies (${moneyCurrencies.join(', ')}) without treasury.reporting_currency. ` +
          'Set set_treasury reporting_currency so cash/deposits convert with live FX. ' +
          'Positions still shown; multi-ccy cash/deposits may be excluded from NAV.',
        severity: 'warning',
      });
    } else {
      try {
        const rep = treasury.reporting_currency;
        const rates = await fetchFxRates(moneyCurrencies, rep);
        fx = { reportingCurrency: rep, fxRates: rates };
      } catch (e) {
        warnings.push({
          code: 'fx_fetch_failed',
          message:
            (e instanceof Error ? e.message : String(e)) +
            ' Multi-currency cash/deposits excluded from NAV until FX succeeds.',
          severity: 'warning',
        });
      }
    }
  }

  let live;
  try {
    live = buildLivePositions(
      market.valuedPortfolio,
      market.prices,
      market.optionMarks,
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
      { resilient: true },
    );
  } catch (e) {
    // Last-resort: still return something usable
    warnings.push({
      code: 'live_build_failed',
      message: e instanceof Error ? e.message : String(e),
      severity: 'error',
    });
    live = buildLivePositions({}, {}, {}, null, null, undefined, undefined, {
      resilient: true,
    });
    live.issues = [...warnings];
  }

  // Merge outer warnings into live issues
  const mergedIssues = [...(live.issues ?? [])];
  for (const w of warnings) {
    if (!mergedIssues.some((i) => i.code === w.code && i.message === w.message)) {
      mergedIssues.push(w);
    }
  }
  live.issues = mergedIssues;

  let snapshots: Snapshot[] = [];
  try {
    snapshots = loadSnapshots(slug);
  } catch (e) {
    live.issues.push({
      code: 'snapshot_load_failed',
      message: e instanceof Error ? e.message : String(e),
      severity: 'warning',
    });
  }

  const model = buildDashboardModel(live, snapshots);
  let benchmark: BenchmarkData | null = null;
  try {
    benchmark =
      benchmarkOverride !== undefined ? benchmarkOverride : await loadBenchmark(snapshots);
  } catch {
    benchmark = null;
  }

  return {
    slug,
    displayName,
    generatedAt,
    empty: false,
    model,
    benchmark,
    warnings: model.live.issues,
  };
}
