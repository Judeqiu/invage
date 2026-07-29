import type { FundSpec, Holding, InstrumentKind, OptionSpec } from '../market/types.js';
import type { OptionLiveMark } from '../market/fetch-option-marks.js';
import { valuePortfolio, type PositionEconomics } from '../market/position-value.js';
import type { Snapshot, SnapshotPosition } from '../state/snapshot.js';

/**
 * Channel used when a holding or cash has no broker tag.
 * Historical data without `channel` is treated as this dimension value.
 */
export const DEFAULT_CHANNEL = 'default';

/** View key for combined multi-broker portfolio (all channels). */
export const MERGED_CHANNEL_VIEW = 'merged';

/**
 * Resolve storage channel → dashboard dimension value.
 * Missing / empty / whitespace → `default` (never invent a broker name).
 */
export function resolveDashboardChannel(raw: string | null | undefined): string {
  if (raw == null) return DEFAULT_CHANNEL;
  const t = String(raw).trim();
  return t.length === 0 ? DEFAULT_CHANNEL : t;
}

export interface LivePosition {
  ticker: string;
  /** Human label (option description or ticker). */
  label: string;
  units: number;
  avgCost: number;
  price: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  weightPct: number;
  instrument: InstrumentKind;
  option?: OptionSpec;
  fund?: FundSpec;
  premiumAbsolute: number;
  contingentCashObligation: number;
  contingentShareObligation: number;
  category: string;
  /**
   * Broker / custody dimension. Always set on the dashboard model —
   * unassigned storage values become {@link DEFAULT_CHANNEL}.
   */
  channel: string;
  /** Option / fund: where the mark came from. */
  markSource?: 'manual' | 'yahoo';
  markNote?: string;
  contractSymbol?: string;
}

/** Fixed deposit row on the live dashboard (principal in NAV; interest display-only). */
export interface DepositRow {
  id: string;
  label?: string;
  /** Resolved channel; unassigned → {@link DEFAULT_CHANNEL}. */
  channel: string;
  amount: number;
  interest: number;
  currency: string;
  start_date: string;
  end_date: string;
  daysRemaining: number;
  matured: boolean;
}

/** Aggregates for one broker channel (or for the full merged set). */
export interface ChannelTotals {
  channel: string;
  positionCount: number;
  equityCount: number;
  optionCount: number;
  fundCount: number;
  positionsValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  /** Cash included only when it belongs to this channel (or in merged totals). */
  cashAmount: number | null;
  cashCurrency: string | null;
  /** Sum of deposit principals in this slice; 0 when none. */
  depositsAmount: number;
  depositsCurrency: string | null;
  depositCount: number;
  /** positionsValue + cash? + depositsAmount. */
  totalValue: number;
  cashWeightPct: number | null;
  equityValue: number;
  equityCost: number;
  optionsPremiumCollected: number;
  optionsPremiumPaid: number;
  contingentCashObligation: number;
  contingentShareObligation: number;
}

export interface HistoryRow {
  date: string;
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  /** Null on the first history row (no prior snapshot). */
  deltaValue: number | null;
  deltaPct: number | null;
  /** Per-position detail from the snapshot (drives archive-date rendering). */
  positions: SnapshotPosition[];
  equityValue?: number;
  equityCost?: number;
  contingentCashObligation?: number;
  optionsPremiumCollected?: number;
  optionsPremiumPaid?: number;
  cashAmount?: number;
  cashCurrency?: string;
  cashChannel?: string;
  positionsValue?: number;
}

export interface PeriodChange {
  fromDate: string;
  toDate: string;
  deltaValue: number;
  deltaPct: number;
}

export interface LiveDashboardSlice {
  positions: LivePosition[];
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  positionCount: number;
  equityValue: number;
  equityCost: number;
  optionsPremiumCollected: number;
  optionsPremiumPaid: number;
  contingentCashObligation: number;
  contingentShareObligation: number;
  optionCount: number;
  equityCount: number;
  fundCount: number;
  cashAmount: number | null;
  cashCurrency: string | null;
  /**
   * Resolved cash channel when cash is recorded; null when cash unknown.
   * Unassigned cash → {@link DEFAULT_CHANNEL}.
   */
  cashChannel: string | null;
  positionsValue: number;
  cashWeightPct: number | null;
  /** Fixed deposits in this slice (principal in NAV). */
  deposits: DepositRow[];
  depositsAmount: number;
  depositsCurrency: string | null;
  depositCount: number;
  /**
   * Distinct channels present in this portfolio (positions + cash + deposits), sorted.
   * Unassigned items appear as {@link DEFAULT_CHANNEL}.
   */
  channels: string[];
  /** Per-channel aggregates (one entry per id in `channels`). */
  byChannel: ChannelTotals[];
  /** Currency of aggregated totals when FX applied; single-book ccy otherwise. */
  reportingCurrency?: string | null;
  /** Live FX rates applied (foreign → reporting); omit/empty when not converted. */
  fxRates?: Record<string, number>;
  /** True when multi-currency totals were converted with live FX. */
  fxApplied?: boolean;
}

