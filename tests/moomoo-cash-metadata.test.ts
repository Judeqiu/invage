import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import type {MooMooRawBundle} from '../src/moomoo/moomoo-types.js';
import {mapMooMooBundleToStatement} from '../src/moomoo/moomoo-map.js';
import {recoverMooMooCashMultipliers} from '../src/moomoo/moomoo-cash-metadata.js';
import {fetchMooMooRawBundle} from '../src/moomoo/moomoo-client.js';
import {mergeBrokerHistory} from '../src/brokers/history.js';
import {recoverRetainedMooMooCash} from '../src/moomoo/moomoo-cash-recovery.js';

const code='US.PATH260821P12000',from='2026-07-01T00:00:00.000Z',through='2026-10-28T00:00:00.000Z';
const at=Date.parse('2026-07-09T14:52:42Z')*1000;
function fixture(broker:'moomoo'|'futubull'='moomoo'):MooMooRawBundle {
 return {schema:broker==='moomoo'?'invage.moomoo.raw.v1':'invage.futubull.cloud.raw.v1',acc_id:'A',fetched_at:through,authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'100'}},positions:{s:'ok',d:[]},history_mode:'full',fills_history:{start:String(Date.parse(from)*1000),end:String(Date.parse(through)*1000),rows:[
  {deal_id:'one',order_id:'open',code,trd_side:'SELL_SHORT',qty:'4',price:'1.25',status:'OK',create_time:at},
  {deal_id:'two',order_id:'open',code,trd_side:'SELL_SHORT',qty:'7',price:'1.25',status:'OK',create_time:at+1000000},
  {deal_id:'zero',order_id:'close',code,trd_side:'BUY_BACK',qty:'11',price:'0',status:'OK',create_time:at+2000000},
 ]},orders_history:{start:String(Date.parse(from)*1000),end:String(Date.parse(through)*1000),rows:[]},cash_logs:[{code,from,through,complete:true,rows:[
  {symbol:code.slice(3),transaction_name:'Option Sell Execution',cash_change:'+500.00',balance:'Balance: 500 USD'},
  {symbol:code.slice(3),transaction_name:'Option Sell Execution',cash_change:'+875.00',balance:'Balance: 1375 USD'},
 ]}]};
}
describe.each(['moomoo','futubull'] as const)('%s cash-backed historical contract metadata',broker=>{
 it('recovers the actual split-fill example and zero-priced close without altering source records',()=>{
  const raw=fixture(broker),before=JSON.stringify(raw);const s=mapMooMooBundleToStatement(raw,broker);
  expect(s.option_executions!.map(e=>e.gross_premium)).toEqual(['-0','875.00','500.00']);
  expect(s.history!.executions.every(e=>e.multiplier==='100')).toBe(true);
  expect(s.history!.sync.gaps).toEqual([]);expect(JSON.stringify(raw)).toBe(before);
 });
 it('derives adjusted sizes and preserves negative quoted prices instead of assuming 100',()=>{
  const raw=fixture(broker);raw.fills_history!.rows=raw.fills_history!.rows.slice(0,1);
  Object.assign(raw.fills_history!.rows[0],{qty:'2',price:'-3',trd_side:'BUY_BACK'});
  raw.cash_logs![0].rows=[{symbol:code.slice(3),transaction_name:'Option Buy Execution',cash_change:'+150.00',balance:'Balance: 150 USD'}];
  const e=mapMooMooBundleToStatement(raw,broker).history!.executions[0];
  expect(e).toMatchObject({price:'-3',side:'buy',multiplier:'25',gross_cash:'150'});
 });
 it('accepts exact parent-order cash when the broker aggregates split fills',()=>{
  const raw=fixture(broker);raw.cash_logs![0].rows=[{...raw.cash_logs![0].rows[0],cash_change:'+1,375.00'}];
  expect(recoverMooMooCashMultipliers(raw,new Map()).get(code)).toBe('100');
 });
 it.each(['partial','interval','currency','amounts','zero-only','side-conflict'] as const)('keeps unknown metadata for %s evidence',kind=>{
  const raw=fixture(broker);
  if(kind==='partial')raw.cash_logs![0].complete=false;
  if(kind==='interval')raw.fills_history!.start=String(Date.parse('2026-08-01T00:00:00Z')*1000);
  if(kind==='currency')raw.cash_logs![0].rows[0].balance='Balance: 500 HKD';
  if(kind==='amounts'){raw.cash_logs![0].rows[0].cash_change='501';raw.cash_logs![0].rows[1].cash_change='874';}
  if(kind==='zero-only'){raw.fills_history!.rows=raw.fills_history!.rows.slice(2);raw.cash_logs![0].rows=[];}
  if(kind==='side-conflict'){raw.fills_history!.rows[2].price='1';raw.cash_logs![0].rows.push({symbol:code.slice(3),transaction_name:'Option Buy Execution',cash_change:'-1111',balance:'Balance: 1 USD'});}
  expect(recoverMooMooCashMultipliers(raw,new Map()).size).toBe(0);
 });
 it('requires matching accounts and rejects conflicting repeated fills',()=>{
  const raw=fixture(broker);raw.cash_logs![0].rows[0].account_id='other';expect(()=>recoverMooMooCashMultipliers(raw,new Map())).toThrow(/account mismatch/);
  delete raw.cash_logs![0].rows[0].account_id;raw.fee_fills_history=[{code,from,through,rows:[{...raw.fills_history!.rows[0],price:'2'}]}];
  expect(()=>recoverMooMooCashMultipliers(raw,new Map())).toThrow(/Conflicting/);
 });
 it('recovers old single-option fills and paginates cash on incremental sync',async()=>{
  vi.useFakeTimers();try{
   const raw=fixture(broker),oldRaw=fixture(broker);delete oldRaw.cash_logs;
   const old=mapMooMooBundleToStatement(oldRaw,broker).history!;const requests:URL[]=[];
   const fetchImpl:typeof fetch=async url=>{const u=new URL(String(url));requests.push(u);
    if(u.pathname.endsWith('/authorized_trd_accs'))return Response.json({s:'ok',d:[{account_id:'A'}]});
    if(u.pathname.endsWith('/funds'))return Response.json(raw.funds);
    if(u.pathname.endsWith('/positions'))return Response.json(raw.positions);
    if(u.pathname.endsWith('/fills_history'))return Response.json({s:'ok',d:{completed:true,order_fills:u.searchParams.has('code')?raw.fills_history!.rows:[]}});
    if(u.pathname.endsWith('/orders_history'))return Response.json({s:'ok',d:{completed:true,orders:[]}});
    if(u.pathname.endsWith('/orders/detail'))return Response.json({s:'ok',d:[]});
    if(u.pathname.endsWith('/fees'))return Response.json({s:'ok',d:{}});
    if(u.pathname.endsWith('/stock-basicinfo'))return Response.json({ret_code:-7});
    if(u.pathname.endsWith('/cash_logs'))return Response.json({s:'ok',d:{completed:u.searchParams.has('page_flag'),page_flag:'next',cash_logs:[raw.cash_logs![0].rows[u.searchParams.has('page_flag')?1:0]]}});
    throw Error('Unexpected URL '+u.pathname);
   };
   const pending=fetchMooMooRawBundle({broker,app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519',acc_id:'A'},{fetchImpl,history:{mode:'incremental',from:'2026-10-27T00:00:00.000Z',through},retainedHistory:old});
   await vi.runAllTimersAsync();const result=await pending;
   expect(result.history_error).toBeUndefined();expect(result.fee_fills_history).toHaveLength(1);
   expect(requests.filter(u=>u.pathname.endsWith('/cash_logs'))).toHaveLength(2);
   expect(new Set(requests.map(u=>u.hostname))).toEqual(new Set([broker==='moomoo'?'webapi.moomoo.com':'webapi.futunn.com']));
   const merged=mergeBrokerHistory(old,mapMooMooBundleToStatement(result,broker).history!);
   expect(merged.executions).toHaveLength(3);expect(merged.executions.every(e=>e.multiplier==='100')).toBe(true);
   expect(merged.sync.gaps.some(g=>g.kind==='metadata')).toBe(false);
  }finally{vi.useRealTimers();}
 });
});
describe('retained API cash repair',()=>{
 it('preserves fees and identity, clears resolved gaps, and is idempotent',()=>{
  const raw=fixture(),missing=structuredClone(raw);delete missing.cash_logs;
  const source=mapMooMooBundleToStatement(missing,'moomoo').history!;
  source.executions.forEach(e=>e.fee_cash='-0.25');
  const before=structuredClone(source),result=recoverRetainedMooMooCash(source,source,raw);
  expect(result.recovered).toHaveLength(3);
  expect(result.history.executions.every(e=>e.multiplier==='100'&&e.fee_cash==='-0.25')).toBe(true);
  expect(result.history.sync.gaps.filter(g=>g.kind==='metadata')).toEqual([]);
  expect(source).toEqual(before);
  expect(recoverRetainedMooMooCash(result.history,source,raw).recovered).toEqual([]);
  const changed=structuredClone(raw);changed.fills_history!.rows[0].qty='5';
  expect(()=>recoverRetainedMooMooCash(source,source,changed)).toThrow(/no longer matches/);
  const wrong=structuredClone(result.history);wrong.executions[0].gross_cash='999';
  expect(()=>recoverRetainedMooMooCash(wrong,source,raw)).toThrow(/conflicts/);
 });
 it('checks individual cash even when signed prices cancel to zero',()=>{
  const raw=fixture();raw.fills_history!.rows.push({...raw.fills_history!.rows[2],deal_id:'negative',qty:'1',price:'-1'}, {...raw.fills_history!.rows[2],deal_id:'positive',qty:'1',price:'1'});
  raw.cash_logs![0].rows.push({symbol:code.slice(3),transaction_name:'Option Buy Execution',cash_change:'200',balance:'Balance: 0 USD'},{symbol:code.slice(3),transaction_name:'Option Buy Execution',cash_change:'-200',balance:'Balance: 0 USD'});
  expect(recoverMooMooCashMultipliers(raw,new Map()).size).toBe(0);
 });
});
