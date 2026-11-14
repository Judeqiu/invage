import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertBrokerCashLedger, mergeBrokerCashLedger, currentCashLedgerRecords } from '../src/brokers/cash-ledger.js';
import { mapTigerCashLedger } from '../src/tiger/tiger-ledger.js';
import { mapTigerBundleToStatement } from '../src/tiger/tiger-map.js';
import { fetchTigerRawBundle, fetchTigerFundDetails } from '../src/tiger/tiger-client.js';
import { assertBrokerStatement } from '../src/brokers/statement.js';
import { runQuery } from '../src/data-query/engine.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import { tigerLedgerBundle } from './helpers/cash-ledger.js';

function snapshot(): InvestorSnapshot {
  const ledger=mapTigerCashLedger(tigerLedgerBundle(),'tiger-A')!;
  return {revision:7,state:{user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01'},profile:{display_name:'Test',contact_email:'test@example.test'},log:[],broker_cash_ledgers:{'tiger-A':ledger}}};
}
describe('channel cash ledger journeys',()=>{
  it('queries deposits, unusual types, signed decimals and segments without inventing executions or changing balances',()=>{
    const raw=tigerLedgerBundle(),before=structuredClone(raw),statement=assertBrokerStatement(mapTigerBundleToStatement(raw,'tiger-A'));
    expect(statement.cash).toEqual([{currency:'USD',amount:500}]);expect(statement.history!.executions).toEqual([]);
    expect(statement.cash_ledger!.batches[0].complete).toBe(true);expect(raw).toEqual(before);
    const s=snapshot();
    expect(runQuery(s,{from:'broker_cash_ledger',select:['id','amount'],where:{all:[{field:'channel',op:'eq',value:'tiger-A'},{field:'reported_type',op:'eq',value:'Deposit'},{field:'business_date',op:'gte',value:'2025-11-01'}]}}).rows)
      .toEqual([{id:'9007199254740993123',amount:'1000.1234567890123456789'}]);
    expect(runQuery(s,{from:'broker_cash_ledger',group_by:['currency'],aggregates:[{op:'sum',field:'amount',as:'cash'}],order_by:[{field:'currency'}]}).rows)
      .toEqual([{currency:'SGD',cash:'0.00'},{currency:'USD',cash:'999.1234567890123456789'}]);
    expect(()=>runQuery(s,{from:'broker_cash_ledger',aggregates:[{op:'sum',field:'amount',as:'cash'}]})).toThrow(/requires group_by/);
    expect(runQuery(s,{from:'broker_cash_ledger',select:['reported_type'],where:{field:'id',op:'eq',value:'rebate'}}).rows).toEqual([{reported_type:'Unfamiliar broker type'}]);
    expect(runQuery({...s,state:{...s.state,broker_cash_ledgers:undefined}},{from:'broker_cash_ledger'}).available).toBe(false);
  });
  it('merges replay and overlapping fetches idempotently, preserving source revisions and independent gaps',()=>{
    const raw=tigerLedgerBundle(),first=mapTigerCashLedger(raw,'tiger-A')!;
    expect(mergeBrokerCashLedger(first,first)).toEqual(first);
    raw.fetched_at='2026-11-15T08:00:00.000Z';raw.history!.fund_details!.rows[0].amount='-2000.00';
    raw.history!.fund_details!.rows=raw.history!.fund_details!.rows.slice(0,1);
    raw.history!.fund_details!.complete=false;raw.history!.fund_details!.gaps=['Broker page unavailable'];
    const second=mapTigerCashLedger(raw,'tiger-A')!,merged=mergeBrokerCashLedger(first,second);
    expect(currentCashLedgerRecords(merged)).toHaveLength(4);
    const s=snapshot();s.state.broker_cash_ledgers!['tiger-A']=merged;
    expect(runQuery(s,{from:'broker_cash_ledger',select:['amount'],where:{field:'id',op:'eq',value:'9007199254740993123'}}).rows).toEqual([{amount:'-2000.00'}]);
    expect(runQuery(s,{from:'broker_cash_ledger_versions'}).rows).toHaveLength(5);
    expect(runQuery(s,{from:'broker_cash_ledger_coverage',select:['complete'],order_by:[{field:'observed_at'}]}).rows).toEqual([{complete:true},{complete:false}]);
    expect(mergeBrokerCashLedger(merged,first)).toEqual(merged);
    expect(()=>mergeBrokerCashLedger(first,{...second,account_id:'foreign'})).toThrow(/scope/);
    expect(()=>assertBrokerCashLedger({...first,batches:[{...first.batches[0],records:[]}]})).toThrow(/digest/);
    const ambiguous=mapTigerCashLedger({...raw,fetched_at:tigerLedgerBundle().fetched_at},'tiger-A')!;
    expect(()=>mergeBrokerCashLedger(first,ambiguous)).toThrow(/Conflicting/);
    const reverted=tigerLedgerBundle();reverted.fetched_at='2026-11-16T08:00:00.000Z';
    const newest=mergeBrokerCashLedger(merged,mapTigerCashLedger(reverted,'tiger-A')!);
    expect(currentCashLedgerRecords(newest).find(r=>r.record.id==='9007199254740993123')!.record.amount).toBe('1000.1234567890123456789');
  });
  it('keeps identical source IDs independent across account channels',()=>{
    const s=snapshot(),raw=tigerLedgerBundle();raw.account='B';raw.history!.fund_details!.rows[0].amount='5.00';
    s.state.broker_cash_ledgers!['tiger-B']=mapTigerCashLedger(raw,'tiger-B')!;
    expect(runQuery(s,{from:'broker_cash_ledger',where:{field:'reported_type',op:'eq',value:'Deposit'},select:['channel','account_id','amount'],order_by:[{field:'channel'}]}).rows)
      .toEqual([{channel:'tiger-A',account_id:'A',amount:'1000.1234567890123456789'},{channel:'tiger-B',account_id:'B',amount:'5.00'}]);
  });
  it('retains unknowns and old segment-coverage uncertainty and rejects foreign accounts',()=>{
    const raw=tigerLedgerBundle(),e=raw.history!.fund_details!;
    delete e.segments;delete e.rows[0].amount;e.rows[0].businessDate='unknown';
    const batch=mapTigerCashLedger(raw,'tiger-A')!.batches[0];
    expect(batch.complete).toBe(false);expect(batch.segments).toEqual([]);
    expect(batch.records[0]).toMatchObject({amount:null,business_date:null});expect(batch.gaps.length).toBeGreaterThan(0);
    e.rows[0].accountId='foreign';expect(()=>mapTigerCashLedger(raw,'tiger-A')).toThrow(/account mismatch/);
  });
});

describe('Tiger ledger transport (synthetic HTTP, no live broker calls)',()=>{
  const credentials={account:'A',tiger_id:'id',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')};
  it('fetches ledger across requested segments even without trades or positions',async()=>{
    const calls:Record<string,unknown>[]=[];
    const raw=await fetchTigerRawBundle(credentials,{gateway:'https://openapi.tigerfintech.com/gateway',history:{mode:'full',from:'2025-01-01T00:00:00.000Z',through:'2026-11-14T08:00:00.000Z'},fetchImpl:async(_url,init)=>{
      const request=JSON.parse(String(init?.body)),biz=JSON.parse(request.biz_content);
      if(request.method==='fund_details'){calls.push(biz);return Response.json({code:0,data:{page:1,pageCount:1,itemCount:4,items:tigerLedgerBundle().history!.fund_details!.rows}});}
      if(request.method==='prime_assets')return Response.json(tigerLedgerBundle().assets.envelope);
      return Response.json({code:0,data:{items:[]}});
    }});
    expect(calls).toEqual([expect.objectContaining({seg_types:['SEC','FUT','FUND'],fund_type:'ALL',start_date:'2025-01-01'})]);
    expect(mapTigerBundleToStatement(raw,'tiger-A').cash_ledger!.batches[0].records).toHaveLength(4);
  });
  it.each(['count','page','failure'])('keeps returned evidence incomplete on %s failure',async kind=>{
    vi.useFakeTimers();try{
      let page=0;
      const work=fetchTigerFundDetails({gateway:'https://openapi.tigerfintech.com/gateway',credentials,fetchImpl:async()=>{
        page++;if(page===2&&kind==='failure')return new Response('',{status:403});
        return Response.json({code:0,data:{page:page===2&&kind==='page'?1:page,pageCount:2,itemCount:kind==='count'?3:2,items:[{id:String(page),amount:'0.00'}]}});
      }},'2025-01-01','2026-11-14',['SEC','FUT','FUND']);
      await vi.runAllTimersAsync();const evidence=await work;
      expect(evidence.complete).toBe(false);expect(evidence.rows.length).toBeGreaterThan(0);expect(evidence.gaps.length).toBeGreaterThan(0);
    }finally{vi.useRealTimers();}
  });
});
