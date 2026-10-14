import {describe,expect,it} from 'vitest';
import {mapTigerHistory} from '../src/tiger/tiger-history.js';
import {mapWebullHistory} from '../src/webull/webull-history.js';
import {mapFlexHistory} from '../src/ibkr/flex-history.js';
import {mapFutubullHistory} from '../src/futubull/futubull-history.js';
import {planBrokerHistorySync,mergeBrokerHistory,optionExecutionsFromHistory} from '../src/brokers/history.js';
import {runQuery} from '../src/data-query/engine.js';
import type {TigerRawBundle} from '../src/tiger/tiger-types.js';
import type {WebullRawBundle} from '../src/webull/webull-types.js';
const now=new Date('2026-10-14T12:00:00Z');
const full=planBrokerHistorySync(undefined,'A',now,true);
const stock={secType:'STK',symbol:'AAPL',market:'US',currency:'USD',action:'BUY'};
const option={secType:'OPT',symbol:'PATH',market:'US',currency:'USD',action:'SELL',right:'PUT',expiry:'20230915',strike:'15'};
function tiger(){return {schema:'invage.tiger.raw.v1',account:'A',history:{start:Date.parse(full.from),end:Date.parse(full.through),mode:'full',gaps:[],
 orders:[{...stock,account:'A',id:'s',status:'Filled',openTime:Date.parse('2023-09-01T15:00:00Z'),orderType:'LMT',totalQuantity:'125',totalQuantityScale:3,filledQuantity:'125',filledQuantityScale:3,avgFillPrice:'200'},
 {...option,account:'A',id:'o',isOpen:true,status:'Filled',openTime:Date.parse('2023-09-01T15:00:00Z'),orderType:'LMT',totalQuantity:'1',filledQuantity:'1',commission:'1',gst:'0.09',legs:[{...option,ratio:'1',multiplier:'100'}]}],
 transactions:[{...stock,accountId:'A',id:'s-fill',orderId:'s',transactionTime:Date.parse('2023-09-01T15:00:00Z'),filledQuantity:'125',filledQuantityScale:3,filledPrice:'200',filledAmount:'25'},
 {...option,accountId:'A',id:'o-fill',orderId:'o',transactionTime:Date.parse('2023-09-01T15:00:00Z'),filledQuantity:'1',filledPrice:'3',filledAmount:'300'}]}} as TigerRawBundle;}
