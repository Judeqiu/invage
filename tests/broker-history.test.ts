import { describe,expect,it,vi } from 'vitest';
import { assertBrokerHistory, mergeBrokerHistory, planBrokerHistorySync, optionExecutionsFromHistory, type BrokerHistory } from '../src/brokers/history.js';
import { mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { runQuery } from '../src/data-query/engine.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerSource,addBrokerAccount,patchBrokerAccount,readBrokerAccountModel } from '../src/brokers/accounts.js';
vi.mock('../src/state/investor-store.js',()=>({saveInvestor:vi.fn()}));
vi.mock('../src/books/index.js',()=>({isBooksEnabled:()=>false}));
const { applyBrokerStatement } = await import('../src/brokers/apply-statement.js');
function history(broker = 'moomoo'): BrokerHistory {
  const scope = {broker_id:broker,channel:broker,account_id:'A'};
  return {...scope,executions:[{...scope,id:'fill',order_id:'order',native_symbol:'US.AVGO261218C400000',symbol:'AVGO',instrument:'option',side:'sell',effect:'open',
    executed_at:'2026-10-07T10:46:31',clock:'America/New_York',currency:'USD',quantity:'1',price:'19.50',multiplier:'100',gross_cash:'1950.00',fee_cash:null,
    option:{right:'call',expiry:'2026-12-18',strike:'400'}}],orders:[],sync:{version:1,mode:'full',from:'2000-01-01T00:00:00.000Z',through:'2026-10-13T00:00:00.000Z',status:'complete',full_history_synced:true,fees:'unavailable',gaps:[]}};
}
const state = ():InvestorState=>({user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01'},profile:{display_name:'Test',contact_email:''},log:[]});
describe('shared broker history',()=>{
  it('requests full history when missing, partial, unmarked or bound to another account; overlaps completed history',()=>{
    const now=new Date('2026-10-14T00:00:00Z'), old=history();
    expect(planBrokerHistorySync(undefined,'A',now).mode).toBe('full');
    expect(planBrokerHistorySync(old,'B',now).mode).toBe('full');
    old.sync.full_history_synced=false; expect(planBrokerHistorySync(old,'A',now).mode).toBe('full');
    old.sync.full_history_synced=true;old.sync.status='partial'; expect(planBrokerHistorySync(old,'A',now).mode).toBe('full');
    old.sync.status='complete';expect(planBrokerHistorySync(old,'A',now)).toEqual({mode:'incremental',from:'2026-10-11T00:00:00.000Z',through:now.toISOString()});
  });
  it('enriches unknown economics, retains old records, and rejects conflicting fills and cross-account history',()=>{
    const unknown=history();Object.assign(unknown.executions[0],{multiplier:null,gross_cash:null});
    unknown.sync={...unknown.sync,status:'partial',full_history_synced:false,gaps:[{kind:'metadata',reference:unknown.executions[0].native_symbol,reason:'missing multiplier'}]};
    expect(optionExecutionsFromHistory(unknown)).toEqual([]);
    const enriched=mergeBrokerHistory(unknown,history());
    expect(enriched.executions[0].gross_cash).toBe('1950.00');expect(enriched.sync.full_history_synced).toBe(true);
    const incremental=history();incremental.executions=[];incremental.sync.mode='incremental';incremental.sync.through='2026-10-14T00:00:00.000Z';
    expect(mergeBrokerHistory(enriched,incremental).executions).toHaveLength(1);
    const conflict=history();conflict.executions[0].price='20';expect(()=>mergeBrokerHistory(enriched,conflict)).toThrow(/Conflicting/);
    expect(()=>mergeBrokerHistory(enriched,history('tiger'))).toThrow(/binding/);
    const mixed=history();mixed.executions[0].account_id='B';expect(()=>assertBrokerHistory(mixed)).toThrow(/mismatch/);
    expect(mergeBrokerHistory(enriched,unknown).sync).toMatchObject({status:'complete',full_history_synced:true,gaps:[]});
  });
  it('deduplicates equivalent decimal scale and enriches fees without accepting changed economics',()=>{
    const a=history(),b=history();Object.assign(b.executions[0],{quantity:'1.000',price:'19.500',multiplier:'100.0',gross_cash:'1950.000',fee_cash:'-2.63'});
    b.executions[0].option!.strike='400.00';
    expect(mergeBrokerHistory(a,b).executions).toHaveLength(1);
    const rows=mergeOptionExecutions(optionExecutionsFromHistory(a),optionExecutionsFromHistory(b));
    expect(rows).toHaveLength(1);expect(rows[0].commission).toBe('-2.63');
    expect(()=>mergeOptionExecutions(rows,[{...rows[0],commission:'-3'}])).toThrow(/conflict/i);
  });
  it('lets the agent query unresolved activity and coverage with null cash',()=>{
    const h=history();h.executions[0].multiplier=null;h.executions[0].gross_cash=null;
    h.sync.status='partial';h.sync.full_history_synced=false;h.sync.gaps=[{kind:'metadata',reference:'US.AVGO261218C400000',reason:'missing metadata'}];
    const s={state:{...state(),broker_history:{moomoo:h}},revision:1};
    expect(runQuery(s,{from:'broker_executions',select:['id','gross_cash','multiplier','clock']}).rows).toEqual([{id:'fill',gross_cash:null,multiplier:null,clock:'America/New_York'}]);
    expect(runQuery(s,{from:'broker_history_sync',select:['status','full_history_synced','fees']}).rows).toEqual([{status:'partial',full_history_synced:false,fees:'unavailable'}]);
    expect(runQuery(s,{from:'broker_history_gaps',select:['reason']}).rows).toEqual([{reason:'missing metadata'}]);
  });
  it.each(['moomoo','ibkr','tiger','webull'])('applies %s history through the same projection and preserves other accounts',async broker=>{
    const s=state();s.broker_connections={conn:{broker_id:broker,channel:broker,account_id:'A'}} as InvestorState['broker_connections'];
    s.broker_history={other:history('other')};
    await applyBrokerStatement({state:s,revision:1},'conn',{account_id:'A',as_of:'2026-10-14',cash:[],lots:[],skipped:[],history:history(broker)},undefined,undefined,{brokerId:broker,channel:broker});
    expect(s.broker_history![broker].executions).toHaveLength(1);expect(s.broker_history!.other.executions).toHaveLength(1);
    expect(s.option_executions![0].gross_premium).toBe('1950.00');
  });
  it('rejects conflicting history before any cash or holdings mutation',async()=>{
    const s=state();s.broker_connections={conn:{broker_id:'moomoo',channel:'moomoo',account_id:'A'}} as InvestorState['broker_connections'];s.broker_history={moomoo:history()};
    const before=structuredClone(s),bad=history();bad.executions[0].price='20';
    await expect(applyBrokerStatement({state:s,revision:1},'conn',{account_id:'A',as_of:'2026-10-14',cash:[{amount:500,currency:'USD'}],lots:[],skipped:[],history:bad},undefined,undefined,{brokerId:'moomoo',channel:'moomoo'})).rejects.toThrow(/Conflicting/);
    expect(s).toEqual(before);
  });
  it('locks account binding when retained history is the only imported data',()=>{
    const s=state(),source=addBrokerSource(s,'ibkr',{token:'secret'}),id=addBrokerAccount(s,{source_id:source,account_id:'A',label:'A',config:{activity_query_id:'1'}});
    const channel=readBrokerAccountModel(s).connections[id].channel,h=history('ibkr');h.channel=channel;h.executions.forEach(e=>e.channel=channel);s.broker_history={[channel]:h};
    expect(()=>patchBrokerAccount(s,id,{account_id:'B'})).toThrow(/cannot be changed/);
  });
});
