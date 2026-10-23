import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBrokerAdapter, parseBrokerSnapshot } from '../src/brokers/adapter.js';
import { planBrokerHistorySync } from '../src/brokers/history.js';
const json=(broker:string,name:string)=>JSON.parse(readFileSync(join('tests/fixtures',broker,name+'.json'),'utf8'));
const pem=(broker:string,name:string)=>readFileSync(join('tests/fixtures',broker,name+'.pem'),'utf8');
const history=planBrokerHistorySync(undefined,'A',new Date(),true);
describe('optional history outages across all HTTP brokers',()=>{
 it.each(['webull','tiger','moomoo','futubull'])('%s retains and parses the current snapshot when history returns 504',async id=>{
  const paths:string[]=[];
  const fetch:typeof globalThis.fetch=async(url,init)=>{
   const path=String(url);paths.push(path);
   if(id==='webull'){
    if(path.includes('accounts/list'))return Response.json(json('webull','accounts'));
    if(path.includes('balances/get'))return Response.json(json('webull','balances'));
    if(path.includes('positions/list'))return Response.json(json('webull','positions'));
    return new Response('',{status:504});
   }
   if(id==='tiger'){
    if(path.includes('play-analytics'))return new Response('',{status:500});
    const body=JSON.parse(String(init?.body));
    if(body.method==='accounts')return Response.json({code:1,data:[]});
    if(body.method==='prime_assets')return Response.json(json('tiger','prime-assets'));
    if(body.method==='positions'){
     const type=JSON.parse(body.biz_content).sec_type;
     return Response.json(type==='STK'?json('tiger','positions-stk-opt'):{code:0,data:{items:[]}});
    }
    return new Response('',{status:504});
   }
   if(path.includes('accounts/authorized'))return Response.json(json('moomoo','authorized'));
   if(path.includes('fills_history'))return new Response('',{status:504});
   if(path.includes('/funds'))return Response.json(json('moomoo','funds'));
   if(path.includes('/positions'))return Response.json(json('moomoo','positions'));
   if(path.includes('stock-basicinfo'))return Response.json({ret_code:0,data:{basic_list:json('moomoo','positions').d.map((p:any)=>({code:p.code,stock_type:'DRVT',contract_size:100}))}});
   return new Response('',{status:504});
  };
  const credentials=id==='webull'?{app_key:'test',app_secret:'test',region:'sg',account_id:'LOJOQITOD49R6G9BPQM489CISA'}:
   id==='tiger'?{tiger_id:'test',account:'1234567',license:'TBSG',private_key:pem('tiger','test-private')}:
   {app_key:'test',private_key:pem('moomoo','ed25519-private'),sign_alg:'ED25519',acc_id:'281756420273981734'};
  const adapter=getBrokerAdapter(id);
  const raw=await adapter.fetchRaw(credentials,{transport:{kind:'http',fetch},history});
  expect(raw.historyDeferred).toBeDefined();
  const statement=parseBrokerSnapshot(adapter,raw,id);
  expect(statement.cash.length).toBeGreaterThan(0);expect(statement.lots.length).toBeGreaterThan(0);
  expect(statement.history).toBeUndefined();
  expect(statement.skipped).toContainEqual(expect.objectContaining({reason:expect.stringContaining('reconciliation queued')}));
  expect(paths.length).toBeGreaterThan(2);
 });
 it('Webull retains partial pages as evidence but does not parse them as complete history',async()=>{
  let pages=0;
  const adapter=getBrokerAdapter('webull');
  const fetch:typeof globalThis.fetch=async(url)=>{
    const path=String(url);
    if(path.includes('accounts/list'))return Response.json(json('webull','accounts'));
    if(path.includes('balances/get'))return Response.json(json('webull','balances'));
    if(path.includes('positions/list'))return Response.json(json('webull','positions'));
    if(++pages===1)return Response.json({data:[{orders:[]}],pagination_key:'next'});
    return new Response('',{status:504});
  };
  const raw=await adapter.fetchRaw({app_key:'test',app_secret:'test',region:'sg',account_id:'LOJOQITOD49R6G9BPQM489CISA'},{transport:{kind:'http',fetch},history});
  expect(JSON.parse(raw.body.toString()).option_history).toHaveLength(1);
  expect(raw.historyDeferred).toBeDefined();
  expect(parseBrokerSnapshot(adapter,raw,'webull').history).toBeUndefined();
 });
 it('does not turn a primary Webull balances failure into a successful empty account',async()=>{
  const fetch:typeof globalThis.fetch=async(url)=>String(url).includes('accounts/list')?Response.json(json('webull','accounts')):new Response('',{status:504});
  await expect(getBrokerAdapter('webull').fetchRaw({app_key:'test',app_secret:'test',region:'sg',account_id:'LOJOQITOD49R6G9BPQM489CISA'},{transport:{kind:'http',fetch},history})).rejects.toThrow(/504/);
 });
 it('IBKR preserves its current report when an optional yearly backfill has a transport failure',async()=>{
  const xml='<FlexQueryResponse><FlexStatement accountId="A" fromDate="20261001" toDate="20261023"><OpenPositions/><CashReport><CashReportCurrency accountId="A" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexQueryResponse>';
  let sent=0;
  const adapter=getBrokerAdapter('ibkr');
  const raw=await adapter.fetchRaw({token:'test',activity_query_id:'q'},{history,accountId:'A',transport:{kind:'ibkr',flex:{sleepMs:async()=>{},get:async(path)=>{
   if(path==='SendRequest'){if(++sent>1)throw new Error('network unavailable');return Buffer.from('<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref</ReferenceCode></FlexStatementResponse>')}
   return Buffer.from(xml);
  }}}});
  expect(raw.historyDeferred).toBeDefined();
  expect(parseBrokerSnapshot(adapter,raw,'ibkr').cash).toEqual([{currency:'USD',amount:100}]);
 });
});
