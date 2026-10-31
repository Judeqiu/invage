import { isDeepStrictEqual } from 'node:util';
import type { InvestorState } from './portfolio-state.js';
import { portfolioFingerprint, readPortfolioProjection, type PortfolioProjection } from './projection-store.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { buildOptionIdentityIndex } from '../brokers/option-identities.js';
import { buildExecutionJournal, type OptionExecution } from '../brokers/option-executions.js';

/** Prepare an execution-only import from saved valuations without refreshing market evidence. */
export async function prepareExecutionImportProjection(state: InvestorState, merged: OptionExecution[], brokerId: string) {
  const prior = readPortfolioProjection(state);
  if (!prior) throw new Error('A valid saved portfolio projection is required before this repair');
  const { prepareOptionRelationships } = await import('../webapp/option-relationships-data.js');
  const { openOptionTradeDetails, attachLatestRollPremium, attachOpenVerticalSpreads } = await import('../webapp/option-dashboard-data.js');
  const { buildRecordedOptionAnalytics } = await import('../webapp/option-analytics.js');
  const { optionHistoryForState } = await import('../webapp/option-history-data.js');
  const { tradesOpenBook, tradesHistory } = await import('../webapp/trades-v2-data.js');
  const { buildPageProjections, buildTradeProjections } = await import('../report/page-projections.js');
  const { buildBrokerProjections } = await import('../report/broker-projections.js');
  const { attachDailyChanges } = await import('../report/daily-changes.js');
  const projectedState = {...state, option_executions:merged};
  projectedState.option_identities = buildOptionIdentityIndex(projectedState);
  const relationships = await prepareOptionRelationships(projectedState);
  const journal = buildExecutionJournal(merged);
  const dashboard = structuredClone(prior.dashboard);
  dashboard.premiumJournal = {available:journal.available, daily:journal.daily,
    channels:[...new Set(merged.map(row => row.channel))]};
  dashboard.optionAnalytics = buildRecordedOptionAnalytics(merged, projectedState.option_events);
  const accounts = Object.fromEntries(Object.values(readBrokerAccountModel(projectedState).connections)
    .filter(c => c.account_id).map(c => [c.channel,c.account_id!]));
  dashboard.optionTradeDetails = openOptionTradeDetails(projectedState.portfolio ?? {}, merged, accounts, projectedState.option_events);
  const links = relationships.groups.flatMap(group => group.relationships);
  attachLatestRollPremium(projectedState.portfolio ?? {}, dashboard.optionTradeDetails, links, accounts);
  attachOpenVerticalSpreads(projectedState.portfolio ?? {}, dashboard.optionTradeDetails, relationships.spreads, accounts);
  dashboard.optionHistoryGaps = relationships.historyGaps;
  const conflicts = new Set(relationships.historyGaps.filter(gap => gap.blocksTotals).map(gap => gap.channel));
  for (const key of Object.keys(dashboard.optionTradeDetails ?? {})) if (conflicts.has(projectedState.portfolio?.[key]?.channel ?? '')) delete dashboard.optionTradeDetails![key];
  const optionHistory = optionHistoryForState(projectedState);
  const tradeHistory = tradesHistory({...projectedState, option_observations:optionHistory.observations,
    option_events:optionHistory.events}, links);
  for (const row of tradeHistory.rows) if (conflicts.has(row.channel)) {
    row.premium = row.netCash = row.realizedPnl = row.returnsPct = null;
    row.notes.push('Conflicting archived execution evidence needs reconciliation. Cash and profit figures are withheld.');
  }
  const openTrades = tradesOpenBook(projectedState);
  const pages = buildPageProjections(dashboard);
  dashboard.pageProjections = {positions:pages.positions, insights:pages.insights};
  dashboard.aggregatedViews = pages.dashboard;
  const prepared: PortfolioProjection = {...prior, fingerprint:portfolioFingerprint(projectedState), calculatedAt:new Date().toISOString(),
    dashboard, journal, relationships, optionHistory,
    openTrades:{...openTrades, aggregates:buildTradeProjections(openTrades.rows)},
    tradeHistory:{...tradeHistory, aggregates:buildTradeProjections(tradeHistory.rows,true),
      gaps:[...optionHistory.gaps,...relationships.historyGaps]},
    brokers:buildBrokerProjections(projectedState,dashboard,openTrades.rows,tradeHistory.rows)};
  attachDailyChanges(prepared, prior.dailyAggregateHistory ?? {});
  for (const [broker, projection] of Object.entries(prior.brokers)) {
    if (broker === brokerId) continue;
    if (!isDeepStrictEqual(projection.journal, prepared.brokers[broker]?.journal) ||
        !isDeepStrictEqual(projection.totals, prepared.brokers[broker]?.totals)) {
      throw new Error(`Repair would change unrelated ${broker} valuation or journal`);
    }
    prepared.brokers[broker] = projection;
  }
  return prepared;
}
