import { isDeepStrictEqual } from 'node:util';
import type { InvestorState } from './portfolio-state.js';
import { portfolioFingerprint,readPortfolioProjection,type PortfolioProjection } from './projection-store.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { buildPageProjections } from '../report/page-projections.js';
import { buildBrokerProjections } from '../report/broker-projections.js';

/** Rebuild metadata projections from the saved generation; no prices, FX,
 * balances, executions, valuation times or daily history are refreshed here.
 */
export function prepareFundMetadataProjection(before:InvestorState,after:InvestorState):PortfolioProjection {
  const prior=readPortfolioProjection(before);if(!prior?.dashboard.model)throw Error('Valid saved valuation required for fund metadata repair');
  const dashboard=structuredClone(prior.dashboard),channels=new Set<string>();
  for(const [key,h]of Object.entries(after.portfolio??{})){
    const old=before.portfolio?.[key];if(!old||h.instrument!=='fund'||!h.fund)continue;
    if(isDeepStrictEqual(old.fund,h.fund)&&isDeepStrictEqual(old.broker_ref,h.broker_ref))continue;
    const strip=(holding:typeof h)=>{const {fund,broker_ref,...rest}=holding;const {name,isin,broker_symbol,product_class,classification_source,...economics}=fund!;return {...rest,fund:economics};};
    if(!isDeepStrictEqual(strip(old),strip(h)))throw Error('Fund metadata repair cannot change financial fields');
    const position=dashboard.model!.live.positions.find(p=>p.ticker===key&&p.channel===h.channel);
    if(!position)throw Error('Fund has no matching saved valuation');
    position.fund=structuredClone(h.fund);if(h.fund.name)position.label=h.fund.name;
    if(h.channel)channels.add(h.channel);
  }
  const pages=buildPageProjections(dashboard);dashboard.pageProjections={positions:pages.positions,insights:pages.insights};dashboard.aggregatedViews=pages.dashboard;
  const rebuilt=buildBrokerProjections(after,dashboard,prior.openTrades.rows,prior.tradeHistory.rows);
  const affected=new Set(Object.values(readBrokerAccountModel(after).connections).filter(c=>channels.has(c.channel)).map(c=>c.broker_id));
  const brokers={...prior.brokers};
  for(const broker of affected){
    if(!rebuilt[broker])throw Error('Fund broker projection missing');
    if(!isDeepStrictEqual(prior.brokers[broker]?.totals?.byChannel,rebuilt[broker].totals?.byChannel)||prior.brokers[broker]?.nav!==rebuilt[broker].nav)throw Error('Fund metadata repair changed broker financial totals');
    brokers[broker]=rebuilt[broker];
  }
  return {...prior,fingerprint:portfolioFingerprint(after),dashboard,brokers};
}