export interface DashboardModel {
  live: LiveDashboardSlice;
  history: HistoryRow[];
  /** Null when fewer than 2 snapshots. */
  periodChange: PeriodChange | null;
  lastSnapshot: { date: string; totalValue: number } | null;
}

function economicsToLive(
  e: PositionEconomics,
  weightPct: number,
  markMeta?: OptionLiveMark,
): LivePosition {
  const fundMarkSource =
    e.instrument === 'fund' && e.fund != null ? e.fund.quote_source : undefined;
  return {
    ticker: e.key,
    label: e.label,
    units: e.units,
    avgCost: e.avgCost,
    price: e.price,
    cost: e.cost,
    value: e.value,
    pl: e.pl,
    plPct: e.plPct,
    weightPct,
    instrument: e.instrument,
    option: e.option,
    fund: e.fund,
    premiumAbsolute: e.premiumAbsolute,
    contingentCashObligation: e.contingentCashObligation,
    contingentShareObligation: e.contingentShareObligation,
    category: e.category,
    channel: resolveDashboardChannel(e.channel),
    markSource: markMeta?.source ?? fundMarkSource,
    markNote: markMeta?.note,
    contractSymbol: markMeta?.contractSymbol,
  };
}

/** Unique sorted channel ids from positions + cash + deposit channel(s). */
export function collectDashboardChannels(
  positions: Array<{ channel?: string | null }>,
  cashChannels: Array<string | null | undefined> | string | null,
  depositChannels: Array<string | null | undefined> = [],
): string[] {
  const set = new Set<string>();
  for (const p of positions) {
    set.add(resolveDashboardChannel(p.channel));
  }
  const list = Array.isArray(cashChannels)
    ? cashChannels
    : cashChannels != null
      ? [cashChannels]
      : [];
  for (const ch of list) {
    if (ch != null) set.add(resolveDashboardChannel(ch));
  }
  for (const ch of depositChannels) {
    if (ch != null) set.add(resolveDashboardChannel(ch));
  }
  return [...set].sort((a, b) => {
    if (a === DEFAULT_CHANNEL) return -1;
    if (b === DEFAULT_CHANNEL) return 1;
    return a.localeCompare(b);
  });
}

function depositDaysRemaining(endDate: string, today: string): number {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) {
    throw new Error(`Invalid deposit date: end=${endDate} today=${today}`);
  }
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

/** Map storage deposits → dashboard DepositRow[] (channel resolved). */
export function toDepositRows(
  deposits:
    | Array<{
        id: string;
        amount: number;
        interest: number;
        currency: string;
        start_date: string;
        end_date: string;
        channel?: string;
        label?: string;
      }>
    | null
    | undefined,
  today: string = new Date().toISOString().slice(0, 10),
): DepositRow[] {
  if (deposits == null || deposits.length === 0) return [];
  return deposits.map((d) => {
    const channel = resolveDashboardChannel(d.channel);
    const matured = d.end_date < today;
    return {
      id: d.id,
      ...(d.label != null && d.label.length > 0 ? { label: d.label } : {}),
      channel,
      amount: d.amount,
      interest: d.interest,
      currency: d.currency,
      start_date: d.start_date,
      end_date: d.end_date,
      daysRemaining: depositDaysRemaining(d.end_date, today),
      matured,
    };
  });
}

export interface DashboardFxOptions {
  reportingCurrency: string;
  /** Units of reporting per 1 unit of foreign currency. */
  fxRates: Record<string, number>;
}

