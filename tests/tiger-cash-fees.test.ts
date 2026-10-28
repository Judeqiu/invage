import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {mapTigerHistory} from '../src/tiger/tiger-history.js';
import {fetchTigerFundDetails,fetchTigerRawBundle} from '../src/tiger/tiger-client.js';
import {mergeBrokerHistory} from '../src/brokers/history.js';
import type {TigerRawBundle} from '../src/tiger/tiger-types.js';
const at=Date.parse('2024-05-28T15:40:28Z');
function fixture():TigerRawBundle{
 const legs=['20240531','20240816'].map((expiry,i)=>({symbol:'PLTR',expiry,strike:'22.0',right:'PUT',action:i?'SELL':'BUY',secType:'OPT',ratio:'1',market:'US',currency:'USD',multiplier:'100'}));
 let id=100;
 const cash=legs.flatMap((leg,i)=>[
  {type:'Trade',desc:`${i?'Sell':'Buy'}-PLTR ${leg.expiry} PUT 22.0`,amount:i?'2832':'-1092'},
  {type:'GST',amount:i?'-0.76':'-0.75'},
  {type:'Platform Fee',desc:`${i?'Sell':'Buy'}-PLTR ${leg.expiry} PUT 22.0`,amount:i?'-8.47':'-8.36'}
 ].map(r=>({...r,id:String(id++),currency:'USD',segType:'SEC',businessDate:'2024-05-28',updatedAt:at+1000})));
 return {schema:'invage.tiger.raw.v1',fetched_at:new Date(at).toISOString(),gateway:'https://openapi.tigerfintech.com/gateway',account:'A',license:'TBSG',account_kind:'prime',managed_accounts:null,assets:{method:'prime_assets',envelope:{code:0,data:{}}},positions:{STK:{code:0,data:{}},OPT:{code:0,data:{}},FUND:{code:0,data:{}}},history:{start:at-86400000,end:at+86400000,mode:'full',gaps:[],orders:[{id:'P',account:'A',secType:'MLEG',market:'US',symbol:'PLTR',currency:'USD',action:'BUY',status:'Filled',filledQuantity:'12',totalQuantity:'12',orderType:'LMT',openTime:at,commission:'16.83',gst:'1.51',legs}],transactions:legs.map((leg,i)=>({...leg,id:'fill'+i,orderId:'P',accountId:'A',filledQuantity:'12',filledPrice:i?'2.36':'0.91',filledAmount:i?'2832':'1092',transactionTime:at})),fund_details:{from:'2024-05-28',through:'2024-05-29',complete:true,rows:cash}}};
}
describe('Tiger broker cash fee blocks',()=>{
 it('links approved unlabeled GST blocks and conserves parent fees without changing raw evidence',()=>{
  const raw=fixture(),before=structuredClone(raw),h=mapTigerHistory(raw,[],'tiger')!;
  expect(h.executions.map(f=>Number(f.fee_cash))).toEqual([-9.11,-9.23]);
  expect(h.executions.every(e=>e.fee_source?.references.length===3)).toBe(true);
  expect(h.sync.fees).toBe('available');expect(raw).toEqual(before);
  expect(mergeBrokerHistory(h,h).executions).toEqual(h.executions);
  const prior=fixture();delete prior.history!.fund_details;
  expect(mergeBrokerHistory(mapTigerHistory(prior,[],'tiger')!,h).executions).toEqual(h.executions);
 });
 it.each(['partial','currency','gross','parent','GST-time','GST-missing','foreign-contract','duplicate-id','ambiguous-parent','foreign-account'] as const)('keeps fees unknown for %s evidence',kind=>{
  const raw=fixture(),evidence=raw.history!.fund_details!,rows=evidence.rows;
  if(kind==='partial')evidence.complete=false;
  if(kind==='currency')rows[0].currency='HKD';
  if(kind==='gross')rows[0].amount='-1093';
  if(kind==='parent')raw.history!.orders[0].gst='1.52';
  if(kind==='GST-time')rows[1].updatedAt=at+2000;
  if(kind==='GST-missing')rows.splice(1,1);
  if(kind==='foreign-contract')rows[2].desc='Buy-OTHER 20240531 PUT 22.0';
  if(kind==='duplicate-id')rows[1].id=rows[0].id;
  if(kind==='ambiguous-parent')raw.history!.transactions.push({...raw.history!.transactions[0],id:'other',orderId:'other'});
  if(kind==='foreign-account'){rows[0].accountId='B';expect(()=>mapTigerHistory(raw,[],'tiger')).toThrow(/account/);return;}
  const h=mapTigerHistory(raw,[],'tiger')!;expect(h.executions.every(e=>e.fee_cash===null)).toBe(true);
  expect(h.sync.gaps.some(g=>g.reason.startsWith('Tiger cash-log fee enrichment:'))).toBe(true);
 });
 it('clears recovered cash-fee gaps while preserving unrelated order-intent gaps',()=>{
  const raw=fixture();raw.history!.fund_details!.complete=false;const prior=mapTigerHistory(raw,[],'tiger')!;
  const next=mapTigerHistory(fixture(),[],'tiger')!;next.sync.mode='incremental';
  const merged=mergeBrokerHistory(prior,next);
  expect(merged.sync.gaps.some(g=>g.reason.startsWith('Tiger cash-log fee enrichment:'))).toBe(false);
  expect(merged.sync.gaps.some(g=>g.kind==='orders')).toBe(true);
 });
});
describe('Tiger cash source fetching',()=>{
 it.each([false,true])('preserves every page and exact amount, optional failure=%s',async failure=>{
  vi.useFakeTimers();try{
   const calls:number[]=[],starts:unknown[]=[];
   const pending=fetchTigerFundDetails({gateway:'https://openapi.tigerfintech.com/gateway',credentials:{tiger_id:'id',account:'A',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')},fetchImpl:async(_url,init)=>{
    calls.push(Date.now());const request=JSON.parse(String(init?.body)),biz=JSON.parse(request.biz_content);starts.push(biz.start);expect(request.method).toBe('fund_details');expect(biz.seg_types).toEqual(['SEC']);
    if(calls.length===2&&failure)return new Response('',{status:403});
    return new Response('{"code":0,"data":{"page":'+calls.length+',"pageCount":2,"items":[{"id":'+(100+calls.length)+',"amount":-0.1234567890123456789}]}}');
   }},'2024-05-28','2026-10-28');
   await vi.runAllTimersAsync();const result=await pending;expect(result.complete).toBe(!failure);expect(result.rows).toHaveLength(failure?1:2);expect(result.rows[0].amount).toBe('-0.1234567890123456789');expect(starts).toEqual([0,1]);expect(calls[1]-calls[0]).toBeGreaterThanOrEqual(6100);
  }finally{vi.useRealTimers();}
 });
});

