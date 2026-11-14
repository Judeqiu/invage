import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {fetchMooMooAccountCashLedger} from '../src/moomoo/moomoo-client.js';
import {mapMooMooCashLedger} from '../src/moomoo/moomoo-ledger.js';
import {mapMooMooBundleToStatement} from '../src/moomoo/moomoo-map.js';
import {assertBrokerCashLedger,currentCashLedgerRecords,mergeBrokerCashLedger} from '../src/brokers/cash-ledger.js';
import {runQuery} from '../src/data-query/engine.js';
import type {MooMooRawBundle,CloudCashLedgerEvidence} from '../src/moomoo/moomoo-types.js';
import type {InvestorSnapshot} from '../src/state/investor-store.js';
const credentials={app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519' as const,acc_id:'A'};
import {ledgerRow as row,ledgerBundle} from './helpers/moomoo-ledger.js';
describe.each(['moomoo','futubull'] as const)('%s account cash ledger',broker=>{
 it('requests all directions and symbols, follows all pages and preserves exact response bodies',async()=>{
  let calls=0;
  const evidence=await fetchMooMooAccountCashLedger({...credentials,broker},{through:new Date('2026-11-14T08:00:00.000Z'),fetchImpl:async(url,init)=>{
   const u=new URL(String(url));expect(u.host).toBe(broker==='moomoo'?'webapi.moomoo.com':'webapi.futunn.com');expect(init?.method).toBe('GET');
   expect(u.searchParams.get('begin_time')).toBe('1');expect(u.searchParams.get('end_time')).toBe('1794643200000000');
   expect(u.searchParams.has('code')).toBe(false);expect(u.searchParams.has('direction')).toBe(false);expect(u.searchParams.get('page_size')).toBe('20');
   expect(u.searchParams.get('page_flag')).toBe(calls?'next':null);
   return Response.json({s:'ok',d:{cash_logs:[calls++?{...row,transaction_name:'Unfamiliar source type',cash_change:'-0.000000000000000001'}:row],completed:calls===2,page_flag:'next'}});
  }});
  expect(evidence.complete).toBe(true);expect(evidence.rows).toHaveLength(2);expect(evidence.requests).toHaveLength(2);expect(JSON.parse(evidence.requests[0].response_body).d.cash_logs[0]).toEqual(row);
 });
 it('retains partial rows and raw rejection independently of history and snapshot success',async()=>{
  let calls=0;
  const evidence=await fetchMooMooAccountCashLedger({...credentials,broker},{fetchImpl:async()=>++calls===1?Response.json({s:'ok',d:{cash_logs:[row],completed:false,page_flag:'more'}}):Response.json({s:'error',errcode:485210001,errmsg:'Not supported'},{status:400})});
  expect(evidence.complete).toBe(false);expect(evidence.rows).toEqual([row]);expect(evidence.gaps).toHaveLength(1);expect(evidence.requests[1].http_status).toBe(400);
  const raw=ledgerBundle(broker);raw.account_cash_logs=evidence;raw.history_error='Independent history unavailable';
  const statement=mapMooMooBundleToStatement(raw,'channel');expect(statement.cash).toEqual([{currency:'USD',amount:7}]);expect(statement.lots).toEqual([]);expect(statement.cash_ledger!.batches[0].complete).toBe(false);expect(statement.cash_ledger!.batches[0].records).toHaveLength(1);
 });
 it('rejects repeated cursors as incomplete without discarding returned observations',async()=>{
  const evidence=await fetchMooMooAccountCashLedger({...credentials,broker},{fetchImpl:async()=>Response.json({s:'ok',d:{cash_logs:[row],completed:false,page_flag:'repeat'}})});
  expect(evidence.complete).toBe(false);expect(evidence.rows).toHaveLength(2);expect(evidence.gaps).not.toHaveLength(0);
 });
 it('distinguishes successful emptiness, transport failure and malformed pagination',async()=>{
  const empty=await fetchMooMooAccountCashLedger({...credentials,broker},{fetchImpl:async()=>Response.json({s:'ok',d:{cash_logs:[],completed:true}})});expect(empty.complete).toBe(true);
  const offline=await fetchMooMooAccountCashLedger({...credentials,broker},{fetchImpl:async()=>{throw Error('offline');}});expect(offline.complete).toBe(false);expect(offline.gaps).toHaveLength(1);
  const malformed=await fetchMooMooAccountCashLedger({...credentials,broker},{fetchImpl:async()=>Response.json({s:'ok',d:{cash_logs:[]}})});expect(malformed.complete).toBe(false);
 });
 it('stores deposits, transfers and unfamiliar labels without inventing currency, dates or profit categories',()=>{
  const raw=ledgerBundle(broker,[row,{...row,transaction_name:'Money Transfers',cash_change:'-12.00',balance:'Balance: 0.00 USD'}, {...row,transaction_name:'Unfamiliar source type',cash_change:'0',balance:'25.00'}]);
  const ledger=mapMooMooCashLedger(raw,'channel')!;expect(ledger.broker_id).toBe(broker);expect(ledger.batches[0].complete).toBe(false);
  expect(ledger.batches[0].records[0]).toMatchObject({amount:'1234.123456789012345678',currency:'SGD',currency_source:'balance_suffix',business_date:null,reported_time:row.created_time,reported_balance:row.balance,identity_basis:'content_occurrence'});
  expect(ledger.batches[0].records[1]).toMatchObject({amount:'-12.00',currency:'USD',reported_type:'Money Transfers'});
  expect(ledger.batches[0].records[2]).toMatchObject({amount:'0',currency:null,reported_type:'Unfamiliar source type'});
  const snapshot:InvestorSnapshot={revision:1,state:{user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01'},profile:{display_name:'Synthetic',contact_email:'test@example.test'},log:[],broker_cash_ledgers:{channel:ledger}}};
  expect(runQuery(snapshot,{from:'broker_cash_ledger',select:['amount','reported_type','identity_basis','reported_time'],where:{field:'currency',op:'eq',value:'SGD'}}).rows).toEqual([{amount:'1234.123456789012345678',reported_type:'Bank Transfer Deposits',identity_basis:'content_occurrence',reported_time:row.created_time}]);
  expect(runQuery(snapshot,{from:'broker_cash_ledger_coverage',select:['complete']}).rows).toEqual([{complete:false}]);
 });
 it('preserves duplicate occurrences, survives JSONB ordering and replays idempotently',()=>{
  const raw=ledgerBundle(broker,[row,{...row}]);const ledger=mapMooMooCashLedger(raw,'channel')!;
  expect(new Set(ledger.batches[0].records.map(r=>r.id)).size).toBe(2);
  expect(mergeBrokerCashLedger(ledger,JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
  raw.account_cash_logs!.rows=raw.account_cash_logs!.rows.map(r=>Object.fromEntries(Object.entries(r).reverse()));
  const reordered=mapMooMooCashLedger(raw,'channel')!;expect(reordered.batches[0].records.map(r=>r.id)).toEqual(ledger.batches[0].records.map(r=>r.id));
  expect(assertBrokerCashLedger(JSON.parse(JSON.stringify(ledger)))).toEqual(ledger);
  raw.account_cash_logs!.observed_at='2026-11-15T08:00:00.000Z';const newer=mapMooMooCashLedger(raw,'channel')!;
  expect(currentCashLedgerRecords(mergeBrokerCashLedger(ledger,newer))).toHaveLength(2);
 });
 it('preserves malformed amounts as unknown and rejects foreign account evidence',()=>{
  const raw=ledgerBundle(broker,[{...row,cash_change:'invalid'}]);expect(mapMooMooCashLedger(raw,'channel')!.batches[0].records[0].amount).toBeNull();
  raw.account_cash_logs!.rows=[{...row,account_id:'foreign'}];expect(()=>mapMooMooCashLedger(raw,'channel')).toThrow(/account/);
 });
 it('keeps legacy archives readable without inventing ledger coverage',()=>{
  const raw=ledgerBundle(broker);delete raw.account_cash_logs;expect(mapMooMooBundleToStatement(raw,'channel').cash_ledger).toBeUndefined();
 });
});
