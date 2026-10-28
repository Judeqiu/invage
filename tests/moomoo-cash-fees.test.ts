import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {fetchMooMooRawBundle} from '../src/moomoo/moomoo-client.js';
import {mapMooMooBundleToStatement} from '../src/moomoo/moomoo-map.js';
import {mergeBrokerHistory,assertHistoryExecution} from '../src/brokers/history.js';
import {cashLogAmount} from '../src/moomoo/moomoo-cash-fees.js';
import type {MooMooRawBundle} from '../src/moomoo/moomoo-types.js';
const codes=['US.AVGO261016C350000','US.AVGO261016C370000'];
const from='2026-07-01T00:00:00.000Z',through='2026-10-28T00:00:00.000Z';
const timestamp=String(Date.parse('2026-10-07T14:00:00Z')*1000);
function fixture(broker:'moomoo'|'futubull'='moomoo'):MooMooRawBundle {
 const parent={order_id:'P',code:'US.AVGO',side:'SELL',order_type:'LIMIT',order_status:'FILLED_ALL',currency:'USD',create_time:timestamp,updated_time:timestamp,qty:'1',dealt_qty:'1',price:'1',dealt_avg_price:'1',multi_leg_info:{leg_infos:codes.map((code,i)=>({leg_code:code,leg_side:i?'SELL_SHORT':'BUY',leg_ratio_qty:'1',leg_security_type:'OPTION',leg_hp_multiplier:'100'}))}};
 return {schema:broker==='moomoo'?'invage.moomoo.raw.v1':'invage.futubull.cloud.raw.v1',acc_id:'A',fetched_at:through,authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'100'}},positions:{s:'ok',d:[]},history_mode:'full',fills_history:{start:String(Date.parse(from)*1000),end:String(Date.parse(through)*1000),rows:codes.map((code,i)=>({deal_id:String(i),order_id:'P',code,trd_side:i?'SELL_SHORT':'BUY',qty:'1',price:i?'5':'4',status:'OK',create_time:timestamp}))},orders_history:{start:String(Date.parse(from)*1000),end:String(Date.parse(through)*1000),rows:[parent]},orders_details:[parent],orders_fees:[{order_id:'P',currency:'USD',total_fee:'6.70',fees:[{type:'Commission',amount:'6.70'}]}],cash_logs:codes.map((code,i)=>({code,from,through,complete:true,rows:[{symbol:code.slice(3),transaction_name:`Option ${i?'Sell':'Buy'} Fee`,cash_change:i?'-3.41':'-3.29',balance:'Balance: -1,000.00 USD'},{symbol:code.slice(3),transaction_name:`Option ${i?'Sell':'Buy'} Execution`,cash_change:i?'+500.00':'-400.00'}]}))};
}
const history=(raw:MooMooRawBundle)=>mapMooMooBundleToStatement(raw,raw.schema==='invage.moomoo.raw.v1'?'moomoo':'futubull').history!;
describe.each(['moomoo','futubull'] as const)('%s Cloud cash-log fees',broker=>{
 it('uses exact leg fees, preserves source bytes, and enriches old history idempotently',()=>{
  const raw=fixture(broker),before=JSON.stringify(raw),h=history(raw);
  expect(h.executions.map(e=>Number(e.fee_cash))).toEqual([-3.29,-3.41]);
  expect(h.sync.fees).toBe('available');expect(h.broker_id).toBe(broker);
  for(const row of h.executions){expect(row.fee_source?.references).toHaveLength(2);expect(assertHistoryExecution(row)).toEqual(row);}
  expect(JSON.stringify(raw)).toBe(before);
  const oldRaw=fixture(broker);delete oldRaw.cash_logs;const old=history(oldRaw);
  h.sync.mode='incremental';expect(mergeBrokerHistory(old,h).executions).toEqual(h.executions);
  expect(mergeBrokerHistory(h,h).executions).toEqual(h.executions);
  old.sync.mode='incremental';expect(mergeBrokerHistory(h,old).executions).toEqual(h.executions);
 });
 it.each(['partial','currency','parent-total','gross','duplicate-fee','foreign-symbol','ambiguous-order'] as const)('retains unknown fees on %s evidence',kind=>{
  const raw=fixture(broker),group=raw.cash_logs![0];
  if(kind==='partial')group.complete=false;
  if(kind==='currency')group.rows[0].balance='Balance: 1 HKD';
  if(kind==='parent-total')raw.orders_fees![0].total_fee='6.71';
  if(kind==='gross')group.rows[1].cash_change='-401.00';
  if(kind==='duplicate-fee')group.rows.push({...group.rows[0]});
  if(kind==='foreign-symbol')group.rows[0].symbol='OTHER';
  if(kind==='ambiguous-order')raw.fills_history!.rows.push({...raw.fills_history!.rows[0],deal_id:'other',order_id:'other'});
  const h=history(raw);expect(h.executions.every(e=>e.fee_cash===null)).toBe(true);
  expect(h.sync.gaps.some(g=>g.reason.startsWith('Cash-log fee enrichment:'))).toBe(true);
  const repaired=history(fixture(broker));repaired.sync.mode='incremental';
  if(kind!=='ambiguous-order')expect(mergeBrokerHistory(h,repaired).sync.gaps).toEqual([]);
 });
 it('preserves explicit zero charges and rebates',()=>{
  const raw=fixture(broker);raw.cash_logs![0].rows[0].cash_change='+0.20';raw.cash_logs![1].rows[0].cash_change='0';raw.orders_fees![0].total_fee='-0.20';
  expect(history(raw).executions.map(e=>Number(e.fee_cash))).toEqual([0.2,0]);
 });
 it('rejects cash rows from a different account',()=>{
  const raw=fixture(broker);raw.cash_logs![0].rows[0].account_id='other';expect(()=>history(raw)).toThrow(/account mismatch/);
 });
 it.each([false,true])('paginates signed cash queries and recovers older pending fills on incremental sync (partial=%s)',async partial=>{
  vi.useFakeTimers();
  try{
   const raw=fixture(broker),oldRaw=fixture(broker);delete oldRaw.cash_logs;const old=history(oldRaw);
   const requests:URL[]=[];
   const fetchImpl:typeof fetch=async(url)=>{
    const u=new URL(String(url));requests.push(u);
    if(u.pathname.endsWith('/authorized_trd_accs'))return Response.json({s:'ok',d:[{account_id:'A'}]});
    if(u.pathname.endsWith('/funds'))return Response.json(raw.funds);
    if(u.pathname.endsWith('/positions'))return Response.json(raw.positions);
    if(u.pathname.endsWith('/fills_history'))return Response.json({s:'ok',d:{completed:true,order_fills:raw.fills_history!.rows.filter(r=>r.code===u.searchParams.get('code'))}});
    if(u.pathname.endsWith('/orders_history'))return Response.json({s:'ok',d:{completed:true,orders:[]}});
    if(u.pathname.endsWith('/orders/detail'))return Response.json({s:'ok',d:raw.orders_details});
    if(u.pathname.endsWith('/fees'))return Response.json({s:'ok',d:raw.orders_fees![0]});
    if(u.pathname.endsWith('/stock-basicinfo'))return Response.json({ret_code:-7});
    if(u.pathname.endsWith('/cash_logs')){
     const group=raw.cash_logs!.find(g=>g.code===u.searchParams.get('code'))!;
     if(u.searchParams.has('page_flag')&&partial)return new Response('',{status:403});
     return Response.json({s:'ok',d:{completed:u.searchParams.has('page_flag'),page_flag:'next',cash_logs:[group.rows[u.searchParams.has('page_flag')?1:0]]}});
    }
    throw Error('Unexpected path '+u.pathname);
   };
   const pending=fetchMooMooRawBundle({broker,app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519',acc_id:'A'},{fetchImpl,history:{mode:'incremental',from:'2026-10-27T00:00:00.000Z',through},retainedHistory:old});
   await vi.runAllTimersAsync();const result=await pending;
   expect(new Set(requests.map(u=>u.hostname))).toEqual(new Set([broker==='moomoo'?'webapi.moomoo.com':'webapi.futunn.com']));
   const cashRequests=requests.filter(u=>u.pathname.endsWith('/cash_logs'));
   expect(cashRequests).toHaveLength(4);expect(cashRequests[0].searchParams.get('begin_time')).toBe(String(Date.parse(from)*1000));
   expect(result.fee_fills_history).toHaveLength(2);expect(result.cash_logs!.every(g=>g.complete===!partial)).toBe(true);
   const merged=mergeBrokerHistory(old,history(result));expect(merged.executions).toHaveLength(2);
   expect(merged.executions.every(e=>partial?e.fee_cash===null:e.fee_cash!==null)).toBe(true);
   expect(result.history_error).toBeUndefined();
  }finally{vi.useRealTimers();}
 });
});
it('parses signed grouped money exactly and rejects malformed amounts',()=>{
 expect(cashLogAmount('+1,234.5600')).toBe('1234.5600');expect(cashLogAmount('-0.01')).toBe('-0.01');
 for(const value of ['1,23','1e3','NaN',null,1])expect(()=>cashLogAmount(value)).toThrow();
});
