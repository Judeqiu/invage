import type { Holding, InstrumentKind, OptionSpec } from '../market/types.js';
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
  premiumAbsolute: number;
  contingentCashObligation: number;
  contingentShareObligation: number;
  category: string;
  /**
   * Broker / custody dimension. Always set on the dashboard model —
   * unassigned storage values become {@link DEFAULT_CHANNEL}.
   */
  channel: string;
  /** Option only: where the mark came from. */
  markSource?: 'manual' | 'yahoo';
  markNote?: string;
  contractSymbol?: string;
}

/** Aggregates for one broker channel (or for the full merged set). */
export interface ChannelTotals {
  channel: string;
  positionCount: number;
  equityCount: number;
  optionCount: number;
  positionsValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPct: number;
  /** Cash included only when it belongs to this channel (or in merged totals). */
  cashAmount: number | null;
  cashCurrency: string | null;
  /** positionsValue + cash when cash is in this slice; else positions only. */
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
  cashAmount: number | null;
  cashCurrency: string | null;
  /**
   * Resolved cash channel when cash is recorded; null when cash unknown.
   * Unassigned cash → {@link DEFAULT_CHANNEL}.
   */
  cashChannel: string | null;
  positionsValue: number;
  cashWeightPct: number | null;
  /**
   * Distinct channels present in this portfolio (positions + cash), sorted.
   * Unassigned items appear as {@link DEFAULT_CHANNEL}.
   */
  channels: string[];
  /** Per-channel aggregates (one entry per id in `channels`). */
  byChannel: ChannelTotals[];
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
    premiumAbsolute: e.premiumAbsolute,
    contingentCashObligation: e.contingentCashObligation,
    contingentShareObligation: e.contingentShareObligation,
    category: e.category,
    channel: resolveDashboardChannel(e.channel),
    markSource: markMeta?.source,
    markNote: markMeta?.note,
    contractSymbol: markMeta?.contractSymbol,
  };
}

/** Unique sorted channel ids from positions + cash channel(s). */
export function collectDashboardChannels(
  positions: Array<{ channel?: string | null }>,
  cashChannels: Array<string | null | undefined> | string | null,
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
  return [...set].sort((a, b) => {
    if (a === DEFAULT_CHANNEL) return -1;
    if (b === DEFAULT_CHANNEL) return 1;
    return a.localeCompare(b);
  });
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

/** Sum cash for a channel (or all when channel is null = merged). Same currency only. */
function cashForChannelSlice(
  cashes: Array<{ amount: number; currency: string; channel: string }>,
  channel: string | null,
): { amount: number; currency: string } | null {
  const subset =
    channel == null ? cashes : cashes.filter((c) => c.channel === channel);
  if (subset.length === 0) return null;
  const currency = subset[0].currency;
  for (const c of subset) {
    if (c.currency !== currency) {
      throw new Error(
        `Cannot sum dashboard cash across currencies (${subset.map((x) => x.currency).join(', ')}).`,
      );
    }
  }
  return {
    amount: subset.reduce((s, c) => s + c.amount, 0),
    currency,
  };
}

/**
 * Aggregate positions (already channel-resolved) plus optional cash into totals.
 * Cash is included only when `includeCash` is true.
 */
export function buildChannelTotals(
  channel: string,
  positions: LivePosition[],
  cash: { amount: number; currency: string } | null,
  includeCash: boolean,
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

  for (const p of positions) {
    positionsValue += p.value;
    totalCost += p.cost;
    if (p.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += p.contingentCashObligation;
      contingentShareObligation += p.contingentShareObligation;
      if (p.option?.side === 'short') optionsPremiumCollected += p.premiumAbsolute;
      else optionsPremiumPaid += p.premiumAbsolute;
    } else {
      equityCount += 1;
      equityValue += p.value;
      equityCost += p.cost;
    }
  }

  const totalPL = positionsValue - totalCost;
  const cashAmount = includeCash && cash != null ? cash.amount : null;
  const cashCurrency = includeCash && cash != null ? cash.currency : null;
  const totalValue = cashAmount != null ? positionsValue + cashAmount : positionsValue;
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
    positionsValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    cashAmount,
    cashCurrency,
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
): LivePosition[] {
  const absPositions = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum = absPositions + (cashAmount != null ? cashAmount : 0);
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
  const chRow = live.byChannel.find((c) => c.channel === channel);
  const cash =
    chRow != null && chRow.cashAmount != null && chRow.cashCurrency != null
      ? { amount: chRow.cashAmount, currency: chRow.cashCurrency }
      : null;

  const totals = buildChannelTotals(channel, filtered, cash, cash != null);
  const positions = withRecalculatedWeights(filtered, totals.cashAmount);

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
    cashAmount: totals.cashAmount,
    cashCurrency: totals.cashCurrency,
    cashChannel: cash != null ? channel : null,
    positionsValue: totals.positionsValue,
    cashWeightPct: totals.cashWeightPct,
    channels: live.channels,
    byChannel: live.byChannel,
  };
}

/**
 * Build live positions from portfolio + equity prices.
 * Option positions use option.mark on the holding (apply Yahoo marks before calling).
 * Pass optionMarks to annotate source on LivePosition.
 * Fails if portfolio empty or any equity ticker lacks a price.
 *
 * Missing holding/cash `channel` is normalized to {@link DEFAULT_CHANNEL}.
 * Cash may be a single balance or an array (one per broker channel).
 */
export function buildLivePositions(
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
  optionMarks?: Record<string, OptionLiveMark>,
  cash?:
    | { amount: number; currency: string; channel?: string }
    | Array<{ amount: number; currency: string; channel?: string }>
    | null,
): LiveDashboardSlice {
  const economics = valuePortfolio(portfolio, prices);
  const cashes = normalizeDashboardCashes(cash ?? null);
  const mergedCash = cashForChannelSlice(cashes, null);
  const cashAmount = mergedCash?.amount ?? null;
  const cashCurrency = mergedCash?.currency ?? null;
  // Single cash channel is exposed on the slice; multi → null (see byChannel).
  const cashChannel =
    cashes.length === 1 ? cashes[0].channel : cashes.length > 1 ? null : null;

  const absPositions = economics.reduce((s, p) => s + Math.abs(p.value), 0);
  const absSum = absPositions + (cashAmount != null ? cashAmount : 0);

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
  );

  const byChannel: ChannelTotals[] = channels.map((ch) => {
    const chPositions = positions.filter((p) => p.channel === ch);
    const chCash = cashForChannelSlice(cashes, ch);
    return buildChannelTotals(ch, chPositions, chCash, chCash != null);
  });

  const merged = buildChannelTotals(
    MERGED_CHANNEL_VIEW,
    positions,
    mergedCash,
    mergedCash != null,
  );

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
    cashAmount: merged.cashAmount,
    cashCurrency: merged.cashCurrency,
    cashChannel,
    positionsValue: merged.positionsValue,
    cashWeightPct: merged.cashWeightPct,
    channels,
    byChannel,
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