function convertDashboardAmount(
  amount: number,
  currency: string,
  opts: DashboardFxOptions | undefined,
  context: string,
): { amount: number; currency: string } {
  const ccy = currency.trim().toUpperCase();
  if (opts == null) return { amount, currency: ccy };
  const rep = opts.reportingCurrency.trim().toUpperCase();
  if (ccy === rep) return { amount, currency: rep };
  const rate = opts.fxRates[ccy];
  if (rate == null) {
    throw new Error(
      `Missing FX rate for ${ccy}→${rep} (${context}). Provide live rate units of ${rep} per 1 ${ccy}.`,
    );
  }
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new Error(`Invalid FX rate for ${ccy}→${rep}: ${rate}`);
  }
  return { amount: amount * rate, currency: rep };
}

/** Sum deposit principals (same currency, or converted when opts provided). */
function depositsPrincipalSum(
  deposits: DepositRow[],
  opts?: DashboardFxOptions,
): { amount: number; currency: string } | null {
  if (deposits.length === 0) return null;
  const currencies = [...new Set(deposits.map((d) => d.currency.trim().toUpperCase()))];
  if (currencies.length === 1 && opts == null) {
    return {
      amount: deposits.reduce((s, d) => s + d.amount, 0),
      currency: currencies[0],
    };
  }
  if (opts == null && currencies.length > 1) {
    throw new Error(
      `Cannot sum dashboard deposits across currencies (${deposits.map((x) => x.currency).join(', ')}). ` +
        'Set treasury.reporting_currency for live FX conversion.',
    );
  }
  let amount = 0;
  let currency = opts!.reportingCurrency.trim().toUpperCase();
  for (const d of deposits) {
    const conv = convertDashboardAmount(d.amount, d.currency, opts, `deposit ${d.id}`);
    amount += conv.amount;
    currency = conv.currency;
  }
  return { amount, currency };
}

/** Normalize cash arg (single | multi | null) → list of balances. */
function normalizeDashboardCashes(
  cash?:
    | { amount: number; currency: string; channel?: string }
    | Array<{ amount: number; currency: string; channel?: string }>
    | null,
): Array<{ amount: number; currency: string; channel: string }> {
  if (cash == null) return [];
  const list = Array.isArray(cash) ? cash : [cash];
  return list.map((c) => ({
    amount: c.amount,
    currency: c.currency,
    channel: resolveDashboardChannel(c.channel),
  }));
}

/** Sum cash for a channel (or all when channel is null = merged). Mixed ccy needs opts. */
function cashForChannelSlice(
  cashes: Array<{ amount: number; currency: string; channel: string }>,
  channel: string | null,
  opts?: DashboardFxOptions,
): { amount: number; currency: string } | null {
  const subset =
    channel == null ? cashes : cashes.filter((c) => c.channel === channel);
  if (subset.length === 0) return null;
  const currencies = [...new Set(subset.map((c) => c.currency.trim().toUpperCase()))];
  if (currencies.length === 1 && opts == null) {
    return {
      amount: subset.reduce((s, c) => s + c.amount, 0),
      currency: currencies[0],
    };
  }
  if (opts == null && currencies.length > 1) {
    throw new Error(
      `Cannot sum dashboard cash across currencies (${subset.map((x) => x.currency).join(', ')}). ` +
        'Set treasury.reporting_currency for live FX conversion.',
    );
  }
  let amount = 0;
  let currency = opts
    ? opts.reportingCurrency.trim().toUpperCase()
    : currencies[0];
  for (const c of subset) {
    const conv = convertDashboardAmount(
      c.amount,
      c.currency,
      opts,
      `cash ${c.channel}`,
    );
    amount += conv.amount;
    currency = conv.currency;
  }
  return { amount, currency };
}

/**
 * Aggregate positions (already channel-resolved) plus optional cash + deposits into totals.
 * Cash is included only when `includeCash` is true.
 * Deposit principal always counts in totalValue when present.
 */