it('retains incomplete cash evidence on non-advancing pages or duplicate IDs',async()=>{
 vi.useFakeTimers();try{
  for(const duplicate of [false,true]){
   let calls=0;
   const work=fetchTigerFundDetails({gateway:'https://openapi.tigerfintech.com/gateway',credentials:{tiger_id:'id',account:'A',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')},fetchImpl:async()=>{
    calls++;return Response.json({code:0,data:{page:duplicate?calls:1,pageCount:2,items:[{id:duplicate?'same':String(calls),amount:'-1'}]}});
   }},'2024-05-28','2026-10-28');
   await vi.runAllTimersAsync();const result=await work;
   expect(result.complete).toBe(false);expect(result.rows).toHaveLength(1);expect(calls).toBe(2);
  }
 }finally{vi.useRealTimers();}
});

it.each([false,true])('resolves reused contract cash only when every possible allocation has identical fees (identical=%s)',identical=>{
 const raw=fixture(),h=raw.history!,other={...h.orders[0],id:'Q',legs:structuredClone(h.orders[0].legs)};
 h.orders.push(other);
 const copies=h.transactions.map((f,i)=>({...f,id:'q'+i,orderId:'Q',filledPrice:identical?f.filledPrice:i?'3.36':'1.91',filledAmount:identical?f.filledAmount:i?'4032':'2292'}));h.transactions.push(...copies);
 const cash=h.fund_details!.rows;
 cash.push(...cash.slice().map((r,i)=>({...r,id:String(200+i),amount:identical?r.amount:r.type==='Trade'?i===0?'-2292':'4032':r.amount})));
 const next=mapTigerHistory(raw,[],'tiger')!;
 expect(next.executions.map(e=>Number(e.fee_cash))).toEqual([-9.11,-9.23,-9.11,-9.23]);
 if(identical){cash[8].amount='-8.37';expect(mapTigerHistory(raw,[],'tiger')!.executions.every(e=>e.fee_cash===null)).toBe(true);}
});
it('isolates malformed blocks for unrelated contracts',()=>{
 const raw=fixture();raw.history!.fund_details!.rows.push({id:'999',type:'Trade',desc:'Buy-AAPL 20240531 PUT 22.0',currency:'USD',businessDate:'2024-05-28',amount:'-1',updatedAt:at},{id:'1000',type:'Other',desc:'unknown',currency:'USD',businessDate:'2024-05-28',amount:'-1',updatedAt:at});
 expect(mapTigerHistory(raw,[],'tiger')!.executions.every(e=>e.fee_cash!==null)).toBe(true);
});