function flexRows(){return '<FlexQueryResponse><FlexStatement accountId="A" fromDate="20230101" toDate="20231231"><Trades><Trade accountId="A" levelOfDetail="EXECUTION" assetCategory="OPT" tradeID="1" conid="10" dateTime="20230901;100000" tradeDate="20230901" buySell="SELL" openCloseIndicator="O" quantity="-1" multiplier="100" underlyingSymbol="PATH" putCall="P" strike="15" expiry="20230915" currency="USD" proceeds="300" tradePrice="3" ibCommission="-1" ibCommissionCurrency="USD"/></Trades></FlexStatement></FlexQueryResponse>';}
describe('explicit latest and full broker sync',()=>{
 it('uses recent bounds even when history is absent or partial; only explicit full sync backfills',()=>{
  expect(planBrokerHistorySync(undefined,'A',now)).toEqual({mode:'incremental',from:'2026-10-12T12:00:00.000Z',through:now.toISOString()});
  const history=mapTigerHistory(tiger(),[],'tiger-A')!;
  history.sync.status='partial';history.sync.gaps=[{kind:'coverage',reference:null,reason:'Earlier reports unavailable'}];
  expect(planBrokerHistorySync(history,'A',now).mode).toBe('incremental');
  expect(planBrokerHistorySync(history,'A',now,true)).toEqual(full);
 });
 it('retains closed Tiger options and fractional stocks without requiring current holdings',()=>{
  const h=mapTigerHistory(tiger(),[],'tiger-A')!;
  expect(h.executions).toHaveLength(2);expect(h.executions.find(e=>e.id==='s-fill')).toMatchObject({quantity:'0.125',gross_cash:'-25',instrument:'security'});
  expect(optionExecutionsFromHistory(h)[0]).toMatchObject({execution_id:'o-fill',multiplier:'100',gross_premium:'300',commission:'-1.090000000000'});
  expect(h.sync.historical_imported).toBe(true);
  const rounded=tiger();rounded.history!.transactions[0]={...rounded.history!.transactions[0],filledQuantity:'1',filledQuantityScale:0,filledPrice:'1.592',filledAmount:'1.59'};
  expect(mapTigerHistory(rounded,[],'tiger-A')!.executions[0].gross_cash).toBe('-1.59');
  const bad=tiger();bad.history!.transactions[0].accountId='B';expect(()=>mapTigerHistory(bad,[],'tiger-A')).toThrow('account mismatch');
 });
 it('stores every Webull order including cancelled partial fills, without manufacturing executions',()=>{
  const order={account_id:'A',order_id:'o',symbol:'PATH',side:'SELL',status:'CANCELED',order_type:'LMT',place_time_at:'2023-09-01T15:00:00Z',total_quantity:'2',filled_quantity:'1',filled_price:'3',legs:[{symbol:'PATH',side:'SELL',quantity:'2',option_type:'PUT',option_expire_date:'2023-09-15',strike_price:'15',option_contract_multiplier:'100'}]};
  const bundle={account_id:'A',option_history:[{orders:[order]}],history_plan:full} as unknown as WebullRawBundle;
  const h=mapWebullHistory(bundle,'webull-A')!;expect(h.orders[0]).toMatchObject({status:'CANCELED',filled_quantity:'1',legs:[{ratio:'1',multiplier:'100'}]});
  expect(h.executions).toEqual([]);expect(h.sync).toMatchObject({historical_imported:true,status:'partial'});
  order.account_id='B';expect(()=>mapWebullHistory(bundle,'webull-A')).toThrow('account mismatch');
 });
 it('deduplicates overlapping Flex reports and makes imported history visible to generic agent queries',()=>{
  const report={xml:flexRows(),from:'20230101',through:'20231231'};
  const h=mapFlexHistory([report,report],'A','ibkr-A',full,[],true);expect(h.executions).toHaveLength(1);
  const latest=mapFlexHistory([{...report,xml:flexRows().replace('20230901','20261013').replace('20230901','20261013').replace('tradeID="1"','tradeID="2"').replace('expiry="20230915"','expiry="20270915"').replace('conid="10"','conid="20"')}],'A','ibkr-A',planBrokerHistorySync(h,'A',now),[],false);
  const merged=mergeBrokerHistory(h,latest);expect(merged.executions).toHaveLength(2);expect(merged.sync.historical_imported).toBe(true);expect(merged.sync.gaps.length).toBeGreaterThan(0);
  const snapshot={revision:1,state:{broker_history:{'ibkr-A':merged}}} as any;
  expect(runQuery(snapshot,{from:'broker_executions',select:['id','gross_cash']}).rows).toEqual([{id:'1',gross_cash:'300'},{id:'2',gross_cash:'300'}]);
  expect(runQuery(snapshot,{from:'broker_history_sync',select:['historical_imported']}).rows).toEqual([{historical_imported:true}]);
 });
 it('retains OpenD historical securities and unpriced expired options independently of positions',()=>{
  const bundle={acc_id:'A',history:{plan:full,deals:[{deal_id:'1',order_id:'o',code:'US.AAPL',trd_side:'BUY',qty:'2',price:'10',create_time:'2023-09-01 10:00:00',status:'OK'},{deal_id:'2',order_id:'p',code:'US.PATH230915P15000',trd_side:'SELL_SHORT',qty:'1',price:'3',create_time:'2023-09-01 10:00:00',status:'OK'}],orders:[]}};
  const h=mapFutubullHistory(bundle,'futu-A')!;expect(h.executions).toHaveLength(2);expect(h.executions[0].gross_cash).toBe('-20');expect(h.executions[1].gross_cash).toBeNull();expect(h.sync.historical_imported).toBe(true);
 });
});

