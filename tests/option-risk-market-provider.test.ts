import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { verify, createPublicKey } from 'node:crypto';
import { collectConnectedRiskMarket, equityExpiry, fredRate, cashDividendInputs } from '../src/risk/market-provider.js';
import { analysisContext, normalizeRiskInputs } from '../src/risk/context.js';
import { moomooMarketData } from '../src/moomoo/moomoo-client.js';
import { moomooSignContent } from '../src/moomoo/moomoo-sign.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
const key=readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8');
const now=Date.parse('2026-10-16T01:00:00Z'), at=Date.parse('2026-10-15T20:00:00Z');
const id='AMD-P@tiger', code='US.AMD261218P400000';
const credentials={broker:'futubull' as const,app_key:'test-key',private_key:key,sign_alg:'Ed25519' as const};
function investor(): InvestorSnapshot {
  return {revision:85,state:{user:{id:'00000000-0000-4000-8000-000000000001'},portfolio:{[id]:{instrument:'option',channel:'tiger',currency:'USD',units:2,avg_price:400,
    option:{underlying:'AMD',right:'put',side:'short',strike:400,expiry:'2026-12-18',multiplier:100,settlement:'physical',mark:418}}},
    broker_sources:{f:{broker_id:'futubull',credentials:{app_key:'test-key',private_key:key}}},
    broker_connections:{c:{broker_id:'futubull',source_id:'f',channel:'futubull',label:'Futu',account_id:'A1',config:{acc_id:'A1'},enabled:true}},
  }} as unknown as InvestorSnapshot;
}
function fixture(patch: { stock?:Record<string,unknown>; option?:Record<string,unknown>; chain?:Record<string,unknown>; dividends?:unknown[]; fail?:string; csv?:string; basic?:Record<string,unknown> }={}) {
  const seen: string[]=[];
  const fetchImpl:typeof fetch=async (input,init)=>{
    const url=new URL(String(input));seen.push(url.toString());
    if(url.hostname==='fred.stlouisfed.org')return new Response(patch.csv??'observation_date,DGS1\n2026-10-14,4.53\n2026-10-15,\n');
    expect(url.hostname).toBe('webapi.futunn.com');
    const headers=init!.headers as Record<string,string>;
    expect(verify(null,Buffer.from(moomooSignContent({timestampMs:headers['X-Timestamp'],method:init!.method!,path:url.pathname,query:url.search.slice(1),body:init?.body as string|undefined})),createPublicKey(key),Buffer.from(headers.Authorization,'base64'))).toBe(true);
    if(patch.fail&&url.pathname.endsWith(patch.fail))return Response.json({ret_code:-1,error:{message:'Not allowed'}});
    let data:Record<string,unknown>={};
    if(url.pathname.endsWith('stock-quote'))data={quote_list:[{code:'US.AMD',data_time:at,last_price:562.23},
      {code,data_time:at-120000,last_price:4.18,option_ex_data:{contract_size:100,contract_multiplier:100,option_area_type:'AMERICAN',option_type:'PUT',strike_price:400,implied_volatility:58.786},...patch.option}]};
    if(url.pathname.endsWith('/snapshot'))data={snapshot_list:[{code:'US.AMD',equity_valid:true,dividend_ttm:0,dividend_ratio_ttm:0,...patch.stock}]};
    if(url.pathname.endsWith('stock-basicinfo'))data={basic_list:[{code:'US.AMD',stock_type:'STOCK',...patch.basic}]};
    if(url.pathname.endsWith('option-chain')){expect(url.searchParams.get('start')).toBe('2026-12-18');data={option_chain:[{code,stock_owner:'US.AMD',strike_time:'2026-12-18',strike_price:400,option_type:'PUT',lot_size:100,option_standard_type:'STANDARD',...patch.chain}]};}
    if(url.pathname.endsWith('dividends'))data={dividend_list:patch.dividends??[]};
    return Response.json({ret_code:0,data});
  };return {fetchImpl,seen};
}
afterEach(()=>vi.unstubAllEnvs());
it('collects owner-connected quotes across custodians, verifies signed queries and preserves source timestamps/units',async()=>{
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test');const snapshot=investor(),before=JSON.stringify(snapshot),f=fixture();
  const market=await collectConnectedRiskMarket(snapshot,['tiger'],{fetchImpl:f.fetchImpl,now});
  expect(market.exclusions).toEqual([]);expect(market.contracts).toHaveLength(1);
  expect(market.contracts[0]).toMatchObject({id,spot:562.23,premiumPerContract:418,impliedVolatility:.58786,exerciseStyle:'american',multiplier:100,
    quoteAsOf:'2026-10-15T19:58:00.000Z',spotAsOf:'2026-10-15T20:00:00.000Z',expiryAt:'2026-12-18T16:00:00-05:00'});
  expect(market.contracts[0].rate).toBeCloseTo(2*Math.log1p(.0453/2));expect(market.contracts[0].dividendReference).toContain('trailing proxy');
  const inputs=normalizeRiskInputs(snapshot,{analysisContextId:analysisContext(snapshot)!,accountScope:{kind:'selected',accountIds:['tiger']},horizonTradingDays:5,scenarioSet:'equity-options-standard-v1',mode:'conditional',refresh:false},market,now);
  expect(inputs.coverage.supportedContracts).toBe(1);expect(JSON.stringify(snapshot)).toBe(before);
  expect(JSON.stringify(market)).not.toContain('PRIVATE KEY');expect(JSON.stringify(inputs)).not.toContain('test-key');
});
it.each([
  {chain:{option_standard_type:'NON_STANDARD'}},
  {chain:{stock_owner:'US.OTHER'}},
  {option:{last_price:0}},
  {option:{data_time:now+3600000}},
  {stock:{dividend_ttm:null}},
  {csv:'observation_date,DGS1\n2026-10-01,4.5\n'},
])('excludes unverifiable inputs instead of manufacturing values: %j',async patch=>{
  const f=fixture(patch);const market=await collectConnectedRiskMarket(investor(),['tiger'],{fetchImpl:f.fetchImpl,now});
  expect(market.contracts).toHaveLength(0);expect(market.exclusions).toHaveLength(1);
});
it('does not use another scope or connect when no authorized source exists',async()=>{
  const s=investor();s.state.broker_connections={};s.state.broker_sources={};const f=fixture();
  expect((await collectConnectedRiskMarket(s,['tiger'],{fetchImpl:f.fetchImpl,now})).contracts).toEqual([]);expect(f.seen).toEqual([]);
});
it('selects only published, recent rate observations at or before the quote date',()=>{
  expect(fredRate('observation_date,DGS1\n2026-10-14,4.53\n2026-10-16,4.6\n','2026-10-15',now).percent).toBe(4.53);
  expect(()=>fredRate('observation_date,DGS1\n2026-10-15,\n','2026-10-15',now)).toThrow();
  expect(equityExpiry('2026-07-17')).toBe('2026-07-17T16:00:00-04:00');
  expect(cashDividendInputs({dividend_ttm:0},null,100,now)?.dividendYield).toBe(0);
});
it('rejects trade/write paths before transmitting a credential',async()=>{
  const fetchImpl=vi.fn();await expect(moomooMarketData({path:'/api/v1.0/trade/place-order',credentials,body:{},fetchImpl})).rejects.toThrow('Unsupported read-only');expect(fetchImpl).not.toHaveBeenCalled();
});

