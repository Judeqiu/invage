import { describe, expect, it } from 'vitest';
import { prepareBrokerValueRestore } from '../src/tools/restore_broker_values.js';
import { addBrokerSource, addBrokerAccount, readBrokerAccountModel, persistBrokerAccountModel } from '../src/brokers/accounts.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { BrokerStatement } from '../src/brokers/statement.js';
function fixture() {
 const state:InvestorState={user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01',auth_token:'secret'},profile:{display_name:'Test',contact_email:''},log:[]};
 const source=addBrokerSource(state,'ibkr',{token:'test-token'});
 const id=addBrokerAccount(state,{source_id:source,account_id:'U1',label:'Test',config:{activity_query_id:'123'}});
 const model=readBrokerAccountModel(state),conn=model.connections[id];
 conn.last_sync={at:'2026-11-05T11:00:00Z',ok:true,as_of:'2026-11-05'};conn.metrics={as_of:'2026-11-05',currency:'USD',broker_net_assets:20};persistBrokerAccountModel(state,model);
 const h={units:1,avg_price:-7,currency:'USD',channel:conn.channel};state.portfolio={['AAA@'+conn.channel]:h};
 state.cash=[{channel:conn.channel,currency:'USD',amount:5,updated_at:'2026-11-05'}];
 const statement:BrokerStatement={account_id:'U1',as_of:'2026-11-05',cash:[{currency:'USD',amount:5}],skipped:[],metrics:{as_of:'2026-11-05',currency:'USD',broker_net_assets:20,broker_cash:5},lots:[{ticker:'AAA',currency:'USD',holding:{...h,broker_values:{source:'broker',as_of:'2026-11-05T11:00:00Z',currency:'USD',units:1,avg_price:-7,market_value:15}}}]};
 return {state,id,statement};
}
it('enriches reported values without touching cash, signs, quantities or history and is idempotent',()=>{
 const {state,id,statement}=fixture(),before=structuredClone(state),p=prepareBrokerValueRestore(state,id,statement);
 expect(p.updated).toBe(1);expect(p.metrics.broker_cash).toBe(5);expect(state).toEqual(before);
 state.portfolio=p.portfolio;const model=readBrokerAccountModel(state);model.connections[id].metrics=p.metrics;persistBrokerAccountModel(state,model);
 expect(prepareBrokerValueRestore(state,id,statement)).toMatchObject({updated:0,metricsChanged:false});
 expect(state.cash).toEqual(before.cash);expect(Object.values(state.portfolio)[0].avg_price).toBe(-7);
});
it('rejects wrong accounts, stale dates, changed holdings, changed terms and conflicting broker totals',()=>{
 const {state,id,statement}=fixture();
 expect(()=>prepareBrokerValueRestore(state,id,{...statement,account_id:'OTHER'})).toThrow(/match/);
 expect(()=>prepareBrokerValueRestore(state,id,{...statement,as_of:'2026-11-04'})).toThrow(/match/);
 expect(()=>prepareBrokerValueRestore(state,id,{...statement,lots:[]})).toThrow(/holdings differ/);
 const changed=structuredClone(statement);changed.lots[0].holding.avg_price=7;
 expect(()=>prepareBrokerValueRestore(state,id,changed)).toThrow(/economics differ/);
 expect(()=>prepareBrokerValueRestore(state,id,{...statement,metrics:{as_of:'2026-11-05',currency:'USD',broker_net_assets:21}})).toThrow(/conflicts/);
});

it('preserves and explicitly lists additional locally recorded holdings during broker metadata recovery',()=>{
 const {state,id,statement}=fixture();const channel=Object.values(state.portfolio!)[0].channel;
 state.portfolio!['LOCAL@'+channel]={units:1,avg_price:674.9,currency:'USD',channel,instrument:'fund',fund:{quote_source:'manual',mark:674.9}};
 const p=prepareBrokerValueRestore(state,id,statement);
 expect(p.unmatchedCurrentKeys).toEqual(['LOCAL@'+channel]);expect(p.portfolio['LOCAL@'+channel]).toEqual(state.portfolio!['LOCAL@'+channel]);expect(p.updated).toBe(1);
});
