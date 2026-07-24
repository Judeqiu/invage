import type { Holding, InstrumentKind, OptionSpec } from '../market/types.js';
import { valuePortfolio, type PositionEconomics } from '../market/position-value.js';
import type { Snapshot, SnapshotPosition } from '../state/snapshot.js';

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
}

export interface PeriodChange {
  fromDate: string;
  toDate: string;
  deltaValue: number;
  deltaPct: number;
}

export interface DashboardModel {
  live: {
    positions: LivePosition[];
    totalValue: number;
    totalCost: number;
    totalPL: number;
    totalPLPct: number;
    positionCount: number;
    /** Equity-only totals (SPY fund-index base; excludes option credits/liabilities). */
    equityValue: number;
    equityCost: number;
    /** Sum of short-option premiums collected (absolute $). */
    optionsPremiumCollected: number;
    /** Sum of long-option premiums paid (absolute $). */
    optionsPremiumPaid: number;
    /** Max cash outlay if all short puts are assigned. */
    contingentCashObligation: number;
    /** Shares deliverable if all short calls are assigned. */
    contingentShareObligation: number;
    optionCount: number;
    equityCount: number;
  };
  history: HistoryRow[];
  /** Null when fewer than 2 snapshots. */
  periodChange: PeriodChange | null;
  lastSnapshot: { date: string; totalValue: number } | null;
}

function economicsToLive(e: PositionEconomics, weightPct: number): LivePosition {
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
  };
}

/**
 * Build live positions from portfolio + equity prices.
 * Option positions use stored option.mark (no Yahoo fetch).
 * Fails if portfolio empty or any equity ticker lacks a price.
 */
export function buildLivePositions(
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
): {
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
} {
  const economics = valuePortfolio(portfolio, prices);

  const totalValue = economics.reduce((s, p) => s + p.value, 0);
  const totalCost = economics.reduce((s, p) => s + p.cost, 0);
  const totalPL = totalValue - totalCost;

  // Weight by |value| so short options appear in allocation without breaking the pie.
  const absSum = economics.reduce((s, p) => s + Math.abs(p.value), 0);

  const positions: LivePosition[] = economics
    .map((e) =>
      economicsToLive(e, absSum > 0 ? (Math.abs(e.value) / absSum) * 100 : 0),
    )
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  let equityValue = 0;
  let equityCost = 0;
  let optionsPremiumCollected = 0;
  let optionsPremiumPaid = 0;
  let contingentCashObligation = 0;
  let contingentShareObligation = 0;
  let optionCount = 0;
  let equityCount = 0;

  for (const e of economics) {
    if (e.instrument === 'option') {
      optionCount += 1;
      contingentCashObligation += e.contingentCashObligation;
      contingentShareObligation += e.contingentShareObligation;
      if (e.option?.side === 'short') optionsPremiumCollected += e.premiumAbsolute;
      else optionsPremiumPaid += e.premiumAbsolute;
    } else {
      equityCount += 1;
      equityValue += e.value;
      equityCost += e.cost;
    }
  }

  return {
    positions,
    totalValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost !== 0 ? (totalPL / Math.abs(totalCost)) * 100 : 0,
    positionCount: positions.length,
    equityValue,
    equityCost,
    optionsPremiumCollected,
    optionsPremiumPaid,
    contingentCashObligation,
    contingentShareObligation,
    optionCount,
    equityCount,
  };
}

/** Pure: join live totals with snapshot history into a dashboard model. */
export function buildDashboardModel(
  live: ReturnType<typeof buildLivePositions>,
  snapshots: Snapshot[],
): DashboardModel {
  const history: HistoryRow[] = snapshots.map((snap, i) => {
    const base = {
      date: snap.date,
      totalValue: snap.totalValue,
      totalCost: snap.totalCost,
      totalPL: snap.totalPL,
      totalPLPct: snap.totalPLPct,
      positions: snap.positions,
      equityValue: snap.equityValue,
      equityCost: snap.equityCost,
      contingentCashObligation: snap.contingentCashObligation,
      optionsPremiumCollected: snap.optionsPremiumCollected,
      optionsPremiumPaid: snap.optionsPremiumPaid,
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
