import type {InvestorState} from '../state/portfolio-state.js';
import {completedDemo,completedDemoDashboard} from './completion.js';
import {buildPageProjections,buildTradeProjections} from '../report/page-projections.js';
import {buildBrokerProjections} from '../report/broker-projections.js';
import {tradesOpenBook,tradesHistory} from '../webapp/trades-v2-data.js';
import {prepareOptionRelationships} from '../webapp/option-relationships-data.js';
import {optionHistoryForState} from '../webapp/option-history-data.js';
import {buildExecutionJournal} from '../brokers/option-executions.js';
import {PROJECTION_VERSION,portfolioFingerprint,type PortfolioProjection} from '../state/projection-store.js';

/** Stage only the designated demo; all financial results use existing shared engines. */
export async function prepareDemoProjection(state:InvestorState):Promise<PortfolioProjection> {
  if(!completedDemo(state))throw Error('Projection staging requires the designated completed demo');
  const dashboard=completedDemoDashboard(state),relationships=await prepareOptionRelationships(state),optionHistory=optionHistoryForState(state);
  const open=tradesOpenBook(state),history=tradesHistory(state,relationships.groups.flatMap(g=>g.relationships));
  const pages=buildPageProjections(dashboard);dashboard.aggregatedViews=pages.dashboard;dashboard.pageProjections={positions:pages.positions,insights:pages.insights};
  return{version:PROJECTION_VERSION,userId:state.user.id,fingerprint:portfolioFingerprint(state),calculatedAt:dashboard.generatedAt,
    dashboard,relationships,optionHistory,journal:buildExecutionJournal(state.option_executions),
    openTrades:{...open,aggregates:buildTradeProjections(open.rows)},
    tradeHistory:{...history,aggregates:buildTradeProjections(history.rows,true),gaps:[]},
    brokers:buildBrokerProjections(state,dashboard,open.rows,history.rows)};
}
