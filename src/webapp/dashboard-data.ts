/**
 * Load a live portfolio dashboard model for a user slug.
 * Used by the WebUI domain API (dynamic tab) — same math as the HTML report.
 *
 * Dashboard loads are **resilient**: data issues become `warnings` / model.live.issues
 * rather than a hard 500. Market prices are never invented — unpriced equities use
 * book cost with an explicit warning.
 */

import { loadInvestor } from '../state/investor-store.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import type { BrokerConnectionMetrics } from '../state/portfolio-state.js';
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
  getReportingCurrency,
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
import { readProductProfile, type ProductProfileId } from '../agents/roster.js';
import { productDisplayName } from '../product-name.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';
import { openOptionTradeDetails, type OpenOptionTradeDetail } from './option-dashboard-data.js';

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
  /** Live equity and option-underlying quotes used for the assignment radar. Omit when none. */
  equityPrices?: Record<string, number>;
  /** Optional margin snapshot keyed by holding channel. Omit when none recorded. */
  connectionMetrics?: Record<string, BrokerConnectionMetrics>;
  /** Broker statement dates keyed by holding channel. */
  brokerAsOf?: Record<string, string>;
  /** Opening fills matched to the current open lots; absent means unverified. */
  optionTradeDetails?: Record<string, OpenOptionTradeDetail>;
  /** Recorded short-option cash flow, never inferred from position cost basis. */
  premiumJournal?: {
    available: boolean;
    daily: ReturnType<typeof buildExecutionJournal>['daily'];
    channels: string[];
  };
  /** Channels whose broker connector supplies option executions. */
  premiumSupportedChannels?: string[];
  /** Env product profile — copy/section gates. Not a books field. */
  productProfile: ProductProfileId;
  /** UTARUS_AGENT_NAME. */
  productName: string;
}