export function buildChannelTotals(
  channel: string,
  positions: LivePosition[],
  cash: { amount: number; currency: string } | null,
  includeCash: boolean,
  deposits: DepositRow[] = [],
  fx?: DashboardFxOptions,
): ChannelTotals {
  let positionsValue = 0;
  let totalCost = 0;
  let equityValue = 0;
  let equityCost = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  let contingentCashObligation = 0;
  let contingentShareObligation = 0;
  let optionCount = 0;
  let equityCount = 0;
  let fundCount = 0;

  for (const p of positions) {
    positionsValue += p.value;
    totalCost += p.cost;
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += p.contingentCashObligation;
      contingentShareObligation += p.contingentShareObligation;
      if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute;
      else optionsPremiumPaid += p.premiumAbsolute;
    } else if (p.instrument === 'fund') {
      fundCount += 1;
      // Fund MTM counts in non-option asset value (NAV equity leg).
      equityValue += p.value;
      equityCost += p.cost;
    } else {
      equityCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    }
  }

  const totalPL = positionsValue - totalCost;
  const cashAmount = includeCash && cash != null ? cash.amount : null;
  const cashCurrency = includeCash && cash != null ? cash.currency : null;
  const depSum = depositsPrincipalSum(deposits, fx);
  const depositsAmount = depSum?.amount ?? 0;
  const depositsCurrency = depSum?.currency ?? null;
  let totalValue = positionsValue;
  if (cashAmount != null) totalValue += cashAmount;
  totalValue += depositsAmount;
  const cashWeightPct =
    cashAmount != null && totalValue !== 0
      ? (cashAmount / totalValue) * 100
      : cashAmount != null
        ? 0
        : null;

  return {
    channel,
    positionCount: positions.length,
    equityCount,
    optionCount,
    fundCount,
    positionsValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    cashAmount,
    cashCurrency,
    depositsAmount,
    depositsCurrency,
    depositCount: deposits.length,
    totalValue,
    cashWeightPct,
    equityValue,
    equityCost,
    optionsPremiumCollected,
    optionsPremiumPaid,
    contingentCashObligation,
    contingentShareObligation,
  };
}

