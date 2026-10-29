import type { PortfolioProjection } from '../state/projection-store.js';

type Point = { currency: string; members: string; values: Record<string, number>; units: Record<string, string>; bases?: Record<string, string> };
const settlementBasis = 'net-put-expiry-settlement-v1';
export type DailyAggregateHistory = Record<string, Record<string, Point>>;
export type DailyChanges = { date: string; previousDate: string; metrics: Record<string, { label: string; delta: number; percent: number | null; unit: string }> };
const fields: Record<string, string> = {
  totalValue: 'Net asset value (NAV)', positionsValue: 'Positions value', totalCost: 'Positions cost',
  totalPL: 'Unrealized P/L', totalPLPct: 'Unrealized P/L %', fundIndex: 'Portfolio index', benchmarkIndex: 'Benchmark index', diff: 'Index difference', equityValue: 'Equity value', equityCost: 'Equity cost',
  cashAmount: 'Cash available', cashWeightPct: 'Cash weight', depositsAmount: 'Deposits',
  optionsPremiumCollected: 'Open options premium collected', optionsPremiumPaid: 'Open options premium paid',
  contingentCashObligation: 'Put assignment obligation', contingentShareObligation: 'Call share obligation',
  positionCount: 'Positions', optionCount: 'Option positions', equityCount: 'Equity positions', fundCount: 'Fund positions', depositCount: 'Deposits count',
  'premium.daily': 'Net premium · Daily', 'premium.mtd': 'Net premium · MTD', 'premium.total': 'Total premium',
  'premium.fees': 'Brokerage fees · MTD', 'realizedTotal': 'Realized P/L', realizedDaily: 'Realized P/L · Daily', realizedMtd: 'Realized P/L · MTD', assignmentObligation: 'Max assignment obligation',
  'risk.wheel.exposure': 'High-risk ITM exposure', 'risk.wheel.weighted': 'Probability-weighted exposure',
  'risk.wheel.cover': 'High-risk coverage', 'risk.matching.exposure': 'Matching ITM exposure',
  'risk.matching.weighted': 'Matching weighted exposure', 'risk.matching.cover': 'Matching coverage',
};
export function singaporeDate(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
/** Retain daily close values in the same atomic generation as the read models. */
export function attachDailyChanges(entry: PortfolioProjection, history: DailyAggregateHistory = {}): void {
  const date = singaporeDate(entry.calculatedAt);
  const previousDate = new Date(Date.parse(date + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  const today: Record<string, Point> = {};
  const scopes: Array<[string, Record<string, unknown> | undefined]> = [['portfolio', entry.dashboard.aggregatedViews?.live]];
  for (const [id, broker] of Object.entries(entry.brokers)) scopes.push(['broker:' + id, broker.scopes.live]);
  for (const [owner, collection] of scopes) for (const [channel, raw] of Object.entries(collection ?? {})) {
    const scope = raw as any, view = scope.view;
    if (!view) continue;
    const currency = view.reportingCurrency || view.cashCurrency;
    const point: Point = { currency, members: JSON.stringify(channel === 'merged' ? [...(view.channels ?? [])].sort() : [channel]), values: {}, units: {}, bases: { assignmentObligation: settlementBasis } };
    // Partial valuations must never produce apparent gains/losses from missing data.
    if (currency && view.navComplete !== false) for (const key of Object.keys(fields)) {
      const value = key === 'positionCount' ? view.positions?.length ?? view.positionCount
        : key === 'realizedDaily' ? scope.realized?.[scope.premium?.dailyFrom]?.value
        : key === 'realizedMtd' ? scope.realized?.[(scope.premium?.dailyDate || date).slice(0, 7) + '-01']?.value
        : key === 'realizedTotal' ? scope.realized?.['']?.value
        : key.includes('.') ? key.split('.').reduce((o, part) => o?.[part], scope) : view[key] ?? scope[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const unit = ['fundIndex', 'benchmarkIndex', 'diff'].includes(key) ? 'points' : /Pct$|\.cover$/.test(key) ? 'pp' : /Count$|ShareObligation$/.test(key) ? 'count'
        : key === 'cashAmount' ? view.cashCurrency : key === 'depositsAmount' ? view.depositsCurrency || currency : currency;
      if (!unit) continue;
      point.values[key] = value; point.units[key] = unit;
    }
    const id = JSON.stringify([owner, channel]);
    today[id] = point;
    let prior = history[previousDate]?.[id];
    // Old snapshots cannot attribute multi-account cash to individual brokers.
    // Use only explicit fields on a matching full-portfolio snapshot.
    if (!prior && owner === 'portfolio' && channel === 'merged') {
      const snapshot = entry.dashboard.model?.history.find(row => row.date === previousDate);
      const members = snapshot && [...new Set([...snapshot.positions.map(row => row.channel),
        ...(snapshot.deposits ?? []).map(row => row.channel), ...(snapshot.cashChannel ? [snapshot.cashChannel] : [])])].sort();
      if (snapshot && snapshot.reportingCurrency === currency && JSON.stringify(members) === point.members) {
        prior = { currency, members: point.members, values: {}, units: {} };
        for (const key of Object.keys(point.values)) {
          const value = (snapshot as unknown as Record<string, unknown>)[key];
          const unit = key === 'cashAmount' ? snapshot.cashCurrency : key === 'depositsAmount' ? snapshot.depositsCurrency || currency : point.units[key];
          if (typeof value === 'number' && Number.isFinite(value) && unit === point.units[key]) {
            prior.values[key] = value; prior.units[key] = unit;
          }
        }
      }
    }
    const changes: DailyChanges = { date, previousDate, metrics: {} };
    if (prior && prior.currency === currency && prior.members === point.members) for (const [key, value] of Object.entries(point.values)) {
      // Preserve gross-notional history, but never compare it to net settlement.
      if (key === 'assignmentObligation' && prior.bases?.[key] !== settlementBasis) continue;
      const before = prior.values[key];
      if (!Number.isFinite(before) || prior.units[key] !== point.units[key]) continue;
      const delta = value - before;
      changes.metrics[key] = { label: fields[key], delta, percent: before === 0 || point.units[key] === 'pp' ? null : delta / Math.abs(before) * 100, unit: point.units[key] };
    }
    scope.dailyChanges = changes;
  }
  // Same-day syncs replace today's close, while yesterday's baseline remains fixed.
  entry.dailyAggregateHistory = Object.fromEntries(Object.entries({ ...history, [date]: today })
    .filter(([day]) => day <= date).sort(([a], [b]) => b.localeCompare(a)).slice(0, 35));
}