function productMeta(): { productProfile: ProductProfileId; productName: string } {
  return {
    productProfile: readProductProfile(),
    productName: productDisplayName(),
  };
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
    state = (await loadInvestor(slug)).state;
  } catch (e) {
    throw e; // auth / missing user still hard-fails
  }

  const portfolio = getPortfolio(state);
  const deposits = getDeposits(state);
  const cashes = getCashes(state);
  const displayName = state.profile.display_name;
  const tickers = Object.keys(portfolio);

  let snapshots: Snapshot[] = [];
  try {
    snapshots = loadSnapshots(slug);
  } catch (e) {
    warnings.push({ code: 'snapshot_load_failed',
      message: e instanceof Error ? e.message : String(e), severity: 'warning' });
  }

  if (tickers.length === 0 && deposits.length === 0 && cashes.length === 0 && snapshots.length === 0) {
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
      ...productMeta(),
    };
  }

  const market = await resolveMarketResilient(portfolio, priceOverride);
  warnings.push(...market.issues);
  // Options can exist without a share position. Fetch their underlyings as well
  // so the assignment radar can score those contracts from an actual quote.
  if (!priceOverride) {
    const optionUnderlyings = [...new Set(Object.values(portfolio)
      .filter((holding) => holding.instrument === 'option' && holding.option?.underlying)
      .map((holding) => holding.option!.underlying.trim().toUpperCase()))]
      .filter((symbol) => market.prices[symbol] == null);
    if (optionUnderlyings.length > 0) {
      try {
        Object.assign(market.prices, await fetchPrices(optionUnderlyings));
      } catch (error) {
        warnings.push({
          code: 'option_underlying_quote_failed',
          message: error instanceof Error ? error.message : String(error),
          severity: 'warning',
        });
      }
    }
  }

  const moneyCurrencies = [
    ...new Set(
      [
        ...Object.values(portfolio).map((holding) => holding.currency?.trim().toUpperCase()),
        ...cashes.filter((c) => c.amount !== 0).map((c) => c.currency.trim().toUpperCase()),
        ...deposits.filter((d) => d.amount !== 0).map((d) => d.currency.trim().toUpperCase()),
      ].filter((currency): currency is string => !!currency),
    ),
  ];
  let fx: DashboardFxOptions | undefined;
  const reportingCurrency = getReportingCurrency(state as HouseholdInvestorState);
  try {
    const rep = reportingCurrency;
    const foreign = moneyCurrencies.filter((currency) => currency !== rep);
    const rates = foreign.length > 0 ? await fetchFxRates(foreign, rep) : {};
    fx = { reportingCurrency: rep, fxRates: rates };
  } catch (e) {
    warnings.push({
      code: 'fx_fetch_failed',
      message:
        (e instanceof Error ? e.message : String(e)) +
        ' NAV is unavailable until FX succeeds.',
      severity: 'warning',
    });
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
      { resilient: true, reportingCurrency },
    );
    for (const position of live.positions) {
      const stored = portfolio[position.ticker];
      if (position.instrument === 'option' && stored?.option) {
        position.brokerMark = stored.option.mark;
      }
      if (stored?.currency) position.currency = stored.currency;
    }
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

  const model = buildDashboardModel(live, snapshots);
  let benchmark: BenchmarkData | null = null;
  try {
    benchmark =
      benchmarkOverride !== undefined ? benchmarkOverride : await loadBenchmark(snapshots);
  } catch {
    benchmark = null;
  }

  let connectionMetrics: Record<string, BrokerConnectionMetrics> | undefined;
  let brokerAsOf: Record<string, string> | undefined;
  let premiumSupportedChannels: string[] = [];
  const accountsByChannel: Record<string, string> = {};
  try {
    const conns = readBrokerAccountModel(state).connections;
    const mapped: Record<string, BrokerConnectionMetrics> = {};
    const dates: Record<string, string> = {};
    const recordDate = (channel: string, date?: string | null) => {
      if (date && (!dates[channel] || date > dates[channel])) dates[channel] = date;
    };
    for (const [id, conn] of Object.entries(conns)) {
      if (conn.account_id) accountsByChannel[conn.channel] = conn.account_id;
      if (['ibkr', 'moomoo', 'tiger'].includes(conn.broker_id)) premiumSupportedChannels.push(conn.channel);
      if (conn.last_sync?.ok) recordDate(conn.channel, conn.last_sync.as_of);
      const previous = latestSuccessfulBrokerSyncRun(slug, conn.channel);
      recordDate(conn.channel, previous?.as_of);
      if (conn.metrics == null) continue;
      const ch = conn.channel;
      mapped[ch] = conn.metrics;
    }
    for (const observation of state.option_observations ?? []) {
      if (observation.source !== 'broker') continue;
      recordDate(observation.channel, observation.as_of);
    }
    // Legacy account channels may have a broker sync log but no newer option observation.
    // Keep their last confirmed statement date visible instead of implying today's positions.
    for (const position of live.positions) {
      if (position.instrument !== 'option' || dates[position.channel]) continue;
      const logged = [...state.log].reverse().find(row =>
        row.action === 'broker_sync' && row.connector_id === position.channel && row.ts);
      if (logged?.ts) dates[position.channel] = logged.ts;
    }
    if (Object.keys(mapped).length > 0) connectionMetrics = mapped;
    if (Object.keys(dates).length > 0) brokerAsOf = dates;
  } catch (e) {
    warnings.push({
      code: 'connection_metrics_unread',
      message:
        (e instanceof Error ? e.message : String(e)) +
        ' Margin / buying-power cards will show unknown.',
      severity: 'warning',
    });
  }

  const journal = buildExecutionJournal(state.option_executions);
  const out: DashboardPayload = {
    slug,
    displayName,
    generatedAt,
    empty: false,
    model,
    benchmark,
    warnings: model.live.issues,
    optionTradeDetails: openOptionTradeDetails(portfolio, state.option_executions, accountsByChannel, state.option_events),
    premiumJournal: { available: journal.available, daily: journal.daily,
      channels: [...new Set(journal.executions.map(row => row.channel))] },
    premiumSupportedChannels,
    ...productMeta(),
  };
  if (Object.keys(market.prices).length > 0) out.equityPrices = market.prices;
  if (connectionMetrics) out.connectionMetrics = connectionMetrics;
  if (brokerAsOf) out.brokerAsOf = brokerAsOf;
  return out;
}
