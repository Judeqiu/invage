import { describe,expect,it,vi } from 'vitest';
import { assertBrokerHistory, mergeBrokerHistory, planBrokerHistorySync, optionExecutionsFromHistory, type BrokerHistory } from '../src/brokers/history.js';
import { mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { runQuery } from '../src/data-query/engine.js';
import { getCashes, type InvestorState } from '../src/state/portfolio-state.js';
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
function allocatedHistory(broker = 'tiger'): BrokerHistory {
  const h = history(broker), fill = h.executions[0];
  h.executions = [
    {...fill, id:'first', quantity:'20', fee_cash:'-0.645333333333'},
    {...fill, id:'second', quantity:'55', fee_cash:'-1.774666666667'},
  ];
  h.orders = [{broker_id:broker,channel:broker,account_id:'A',id:'order',native_symbol:fill.native_symbol,
    side:'sell',status:'Filled',created_at:fill.executed_at,updated_at:fill.executed_at,clock:fill.clock,currency:'USD',
    quantity:'75',filled_quantity:'75',limit_price:'19.50',filled_price:'19.50',order_type:'LMT',time_in_force:null,session:null,legs:[],
    fees:{currency:'USD',total:'2.42',items:[{type:'commission',amount:'2.22'},{type:'gst',amount:'0.20'}]}}];
  return h;
}
function reversedRemainder(broker = 'tiger'): BrokerHistory {
  const h = allocatedHistory(broker);
  h.executions[0].fee_cash = '-0.645333333334';
  h.executions[1].fee_cash = '-1.774666666666';
  return h;
}
describe('shared broker history',()=>{
  it.each(['tiger','ibkr','moomoo','futubull','webull','future-broker'])('preserves the exact %s fee total and stored allocation when only the proportional rounding remainder moves', broker => {
    const old = allocatedHistory(broker), incoming = reversedRemainder(broker), before = structuredClone(incoming);
    expect(mergeBrokerHistory(old, incoming).executions.map(row => row.fee_cash)).toEqual(old.executions.map(row => row.fee_cash));
    expect(incoming).toEqual(before);
    expect(mergeBrokerHistory(incoming, old).executions.map(row => row.fee_cash)).toEqual(incoming.executions.map(row => row.fee_cash));
  });
  it('uses the precision of broker records without a fixed decimal tolerance',()=>{
    const old=allocatedHistory('webull'),incoming=reversedRemainder('webull');
    [old.executions[0].fee_cash,old.executions[1].fee_cash]=['-0.64','-1.78'];
    [incoming.executions[0].fee_cash,incoming.executions[1].fee_cash]=['-0.65','-1.77'];
    expect(mergeBrokerHistory(old,incoming).executions.map(e=>e.fee_cash)).toEqual(['-0.64','-1.78']);
  });
  it.each(['total','distribution','missing fill','price','currency','unproved fee','account binding','filled quantity'])('rejects changed or unproved fee economics: %s', change => {
    const old = allocatedHistory(), incoming = reversedRemainder();
    if (change === 'total') incoming.orders[0].fees!.total = '2.43';
    if (change === 'distribution') { incoming.executions[0].fee_cash = '-0.655333333333'; incoming.executions[1].fee_cash = '-1.764666666667'; }
    if (change === 'missing fill') incoming.executions.pop();
    if (change === 'price') incoming.executions[0].price = '20';
    if (change === 'currency') incoming.orders[0].fees!.currency = 'SGD';
    if (change === 'unproved fee') delete old.orders[0].fees;
    if (change === 'account binding') { incoming.account_id='B';incoming.executions.forEach(e=>e.account_id='B');incoming.orders.forEach(o=>o.account_id='B'); }
    if (change === 'filled quantity') old.orders[0].filled_quantity='76';
    expect(() => mergeBrokerHistory(old,incoming)).toThrow(/Conflicting|binding/);
  });
  it.each(['tiger','ibkr','moomoo','futubull','webull'])('uses the same retained %s rounding allocation in history and option projections on replay', async broker => {
    const old=allocatedHistory(broker),incoming=reversedRemainder(broker),s=state();
    s.broker_connections={conn:{broker_id:broker,channel:broker,account_id:'A'}} as InvestorState['broker_connections'];
    s.broker_history={[broker]:old};s.option_executions=optionExecutionsFromHistory(old);
    const result=await applyBrokerStatement({state:s,revision:1},'conn',{account_id:'A',as_of:'2026-10-14',cash:[],lots:[],skipped:[],history:incoming,
      option_executions:optionExecutionsFromHistory(incoming)},undefined,undefined,{brokerId:broker,channel:broker},
      {rawDataId:'broker-sync/tiger/evidence.json',deferHistoryConflicts:true});
    expect(result.historyReconciliationDeferred).toBeUndefined();expect(result.skipped).toEqual([]);
    expect(s.broker_history![broker].executions.map(e=>e.fee_cash)).toEqual(old.executions.map(e=>e.fee_cash));
    expect(s.option_executions).toEqual(optionExecutionsFromHistory(old));
  });
  it.each(['USD','JPY','KWD','USDT'])('retains exact fee allocation for %s without assuming two currency decimals',currency=>{
    const old=allocatedHistory(),incoming=reversedRemainder();
    for(const h of [old,incoming]) {
      h.orders[0].currency=currency;h.orders[0].fees!.currency=currency;
      h.executions.forEach(e=>e.currency=currency);
    }
    expect(mergeBrokerHistory(old,incoming).executions.map(e=>e.fee_cash)).toEqual(old.executions.map(e=>e.fee_cash));
  });
  it('uses latest bounds for missing or partial history and backfills only on explicit full sync',()=>{
    const now=new Date('2026-10-14T00:00:00Z'), old=history();
    expect(planBrokerHistorySync(undefined,'A',now).mode).toBe('incremental');
    expect(planBrokerHistorySync(old,'B',now).mode).toBe('incremental');
    old.sync.full_history_synced=false; expect(planBrokerHistorySync(old,'A',now).mode).toBe('incremental');
    old.sync.full_history_synced=true;old.sync.status='partial'; expect(planBrokerHistorySync(old,'A',now).mode).toBe('incremental');
    expect(planBrokerHistorySync(old,'A',now,true)).toMatchObject({mode:'full',from:'2000-01-01T00:00:00.000Z'});
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
  it.each(['moomoo','futubull','tiger','webull','ibkr'])('saves %s cash and positions while retaining conflicting history for review at the next regular sync',async broker=>{
    const s=state();s.broker_connections={conn:{broker_id:broker,channel:broker,account_id:'A'}} as InvestorState['broker_connections'];
    s.broker_history={[broker]:history(broker)};s.option_executions=optionExecutionsFromHistory(history(broker));
    const oldHistory=structuredClone(s.broker_history), oldExecutions=structuredClone(s.option_executions);
    const bad=history(broker);bad.executions[0].price='20';
    const result=await applyBrokerStatement({state:s,revision:1},'conn',{account_id:'A',as_of:'2026-10-14',cash:[{amount:500,currency:'USD'}],lots:[],skipped:[],history:bad},
      undefined,undefined,{brokerId:broker,channel:broker},{rawDataId:'broker-sync/moomoo/evidence.json',syncId:'sync',deferHistoryConflicts:true});
    expect(getCashes(s)[0].amount).toBe(500);
    expect(s.broker_history).toEqual(oldHistory);expect(s.option_executions).toEqual(oldExecutions);
    expect(s.log).toContainEqual(expect.objectContaining({action:'broker_history_deferred',raw_data_id:'broker-sync/moomoo/evidence.json'}));
    expect(result.historyReconciliationDeferred).toBe(true);
    expect(result.skipped).toContainEqual(expect.objectContaining({kind:'event',reason:expect.stringContaining('needs review')}));
    expect(result.skipped.some(row => row.reason.includes('reconciliation queued'))).toBe(false);
  });
  it('retains existing holdings and cash rather than applying an incomplete current snapshot',async()=>{
    const s=state();const before=structuredClone(s);
    await expect(applyBrokerStatement({state:s,revision:1},'moomoo',{account_id:'A',as_of:'2026-10-14',cash:[],lots:[],skipped:[{kind:'position',reason:'Position sleeve unavailable'}]},undefined,undefined,undefined,{requireCompleteSnapshot:true})).rejects.toThrow('current snapshot is incomplete');
    expect(s).toEqual(before);
  });
  it('allows explicitly documented nonblocking account totals while preserving their notices',async()=>{
    const s=state();
    const skipped=[{kind:'position' as const,reason:'Fund account aggregate retained separately',blocking:false}];
    const result=await applyBrokerStatement({state:s,revision:1},'moomoo',{account_id:'A',as_of:'2026-10-14',cash:[],lots:[],skipped},undefined,undefined,undefined,{requireCompleteSnapshot:true});
    expect(result.skipped).toEqual(skipped);expect(s.option_observations?.[0].skipped_positions).toBe(0);
  });
  it('locks account binding when retained history is the only imported data',()=>{
    const s=state(),source=addBrokerSource(s,'ibkr',{token:'secret'}),id=addBrokerAccount(s,{source_id:source,account_id:'A',label:'A',config:{activity_query_id:'1'}});
    const channel=readBrokerAccountModel(s).connections[id].channel,h=history('ibkr');h.channel=channel;h.executions.forEach(e=>e.channel=channel);s.broker_history={[channel]:h};
    expect(()=>patchBrokerAccount(s,id,{account_id:'B'})).toThrow(/cannot be changed/);
  });
});
