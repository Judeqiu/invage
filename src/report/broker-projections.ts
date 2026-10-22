import { readBrokerAccountModel } from '../brokers/accounts.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { DashboardPayload } from '../webapp/dashboard-data.js';
import type { TradeJournalRow } from '../webapp/trades-v2-data.js';
import type { LiveDashboardSlice } from './dashboard-model.js';
import { buildPageProjections, buildTradeProjections } from './page-projections.js';

export interface BrokerProjection {
  brokerId: string;
  channels: string[];
  calculatedAt: string;
  /** Complete broker NAV in the reporting currency; partial valuations stay unavailable. */
  nav: number | null;
  /** Broker-specific dashboard data; saved aggregate scopes and page models sit alongside it. */
  dashboard: DashboardPayload;
  totals: LiveDashboardSlice | null;
  scopes: ReturnType<typeof buildPageProjections>['dashboard'];
  pages: { positions: Record<string, unknown>; insights: Record<string, unknown> };
  journal: ReturnType<typeof buildExecutionJournal>;
  trades: { open: ReturnType<typeof buildTradeProjections>; history: ReturnType<typeof buildTradeProjections> };
}

/** Sum the already-converted account totals; never convert their money a second time. */
function brokerLive(live: LiveDashboardSlice, channels: string[]): LiveDashboardSlice {
  const selected = new Set(channels);
  const rows = live.byChannel.filter(row => selected.has(row.channel));
  const positions = live.positions.filter(row => selected.has(row.channel));
  const deposits = live.deposits.filter(row => selected.has(row.channel));
  const sum = (key: 'positionsValue' | 'totalCost' | 'equityValue' | 'equityCost' | 'optionsPremiumCollected' |
    'optionsPremiumPaid' | 'contingentCashObligation' | 'contingentShareObligation' | 'optionCount' |
    'equityCount' | 'fundCount' | 'depositsAmount') => rows.reduce((total, row) => total + row[key], 0);
  const reportingCurrency = live.reportingCurrency ?? live.cashCurrency;
  const cashRows = rows.filter(row => row.cashAmount !== null);
  const cashCompatible = cashRows.every(row => row.cashAmount === 0 || row.cashCurrency === reportingCurrency);
  const cashKnown = rows.length > 0 && cashRows.length === rows.length;
  const cashAmount = cashKnown && cashCompatible ? cashRows.reduce((total, row) => total + row.cashAmount!, 0) : null;
  const depositsCompatible = rows.every(row => row.depositsAmount === 0 || row.depositsCurrency === reportingCurrency);
  const positionsValue = sum('positionsValue'), totalCost = sum('totalCost'), depositsAmount = sum('depositsAmount');
  const totalValue = positionsValue + (cashAmount ?? 0) + depositsAmount;
  const totalPL = positionsValue - totalCost;
  const navComplete = channels.every(channel => rows.some(row => row.channel === channel)) &&
    rows.every(row => row.navComplete !== false) && cashCompatible && depositsCompatible &&
    (cashRows.length === 0 || cashKnown);
  const denominator = positions.reduce((total, row) => total + Math.abs(row.value), 0) + (cashAmount ?? 0) + depositsAmount;
  const issues = live.issues.filter(issue => !issue.key || selected.has(issue.key) || positions.some(row => row.ticker === issue.key));
  if (!navComplete) issues.push({ code: 'broker_nav_incomplete', severity: 'warning',
    message: 'Broker NAV is incomplete: an account total, cash balance or reporting-currency conversion is unavailable.' });
  return {
    ...live, positions: positions.map(row => ({ ...row, weightPct: denominator > 0 ? Math.abs(row.value) / denominator * 100 : 0 })),
    channels, byChannel: rows, deposits, issues, positionCount: positions.length,
    positionsValue, totalCost, totalPL, totalPLPct: totalCost !== 0 ? totalPL / Math.abs(totalCost) * 100 : 0,
    totalValue, cashAmount, cashCurrency: cashAmount !== null ? reportingCurrency ?? null : null,
    cashChannel: cashAmount !== null && channels.length === 1 ? channels[0] : null,
    cashWeightPct: cashAmount !== null ? totalValue !== 0 ? cashAmount / totalValue * 100 : 0 : null,
    depositsAmount, depositsCurrency: depositsAmount !== 0 ? reportingCurrency ?? null : null,
    depositCount: deposits.length, navComplete,
    equityValue: sum('equityValue'), equityCost: sum('equityCost'),
    optionsPremiumCollected: sum('optionsPremiumCollected'), optionsPremiumPaid: sum('optionsPremiumPaid'),
    contingentCashObligation: sum('contingentCashObligation'), contingentShareObligation: sum('contingentShareObligation'),
    optionCount: sum('optionCount'), equityCount: sum('equityCount'), fundCount: sum('fundCount'),
  };
}