function withRecalculatedWeights(
  positions: LivePosition[],
  cashAmount: number | null,
  depositsAmount: number = 0,
): LivePosition[] {
  const absPositions = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum =
    absPositions + (cashAmount != null ? cashAmount : 0) + depositsAmount;
  return positions
    .map((p) => ({
      ...p,
      weightPct: absSum > 0 ? (Math.abs(p.value) / absSum) * 100 : 0,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/**
 * Filter a live dashboard slice to one channel, or return merged (all) when
 * `channel` is {@link MERGED_CHANNEL_VIEW}.
 * Weights are recomputed within the filtered set.
 * Per-channel cash comes from {@link LiveDashboardSlice.byChannel}.
 */
export function filterLiveByChannel(
  live: LiveDashboardSlice,
  channel: string,
): LiveDashboardSlice {
  if (channel === MERGED_CHANNEL_VIEW) {
    return live;
  }

  const filtered = live.positions.filter((p) => p.channel === channel);
  const deposits = (live.deposits ?? []).filter((d) => d.channel === channel);
  const chRow = live.byChannel.find((c) => c.channel === channel);
  const cash =
    chRow != null && chRow.cashAmount != null && chRow.cashCurrency != null
      ? { amount: chRow.cashAmount, currency: chRow.cashCurrency }
      : null;

  // Prefer precomputed channel totals when FX was applied (cash/deposits already converted).
  if (live.fxApplied && chRow != null) {
    const positions = withRecalculatedWeights(
      filtered,
      chRow.cashAmount,
      chRow.depositsAmount,
    );
    return {
      positions,
      totalValue: chRow.totalValue,
      totalCost: chRow.totalCost,
      totalPL: chRow.totalPL,
      totalPLPct: chRow.totalPLPct,
      positionCount: chRow.positionCount,
      equityValue: chRow.equityValue,
      equityCost: chRow.equityCost,
      optionsPremiumCollected: chRow.optionsPremiumCollected,
      optionsPremiumPaid: chRow.optionsPremiumPaid,
      contingentCashObligation: chRow.contingentCashObligation,
      contingentShareObligation: chRow.contingentShareObligation,
      optionCount: chRow.optionCount,
      equityCount: chRow.equityCount,
      fundCount: chRow.fundCount,
      cashAmount: chRow.cashAmount,
      cashCurrency: chRow.cashCurrency,
      cashChannel: cash != null ? channel : null,
      positionsValue: chRow.positionsValue,
      cashWeightPct: chRow.cashWeightPct,
      deposits,
      depositsAmount: chRow.depositsAmount,
      depositsCurrency: chRow.depositsCurrency,
      depositCount: chRow.depositCount,
      channels: live.channels,
      byChannel: live.byChannel,
      reportingCurrency: live.reportingCurrency,
      fxRates: live.fxRates,
      fxApplied: live.fxApplied,
    };
  }

  const totals = buildChannelTotals(channel, filtered, cash, cash != null, deposits);
  const positions = withRecalculatedWeights(
    filtered,
    totals.cashAmount,
    totals.depositsAmount,
  );

  return {
    positions,
    totalValue: totals.totalValue,
    totalCost: totals.totalCost,
    totalPL: totals.totalPL,
    totalPLPct: totals.totalPLPct,
    positionCount: totals.positionCount,
    equityValue: totals.equityValue,
    equityCost: totals.equityCost,
    optionsPremiumCollected: totals.optionsPremiumCollected,
    optionsPremiumPaid: totals.optionsPremiumPaid,
    contingentCashObligation: totals.contingentCashObligation,
    contingentShareObligation: totals.contingentShareObligation,
    optionCount: totals.optionCount,
    equityCount: totals.equityCount,
    fundCount: totals.fundCount,
    cashAmount: totals.cashAmount,
    cashCurrency: totals.cashCurrency,
    cashChannel: cash != null ? channel : null,
    positionsValue: totals.positionsValue,
    cashWeightPct: totals.cashWeightPct,
    deposits,
    depositsAmount: totals.depositsAmount,
    depositsCurrency: totals.depositsCurrency,
    depositCount: totals.depositCount,
    channels: live.channels,
    byChannel: live.byChannel,
    reportingCurrency: live.reportingCurrency,
    fxRates: live.fxRates,
    fxApplied: live.fxApplied,
  };
}

/**
 * Build live positions from portfolio + equity prices.
 * Option positions use option.mark on the holding (apply Yahoo marks before calling).
 * Pass optionMarks to annotate source on LivePosition.
 * Fails if portfolio empty (and no deposits) or any equity ticker lacks a price.
 *
 * Missing holding/cash/deposit `channel` is normalized to {@link DEFAULT_CHANNEL}.
 * Cash may be a single balance or an array (one per broker channel).
 * Fixed deposits: principal in totalValue; not free cash.
 */
export function buildLivePositions(
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
  optionMarks?: Record<string, OptionLiveMark>,
  cash?:
    | { amount: number; currency: string; channel?: string }
    | Array<{ amount: number; currency: string; channel?: string }>
    | null,
  deposits?:
    | Array<{
        id: string;
        amount: number;
        interest: number;
        currency: string;
        start_date: string;
        end_date: string;
        channel?: string;
        label?: string;
      }>
    | null,
  today?: string,
  fx?: DashboardFxOptions,
): LiveDashboardSlice {
  const depositRows = toDepositRows(deposits ?? null, today);
  const hasPositions = Object.keys(portfolio).length > 0;
  if (!hasPositions && depositRows.length === 0) {
    // Preserve fail-fast from valuePortfolio for empty book with nothing to show.
    valuePortfolio(portfolio, prices);
  }

  const economics = hasPositions ? valuePortfolio(portfolio, prices) : [];
  const cashes = normalizeDashboardCashes(cash ?? null);

  const moneyCurrencies = [
    ...new Set([
      ...cashes.map((c) => c.currency.trim().toUpperCase()),
      ...depositRows.map((d) => d.currency.trim().toUpperCase()),
    ]),
  ];
  const needsFx = moneyCurrencies.length > 1;
  if (needsFx && fx == null) {
    throw new Error(
      `Cannot sum dashboard money across currencies (${moneyCurrencies.join(', ')}). ` +
        'Set treasury.reporting_currency so totals convert with live FX.',
    );
  }
  const fxOpts = needsFx ? fx : undefined;
  const fxApplied = needsFx && fx != null;

  const mergedCash = cashForChannelSlice(cashes, null, fxOpts);
  const cashAmount = mergedCash?.amount ?? null;
  const cashCurrency = mergedCash?.currency ?? null;
  // Single cash channel is exposed on the slice; multi → null (see byChannel).
  const cashChannel =
    cashes.length === 1 ? cashes[0].channel : cashes.length > 1 ? null : null;

  const depSum = depositsPrincipalSum(depositRows, fxOpts);
  const depositsAmount = depSum?.amount ?? 0;

  const absPositions = economics.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum =
    absPositions + (cashAmount != null ? cashAmount : 0) + depositsAmount;

  const positions: LivePosition[] = economics
    .map((e) =>
      economicsToLive(
        e,
        absSum > 0 ? (Math.abs(e.value) / absSum) * 100 : 0,
        optionMarks?.[e.key],
      ),
    )
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const channels = collectDashboardChannels(
    positions,
    cashes.map((c) => c.channel),
    depositRows.map((d) => d.channel),
  );

  const byChannel: ChannelTotals[] = channels.map((ch) => {
    const chPositions = positions.filter((p) => p.channel === ch);
    const chCash = cashForChannelSlice(cashes, ch, fxOpts);
    const chDeposits = depositRows.filter((d) => d.channel === ch);
    return buildChannelTotals(
      ch,
      chPositions,
      chCash,
      chCash != null,
      chDeposits,
      fxOpts,
    );
  });

  const merged = buildChannelTotals(
    MERGED_CHANNEL_VIEW,
    positions,
    mergedCash,
    mergedCash != null,
    depositRows,
    fxOpts,
  );

  const reportingCurrency = fxApplied
    ? fx!.reportingCurrency.trim().toUpperCase()
    : moneyCurrencies.length === 1
      ? moneyCurrencies[0]
      : cashCurrency ?? depSum?.currency ?? null;

  return {
    positions,
    totalValue: merged.totalValue,
    totalCost: merged.totalCost,
    totalPL: merged.totalPL,
    totalPLPct: merged.totalPLPct,
    positionCount: merged.positionCount,
    equityValue: merged.equityValue,
    equityCost: merged.equityCost,
    optionsPremiumCollected: merged.optionsPremiumCollected,
    optionsPremiumPaid: merged.optionsPremiumPaid,
    contingentCashObligation: merged.contingentCashObligation,
    contingentShareObligation: merged.contingentShareObligation,
    optionCount: merged.optionCount,
    equityCount: merged.equityCount,
    fundCount: merged.fundCount,
    cashAmount: merged.cashAmount,
    cashCurrency: merged.cashCurrency,
    cashChannel,
    positionsValue: merged.positionsValue,
    cashWeightPct: merged.cashWeightPct,
    deposits: depositRows,
    depositsAmount: merged.depositsAmount,
    depositsCurrency: merged.depositsCurrency,
    depositCount: merged.depositCount,
    channels,
    byChannel,
    reportingCurrency,
    fxRates: fxApplied ? { ...fx!.fxRates } : undefined,
    fxApplied: fxApplied || false,
  };
}

/** Pure: join live totals with snapshot history into a dashboard model. */
export function buildDashboardModel(
  live: LiveDashboardSlice,
  snapshots: Snapshot[],
): DashboardModel {
  const history: HistoryRow[] = snapshots.map((snap, i) => {
    const positions = snap.positions.map((p) => ({
      ...p,
      channel: resolveDashboardChannel(p.channel),
    }));
    const base: Omit<HistoryRow, 'deltaValue' | 'deltaPct'> = {
      date: snap.date,
      totalValue: snap.totalValue,
      totalCost: snap.totalCost,
      totalPL: snap.totalPL,
      totalPLPct: snap.totalPLPct,
      positions,
      equityValue: snap.equityValue,
      equityCost: snap.equityCost,
      contingentCashObligation: snap.contingentCashObligation,
      optionsPremiumCollected: snap.optionsPremiumCollected,
      optionsPremiumPaid: snap.optionsPremiumPaid,
      cashAmount: snap.cashAmount,
      cashCurrency: snap.cashCurrency,
      cashChannel:
        snap.cashAmount != null
          ? resolveDashboardChannel(snap.cashChannel)
          : undefined,
      positionsValue: snap.positionsValue,
    };
    if (i === 0) {
      return {
        ...base,
        deltaValue: null,
        deltaPct: null,
      };
    }
    const prev = snapshots[i - 1];
    const deltaValue = snap.totalValue - prev.totalValue;
    const deltaPct = prev.totalValue !== 0 ? (deltaValue / prev.totalValue) * 100 : 0;
    return {
      ...base,
      deltaValue,
      deltaPct,
    };
  });

  let periodChange: PeriodChange | null = null;
  if (snapshots.length >= 2) {
    const prev = snapshots[snapshots.length - 2];
    const last = snapshots[snapshots.length - 1];
    const deltaValue = last.totalValue - prev.totalValue;
    periodChange = {
      fromDate: prev.date,
      toDate: last.date,
      deltaValue,
      deltaPct: prev.totalValue !== 0 ? (deltaValue / prev.totalValue) * 100 : 0,
    };
  }

  const lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return {
    live,
    history,
    periodChange,
    lastSnapshot: lastSnap
      ? { date: lastSnap.date, totalValue: lastSnap.totalValue }
      : null,
  };
}
