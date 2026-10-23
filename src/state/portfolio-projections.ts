import { attachDailyChanges } from '../report/daily-changes.js';
import { buildBrokerProjections } from '../report/broker-projections.js';
import { listUserIds } from 'utarus';
import { loadInvestor } from './investor-store.js';
import { registerPortfolioRefresher } from './projection-events.js';
import { portfolioFingerprint, readDailyAggregateHistory, PROJECTION_VERSION, readPortfolioProjection, writePortfolioProjection, type PortfolioProjection } from './projection-store.js';
import { loadDashboardForSlug } from '../webapp/dashboard-data.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';
import { tradesOpenBook, tradesHistory } from '../webapp/trades-v2-data.js';
import { optionHistoryForState } from '../webapp/option-history-data.js';
import { optionRelationshipsForState } from '../webapp/option-relationships-data.js';
import { buildPageProjections, buildTradeProjections } from '../report/page-projections.js';

const runtime = { loadInvestor, loadDashboardForSlug, buildExecutionJournal, tradesOpenBook, tradesHistory,
  optionHistoryForState, optionRelationshipsForState, buildPageProjections, buildTradeProjections, buildBrokerProjections };

/** Serial per-user writes; recheck the source before publishing an atomic generation. */
export function createPortfolioProjectionRefresher(overrides: Partial<typeof runtime> = {}) {
  const deps = { ...runtime, ...overrides };
  const pending = new Map<string, Promise<void>>();
  function refresh(userId: string, force = false): Promise<void> {
    const prior = pending.get(userId) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = await deps.loadInvestor(userId);
        const fingerprint = portfolioFingerprint(snapshot.state);
        if (!force && readPortfolioProjection(snapshot.state)) return;
        const dashboard = await deps.loadDashboardForSlug(userId, undefined, undefined, undefined, { snapshot });
        const state = snapshot.state;
        const optionHistory = deps.optionHistoryForState(state);
        const relationships = deps.optionRelationshipsForState(state, {}, { background: true });
        const tradeHistory = deps.tradesHistory({ ...state, option_observations: optionHistory.observations,
          option_events: optionHistory.events }, relationships.groups.flatMap(g => g.relationships));
        const conflicts = new Set(relationships.historyGaps.filter(g => g.blocksTotals).map(g => g.channel));
        for (const row of tradeHistory.rows) if (conflicts.has(row.channel)) {
          row.premium = row.netCash = row.realizedPnl = row.returnsPct = null;
          row.notes.push('Conflicting archived execution evidence needs reconciliation. Cash and profit figures are withheld.');
        }
        const pages = deps.buildPageProjections(dashboard);
        dashboard.pageProjections = { positions: pages.positions, insights: pages.insights };
        dashboard.aggregatedViews = pages.dashboard;
        const openTrades = deps.tradesOpenBook(state);
        const entry: PortfolioProjection = { version: PROJECTION_VERSION, userId, fingerprint,
          calculatedAt: dashboard.generatedAt, dashboard,
          brokers: deps.buildBrokerProjections(state, dashboard, openTrades.rows, tradeHistory.rows),
          journal: deps.buildExecutionJournal(state.option_executions), openTrades: { ...openTrades, aggregates: deps.buildTradeProjections(openTrades.rows) },
          tradeHistory: { ...tradeHistory, aggregates: deps.buildTradeProjections(tradeHistory.rows, true), gaps: [...optionHistory.gaps, ...relationships.historyGaps] }, optionHistory, relationships };
        const latest = await deps.loadInvestor(userId);
        if (portfolioFingerprint(latest.state) !== fingerprint) continue;
        attachDailyChanges(entry, readDailyAggregateHistory(userId));
        writePortfolioProjection(entry);
        return;
      }
      throw new Error('Portfolio changed repeatedly during calculation; background refresh will retry.');
    });
    pending.set(userId, work);
    void work.finally(() => { if (pending.get(userId) === work) pending.delete(userId); }).catch(() => {});
    return work;
  }
  return Object.assign(refresh, { drain: async () => { await Promise.allSettled([...pending.values()]); } });
}

/** Backfill existing accounts at startup; repair missing/outdated projections off the request path. */
export function startPortfolioProjectionWorker() {
  const refresh = createPortfolioProjectionRefresher();
  const unregister = registerPortfolioRefresher(refresh);
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = (async () => {
      for (const userId of await listUserIds()) {
        if (stopped) break;
        try { await refresh(userId); } catch (error) { console.error('[portfolio/projection] refresh', userId, error); }
      }
    })().catch(error => console.error('[portfolio/projection] scan', error)).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 60_000);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); unregister(); await active; await refresh.drain(); } };
}