it.each([false,true])('enriches older retained Tiger fees during incremental sync without discarding history on optional failure=%s',async failure=>{
 const data=fixture(),prior=fixture();delete prior.history!.fund_details;
 const retained=mapTigerHistory(prior,[],'tiger')!,starts:unknown[]=[];
 const raw=await fetchTigerRawBundle({account:'A',tiger_id:'id',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')},{gateway:'https://openapi.tigerfintech.com/gateway',retainedHistory:retained,history:{mode:'incremental',from:'2026-10-27T00:00:00Z',through:'2026-10-28T00:00:00Z'},fetchImpl:async(_url,init)=>{
  const request=JSON.parse(String(init?.body)),biz=JSON.parse(request.biz_content);
  if(request.method==='orders'){starts.push(biz.start_date);return Response.json({code:0,data:{items:data.history!.orders}});}
  if(request.method==='order_transactions'){starts.push(biz.start_date);return Response.json({code:0,data:{items:biz.sec_type==='OPT'?data.history!.transactions:[]}});}
  if(request.method==='fund_details')return failure?new Response('',{status:403}):Response.json({code:0,data:{page:1,pageCount:1,items:data.history!.fund_details!.rows}});
  if(request.method==='positions')return Response.json({code:0,data:{items:[]}});
  return Response.json({code:0,data:[]});
 }});
 expect(starts.every(t=>t===Date.parse(retained.sync.from))).toBe(true);
 expect(raw.history_error).toBeUndefined();expect(raw.history!.fund_details!.complete).toBe(!failure);
 const mapped=mapTigerHistory(raw,[],'tiger')!;
 expect(mapped.executions.every(e=>failure?e.fee_cash===null:e.fee_cash!==null)).toBe(true);
});

it.each(['0','0.20'])('preserves explicit cash-flow rebates and zero fees: %s',cash=>{
 const raw=fixture(),h=raw.history!;
 for(const row of h.fund_details!.rows)if(row.type!=='Trade')row.amount=row.type==='GST'?'0':cash;
 h.orders[0].commission=cash==='0'?'0':'-0.40';h.orders[0].gst='0';
 expect(mapTigerHistory(raw,[],'tiger')!.executions.map(e=>Number(e.fee_cash))).toEqual([Number(cash),Number(cash)]);
});