it.each([
  {basic:{stock_type:'ETF'},stock:{equity_valid:false,dividend_ttm:1.93}},
  {stock:{dividend_ttm:2.54}},
  {dividends:[{ex_date:'2026/11/01',currency:'USD',dividend_per_share:1}]},
  {option:{data_time:at-7*86400000}},
  {fail:'dividends'},
])('includes previously filtered contracts with disclosed inputs: %j',async patch=>{
  const f=fixture(patch);const market=await collectConnectedRiskMarket(investor(),['tiger'],{fetchImpl:f.fetchImpl,now});
  expect(market.contracts).toHaveLength(1);expect(market.exclusions).toEqual([]);
  if(patch.stock)expect(market.contracts[0].dividendYield).toBeCloseTo(patch.stock.dividend_ttm/562.23);
  if(patch.dividends)expect(market.contracts[0].dividends).toEqual([{date:'2026-11-01',amount:1}]);
});
it('uses announced cash only once and never invents a missing trailing yield',()=>{
  expect(cashDividendInputs({dividend_ttm:2},null,100,now)).toMatchObject({dividendYield:.02,dividends:[]});
  const d={ex_date:'2026/11/01',currency:'USD',dividend_per_share:1};
  expect(cashDividendInputs({dividend_ttm:2},{dividend_list:[d,d]},100,now)).toMatchObject({dividendYield:0,dividends:[{date:'2026-11-01',amount:1}]});
  expect(cashDividendInputs({},null,100,now)).toBeNull();
});

it('collects all positions above 100 using bounded provider batches without losing a contract',async()=>{
  const s=investor(), holding=s.state.portfolio![id];
  const specs=Array.from({length:137},(_,i)=>({id:`AMD-P-${i}@tiger`,strike:100+i,code:`US.AMD261218P${(100+i)*1000}`}));
  s.state.portfolio=Object.fromEntries(specs.map(c=>[c.id,{...holding,option:{...holding.option!,strike:c.strike}}]));
  const byCode=new Map(specs.map(c=>[c.code,c])), f=fixture();
  const requested: string[][]=[];
  const fetchImpl:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)), response=await f.fetchImpl(input,init);
    if(url.hostname==='fred.stlouisfed.org')return response;
    const envelope=await response.json();
    const codes:string[]=init?.body?JSON.parse(String(init.body)).code_list:[];
    if(init?.body){expect(codes.length).toBeLessThanOrEqual(100);requested.push(codes);}
    if(url.pathname.endsWith('stock-quote')){
      const template=envelope.data.quote_list.find((r:any)=>r.code===code);
      envelope.data.quote_list=codes.map(c=>c==='US.AMD'?{code:c,data_time:at,last_price:562.23}:
        {...template,code:c,option_ex_data:{...template.option_ex_data,strike_price:byCode.get(c)!.strike}});
    }
    if(url.pathname.endsWith('/snapshot'))envelope.data.snapshot_list=envelope.data.snapshot_list.filter((r:any)=>codes.includes(r.code));
    if(url.pathname.endsWith('stock-basicinfo'))envelope.data.basic_list=envelope.data.basic_list.filter((r:any)=>codes.includes(r.code));
    if(url.pathname.endsWith('option-chain')){
      const template=envelope.data.option_chain[0];
      envelope.data.option_chain=specs.map(c=>({...template,code:c.code,strike_price:c.strike}));
    }
    return Response.json(envelope);
  };
  const market=await collectConnectedRiskMarket(s,['tiger'],{fetchImpl,now});
  expect(market.exclusions).toEqual([]);
  expect(market.contracts.map(c=>c.id)).toEqual(specs.map(c=>c.id));
  expect(requested).toHaveLength(6);
  expect(new Set(requested.flat())).toEqual(new Set(['US.AMD',...specs.map(c=>c.code)]));
});