describe('IBKR sync transport modes',()=>{
 async function fetchMode(fullMode:boolean){
  const {ibkrFlexAdapter}=await import('../src/ibkr/flex-adapter.js');
  const calls:Array<Record<string,string>>=[];const refs=new Map<string,Record<string,string>>();let pauses=0;
  const xml=(from:string,to:string,id:string,date:string,cash:string)=>`<FlexQueryResponse><FlexStatement accountId="A" fromDate="${from}" toDate="${to}"><OpenPositions/><CashReport><CashReportCurrency accountId="A" currency="USD" endingCash="${cash}"/></CashReport><Trades><Trade accountId="A" levelOfDetail="EXECUTION" assetCategory="STK" tradeID="${id}" conid="100" dateTime="${date};100000" tradeDate="${date}" buySell="BUY" quantity="1" multiplier="1" symbol="AAPL" currency="USD" proceeds="-10" tradePrice="10" ibCommission="-1" ibCommissionCurrency="USD"/></Trades></FlexStatement></FlexQueryResponse>`;
  const transport={kind:'ibkr' as const,flex:{sleepMs:async()=>{pauses++;},get:async(path:string,p:Record<string,string>)=>{
   if(path==='SendRequest'){calls.push(p);const ref=String(calls.length);refs.set(ref,p);return Buffer.from(`<FlexStatementResponse><Status>Success</Status><ReferenceCode>${ref}</ReferenceCode></FlexStatementResponse>`);}
   const request=refs.get(p.q)!;return Buffer.from(request.fd?xml(request.fd,request.td,request.fd.slice(0,4),request.fd==='20260101'?'20261012':request.fd,'999'):xml('20251013','20261012','2026','20261012','100'));
  }}};
  const raw=await ibkrFlexAdapter.fetchRaw({token:'secret',activity_query_id:'q'},{transport,accountId:'A',channel:'ibkr-A',history:planBrokerHistorySync(undefined,'A',now,fullMode)});
  return {raw,calls,pauses,statement:ibkrFlexAdapter.parseToStatement(raw,'ibkr-A')};
 }
 it('latest sync makes no historical report requests and uses the actual reporting checkpoint',async()=>{
  const {raw,calls}=await fetchMode(false);expect(calls).toHaveLength(1);expect(calls[0].fd).toBeUndefined();
  expect(raw.history?.sync).toMatchObject({mode:'incremental',historical_imported:false,through:'2026-10-12T23:59:59.000Z'});
  expect(raw.historyAttachments).toEqual([]);
 });
 it('full sync requests five bounded calendar reports while keeping current cash and holdings',async()=>{
  const {raw,calls,pauses,statement}=await fetchMode(true);expect(calls).toHaveLength(6);expect(calls[1]).toMatchObject({fd:'20260101',td:'20261012'});expect(calls.at(-1)).toMatchObject({fd:'20220101',td:'20221231'});expect(pauses).toBe(5);
  expect(raw.historyAttachments).toHaveLength(5);expect(raw.history?.executions).toHaveLength(5);
  expect(statement.cash).toEqual([{currency:'USD',amount:100}]);expect(statement.lots).toEqual([]);expect(statement.history?.sync.historical_imported).toBe(true);
 });
});

it('preserves existing CSV snapshot parsing and exposes unsupported Flex historical coverage',async()=>{
 const {ibkrFlexAdapter}=await import('../src/ibkr/flex-adapter.js');const {attachFetchedHistory}=await import('../src/brokers/adapter.js');
 const csv='ClientAccountID,currency,endingCash\nA,USD,100\n';
 const raw=await ibkrFlexAdapter.fetchRaw({token:'secret',activity_query_id:'q'},{channel:'ibkr-A',accountId:'A',history:full,transport:{kind:'ibkr',flex:{get:async path=>Buffer.from(path==='SendRequest'?'<FlexStatementResponse><Status>Success</Status><ReferenceCode>r</ReferenceCode></FlexStatementResponse>':csv)}}});
 expect(raw.body.toString()).toBe(csv);
 const statement=attachFetchedHistory(raw,{account_id:'A',as_of:'2026-10-12',cash:[{currency:'USD',amount:100}],lots:[],skipped:[]});
 expect(statement.cash[0].amount).toBe(100);expect(statement.history?.sync).toMatchObject({historical_imported:false,status:'partial'});expect(statement.history?.sync.gaps[0].reason).toContain('CSV');
});

it('stops yearly Flex backfill after the first unavailable report and preserves its coverage gap',async()=>{
 const {ibkrFlexAdapter}=await import('../src/ibkr/flex-adapter.js');const requests:Record<string,string>[]=[];const refs=new Map<string,Record<string,string>>();
 const current='<FlexQueryResponse><FlexStatement accountId="A" fromDate="20251013" toDate="20261012"><Trades/></FlexStatement></FlexQueryResponse>';
 const raw=await ibkrFlexAdapter.fetchRaw({token:'secret',activity_query_id:'q'},{accountId:'A',channel:'ibkr-A',history:full,transport:{kind:'ibkr',flex:{sleepMs:async()=>{},get:async(path,p)=>{
  if(path==='SendRequest'){requests.push(p);const ref=String(requests.length);refs.set(ref,p);return Buffer.from(`<FlexStatementResponse><Status>Success</Status><ReferenceCode>${ref}</ReferenceCode></FlexStatementResponse>`);}
  return Buffer.from(refs.get(p.q)?.fd?'<FlexStatementResponse><Status>Fail</Status><ErrorCode>1003</ErrorCode><ErrorMessage>Statement is not available.</ErrorMessage></FlexStatementResponse>':current);
 }}}});
 expect(requests).toHaveLength(2);expect(requests[1].fd).toBe('20260101');expect(raw.historyAttachments).toEqual([]);
 expect(raw.history?.sync.gaps.some(g=>g.reason.includes('stopped further yearly requests'))).toBe(true);
});
