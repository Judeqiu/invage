import type { Holding } from '../market/types.js';
import type { Snapshot } from '../state/snapshot.js';

export interface LivePosition {
  ticker: string;
  units: number;
  avgCost: number;
  price: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  weightPct: number;
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
  };
  history: HistoryRow[];
  /** Null when fewer than 2 snapshots. */
  periodChange: PeriodChange | null;
  lastSnapshot: { date: string; totalValue: number } | null;
}

/**
 * Build live positions from portfolio + prices.
 * Fails if portfolio empty or any ticker lacks a price.
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
} {
  const tickers = Object.keys(portfolio);
  if (tickers.length === 0) {
    throw new Error('No portfolio saved. Use add_holding to build a portfolio first.');
  }

  const raw = tickers.map((ticker) => {
    const h = portfolio[ticker];
    const price = prices[ticker];
    if (price == null) {
      throw new Error(`Missing market price for ${ticker}. Cannot build dashboard.`);
    }
    const cost = h.avg_price * h.units;
    const value = price * h.units;
    const pl = value - cost;
    return {
      ticker,
      units: h.units,
      avgCost: h.avg_price,
      price,
      cost,
      value,
      pl,
      plPct: cost > 0 ? (pl / cost) * 100 : 0,
    };
  });

  const totalValue = raw.reduce((s, p) => s + p.value, 0);
  const totalCost = raw.reduce((s, p) => s + p.cost, 0);
  const totalPL = totalValue - totalCost;

  const positions: LivePosition[] = raw
    .map((p) => ({
      ...p,
      weightPct: totalValue > 0 ? (p.value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    positions,
    totalValue,
    totalCost,
    totalPL,
    totalPLPct: totalCost > 0 ? (totalPL / totalCost) * 100 : 0,
    positionCount: positions.length,
  };
}

/** Pure: join live totals with snapshot history into a dashboard model. */
export function buildDashboardModel(
  live: ReturnType<typeof buildLivePositions>,
  snapshots: Snapshot[],
): DashboardModel {
  const history: HistoryRow[] = snapshots.map((snap, i) => {
    if (i === 0) {
      return {
        date: snap.date,
        totalValue: snap.totalValue,
        totalCost: snap.totalCost,
        totalPL: snap.totalPL,
        totalPLPct: snap.totalPLPct,
        deltaValue: null,
        deltaPct: null,
      };
    }
    const prev = snapshots[i - 1];
    const deltaValue = snap.totalValue - prev.totalValue;
    const deltaPct = prev.totalValue !== 0 ? (deltaValue / prev.totalValue) * 100 : 0;
    return {
      date: snap.date,
      totalValue: snap.totalValue,
      totalCost: snap.totalCost,
      totalPL: snap.totalPL,
      totalPLPct: snap.totalPLPct,
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
