import { describe, expect, it } from 'vitest';
import type { BrokerHistoryExecution } from '../src/brokers/history.js';
import { optionExecutionsFromHistory } from '../src/brokers/history.js';
import { recoverTigerHistoryMultipliers } from '../src/tiger/tiger-cash-metadata.js';
import { mapTigerHistory } from '../src/tiger/tiger-history.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';
import { fetchTigerRawBundle } from '../src/tiger/tiger-client.js';
import { readFileSync } from 'node:fs';
import type { BrokerHistory } from '../src/brokers/history.js';

function fill(values: Partial<BrokerHistoryExecution> = {}): BrokerHistoryExecution {
  return {broker_id:'tiger',channel:'tiger',account_id:'A1',id:'f1',order_id:'o1',native_symbol:'tiger:["PLTR","put","2022-12-02",7.5]',
    symbol:'PLTR',instrument:'option',side:'sell',effect:'open',executed_at:'2022-10-31T09:33:37',clock:'America/New_York',currency:'USD',
    quantity:'5',price:'0.31',multiplier:null,gross_cash:'155.0',fee_cash:'-5.37',option:{right:'put',expiry:'2022-12-02',strike:'7.5'},...values};
}
describe('Tiger exact cash-derived multipliers', () => {
  it('recovers the worksheet PLTR sale and both partial buybacks without changing cash or fees', () => {
    const rows = [fill(),fill({id:'f2',side:'buy',quantity:'1',price:'0.8',gross_cash:'-80.0',fee_cash:'-3.24',effect:'close'}),
      fill({id:'f3',side:'buy',quantity:'4',price:'0.03',gross_cash:'-12.0',fee_cash:'-4.23',effect:'close'})];
    const before = structuredClone(rows), result = recoverTigerHistoryMultipliers(rows);
    expect(result.recovered).toEqual(['f1','f2','f3']);
    expect(result.gaps).toEqual([]);
    expect(result.executions.map(row => row.multiplier)).toEqual(['100','100','100']);
    expect(result.executions.map(row => ({...row,multiplier:null}))).toEqual(before);
    expect(rows).toEqual(before);
    expect(recoverTigerHistoryMultipliers(result.executions).recovered).toEqual([]);
  });
  it.each(['10','12.5','1000'])('derives the actual size %s rather than defaulting to 100', size => {
    const row=fill({quantity:'1',price:'1',gross_cash:size});
    expect(recoverTigerHistoryMultipliers([row]).executions[0].multiplier).toBe(size);
  });
  it.each([
    {gross_cash:'154'}, {gross_cash:'-155'}, {multiplier:'10'}, {price:'0',gross_cash:'155'},
  ])('leaves contradictory evidence unresolved: %j', conflicting => {
    const rows=[fill(),fill({id:'f2',...conflicting})];const result=recoverTigerHistoryMultipliers(rows);
    expect(result.recovered).toEqual([]);expect(result.executions).toEqual(rows);
    expect(result.gaps[0].reason).toContain('conflicts');
  });
  it('keeps zero cash and rebates, using a verified same-contract size for a zero-priced fill', () => {
    const row=fill({id:'f2',price:'0',gross_cash:'0',fee_cash:'1.25',effect:'unknown'});
    const result=recoverTigerHistoryMultipliers([fill(),row]);
    expect(result.executions[1]).toEqual({...row,multiplier:'100'});
    expect(recoverTigerHistoryMultipliers([row]).recovered).toEqual([]);
  });
  it('does not associate evidence across accounts, currencies, contracts or brokers', () => {
    const unknown=fill({price:null,gross_cash:null});
    for(const scope of [{account_id:'A2'},{channel:'other'},{currency:'SGD'},{native_symbol:'other-contract'},{broker_id:'ibkr'}]) {
      const result=recoverTigerHistoryMultipliers([unknown,fill(scope)]);
      expect(result.executions[0].multiplier).toBeNull();
    }
  });
  it('revisits older retained metadata gaps even when every fee is known', async () => {
    const retained:BrokerHistory={broker_id:'tiger',channel:'tiger',account_id:'A1',executions:[fill()],orders:[],sync:{version:1,mode:'full',from:'2022-10-31T00:00:00.000Z',through:'2026-10-30T00:00:00.000Z',status:'partial',full_history_synced:false,fees:'available',gaps:[]}};
    const starts:number[]=[];
    const fetchImpl:typeof fetch=async(_url,init)=>{
      const request=JSON.parse(String(init?.body));const biz=JSON.parse(request.biz_content);
      if(request.method==='order_transactions'||request.method==='orders')starts.push(biz.start_date);
      return Response.json({code:0,data:{items:[]}});
    };
    await fetchTigerRawBundle({tiger_id:'test',account:'A1',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')},
      {fetchImpl,gateway:'https://openapi.tigerfintech.com/gateway',retainedHistory:retained,history:{mode:'incremental',from:'2026-10-28T00:00:00.000Z',through:'2026-10-31T00:00:00.000Z'}});
    expect(starts).toEqual([Date.parse(retained.sync.from),Date.parse(retained.sync.from),Date.parse(retained.sync.from)]);
  });
  it('recovers future syncs through the production mapper without needing open positions', () => {
    const time=Date.parse('2022-10-31T13:33:37Z');
    const raw:TigerRawBundle={schema:'invage.tiger.raw.v1',fetched_at:new Date(time).toISOString(),gateway:'https://example.test',account:'A1',license:'TBSG',account_kind:'prime',managed_accounts:null,
      assets:{method:'prime_assets',envelope:{code:0,data:{}}},positions:{STK:{code:0,data:[]},OPT:{code:0,data:[]},FUND:{code:0,data:[]}},
      history:{start:time-1000,end:time+1000,mode:'full',gaps:[],orders:[{id:'o1',account:'A1',symbol:'PLTR',market:'US',secType:'OPT',currency:'USD',expiry:'20221202',right:'PUT',strike:'7.5',action:'SELL',status:'Filled',openTime:time,orderType:'LMT',filledQuantity:'5',commission:'5',gst:'0.37',isOpen:true}],
        transactions:[{id:'f1',accountId:'A1',orderId:'o1',symbol:'PLTR',market:'US',secType:'OPT',currency:'USD',expiry:'20221202',right:'PUT',strike:'7.5',action:'SELL',filledQuantity:'5',filledQuantityScale:0,filledPrice:'0.31',filledAmount:'155.0',transactionTime:time}]}};
    const before=structuredClone(raw);const history=mapTigerHistory(raw,[],'tiger')!;
    expect(history.executions[0]).toMatchObject({multiplier:'100',gross_cash:'155.0',fee_cash:'-5.370000000000'});
    expect(optionExecutionsFromHistory(history)[0]).toMatchObject({execution_id:'f1',gross_premium:'155.0',multiplier:'100'});
    expect(history.sync.gaps).toEqual([]);expect(raw).toEqual(before);
  });
});