/** Broker identity comes from connection metadata, including custom and multiple account channels. */
export function buildBrokerProjections(state: InvestorState, dashboard: DashboardPayload,
  openRows: TradeJournalRow[], historyRows: TradeJournalRow[]): Record<string, BrokerProjection> {
  const groups = new Map<string, Set<string>>();
  for (const conn of Object.values(readBrokerAccountModel(state).connections)) {
    if (!groups.has(conn.broker_id)) groups.set(conn.broker_id, new Set());
    groups.get(conn.broker_id)!.add(conn.channel);
  }
  const result: Record<string, BrokerProjection> = {};
  for (const [brokerId, members] of groups) {
    const channels = [...members].sort();
    const owns = (row: { channel: string }) => members.has(row.channel);
    const keyed = <T>(values?: Record<string, T>) => values
      ? Object.fromEntries(Object.entries(values).filter(([channel]) => members.has(channel))) : undefined;
    const live = dashboard.model ? brokerLive(dashboard.model.live, channels) : null;
    const journal = buildExecutionJournal(state.option_executions?.filter(owns));
    const scoped: DashboardPayload = {
      ...dashboard, aggregatedViews: undefined, pageProjections: undefined,
      // Historical account views remain in the full generation. Broker cash cannot
      // be inferred from older combined snapshots without account cash attribution.
      model: live ? { live, history: [], periodChange: null, lastSnapshot: null } : null,
      brokerAsOf: keyed(dashboard.brokerAsOf), brokerChannels: keyed(dashboard.brokerChannels),
      connectionMetrics: keyed(dashboard.connectionMetrics), warnings: live?.issues,
      optionTradeDetails: dashboard.optionTradeDetails && Object.fromEntries(Object.entries(dashboard.optionTradeDetails)
        .filter(([ticker]) => live?.positions.some(row => row.ticker === ticker))),
      premiumJournal: { available: journal.available, daily: journal.daily, channels: [...new Set(journal.executions.map(row => row.channel))] },
      premiumSupportedChannels: dashboard.premiumSupportedChannels?.filter(channel => members.has(channel)),
      optionHistoryGaps: dashboard.optionHistoryGaps?.filter(owns),
      optionAnalytics: dashboard.optionAnalytics && { ...dashboard.optionAnalytics,
        executions: dashboard.optionAnalytics.executions.filter(owns), profits: dashboard.optionAnalytics.profits.filter(owns),
        gaps: dashboard.optionAnalytics.gaps.filter(owns) },
    };
    const pages = buildPageProjections(scoped);
    result[brokerId] = { brokerId, channels, calculatedAt: dashboard.generatedAt, nav: live?.navComplete === true ? live.totalValue : null, totals: live, dashboard: scoped,
      scopes: pages.dashboard, pages: { positions: pages.positions, insights: pages.insights }, journal,
      trades: { open: buildTradeProjections(openRows.filter(owns)), history: buildTradeProjections(historyRows.filter(owns), true) } };
  }
  return result;
}
