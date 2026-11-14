import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLivePositions,buildDashboardModel } from '../src/report/dashboard-model.js';
import { createPortfolioProjectionRefresher } from '../src/state/portfolio-projections.js';
import { readPortfolioProjection } from '../src/state/projection-store.js';
import { loadQueryCatalog,queryDatasets } from '../src/data-query/sources.js';
import { runQuery } from '../src/data-query/engine.js';
import { channelAssetValues } from '../src/report/channel-asset-value.js';
import { addBrokerAccount,addBrokerSource,readBrokerAccountModel } from '../src/brokers/accounts.js';
import { createDataQueryTools } from '../src/tools/data_query.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';
vi.mock('../src/tools/channel.js',async original=>({...await original<typeof import('../src/tools/channel.js')>(),resolveInvestorFromChannel:vi.fn()}));
let root:string,s:InvestorSnapshot;
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'channel-assets-'));process.env.UTARUS_DATA_ROOT=root;
  s={revision:5,state:{user:{id:'00000000-0000-4000-8000-000000000099',created_at:'2026-01-01'},profile:{display_name:'Valuation',contact_email:'value@test.local'},log:[],
    portfolio:{
      STOCK:{instrument:'equity',units:10,avg_price:1,currency:'USD',channel:'alpha'},
      MMF:{instrument:'fund',units:10,avg_price:1,currency:'SGD',channel:'alpha',fund:{quote_source:'manual',mark:1,product_class:'mmf'}},
      OTHER:{instrument:'fund',units:100,avg_price:1,currency:'USD',channel:'alpha',fund:{quote_source:'manual',mark:4,product_class:'equity'}},
      OPT:{instrument:'option',units:1,avg_price:1,currency:'USD',channel:'alpha',option:{underlying:'STOCK',right:'put',side:'short',strike:20,expiry:'2027-01-15',multiplier:100,settlement:'physical',mark:5,quote_source:'manual'}},
      BETA:{instrument:'equity',units:100,avg_price:1,currency:'USD',channel:'beta'},
    },cash:[{channel:'alpha',currency:'USD',amount:-3,updated_at:'2026-11-14'},{channel:'alpha',currency:'SGD',amount:4,updated_at:'2026-11-14'},{channel:'beta',currency:'USD',amount:0,updated_at:'2026-11-14'}],
    deposits:[{id:'term',channel:'alpha',currency:'USD',amount:100,interest:5,start_date:'2026-01-01',end_date:'2027-01-01'}],
  }};
  vi.mocked(resolveInvestorFromChannel).mockResolvedValue(s);
});
afterEach(()=>{rmSync(root,{recursive:true,force:true});delete process.env.UTARUS_DATA_ROOT;vi.restoreAllMocks();});
async function save(options:{rates?:Record<string,number>;prices?:Record<string,number>;payload?:(p:DashboardPayload)=>void;time?:string}={}){
  const refresh=createPortfolioProjectionRefresher({loadInvestor:async()=>structuredClone(s),loadDashboardForSlug:async()=>{
    const live=buildLivePositions(s.state.portfolio??{},options.prices??{STOCK:2,BETA:2},{},s.state.cash,s.state.deposits,'2026-11-14',
      {reportingCurrency:'USD',fxRates:options.rates??{SGD:0.75}},{allowEmpty:true,resilient:true});
    const p:DashboardPayload={slug:s.state.user.id,displayName:'Valuation',generatedAt:options.time??'2026-11-14T08:00:00.000Z',empty:false,
      model:buildDashboardModel(live,[]),benchmark:null,productProfile:'full',productName:'Test'};
    options.payload?.(p);return p;
  }});
  await refresh(s.state.user.id,true);
}
async function query(q:Parameters<typeof runQuery>[1]){return runQuery(s,q,await loadQueryCatalog(s,q));}

it('queries the approved components for one channel using one saved FX generation without including options, other funds or fixed deposits',async()=>{
  await save();
  const q={from:'channel_asset_values',where:{field:'channel',op:'eq',value:'alpha'}};
  const result=await query(q);
  expect(result.rows).toEqual([{channel:'alpha',currency:'USD',stock_market_value:'20',cash_balance:'0.00',money_market_fund_value:'7.5',asset_value:'27.50',complete:true,
    calculated_at:'2026-11-14T08:00:00.000Z',broker_as_of:null,issues:'[]'}]);
  const components=(await query({from:'channel_asset_components',where:q.where})).rows;
  expect(components.map(c=>c.key)).toEqual(['STOCK','MMF','cash:0','cash:1']);
  expect(components.find(c=>c.key==='MMF')).toMatchObject({native_currency:'SGD',currency:'USD',fx_rate:'0.75',value:'7.5'});
  expect(components.find(c=>c.key==='cash:1')).toMatchObject({native_amount:'4',fx_rate:'0.75',value:'3.00'});
  expect((await query({from:'channel_asset_values',where:{field:'channel',op:'eq',value:'beta'}})).rows[0]).toMatchObject({asset_value:'200',cash_balance:'0',complete:true});
  expect((await query({from:'channel_asset_values',where:{field:'channel',op:'eq',value:'absent'}})).rows).toEqual([]);
  expect(result.source_version).toEqual(expect.any(String));
  const tool=createDataQueryTools().find(t=>t.name==='query_data')!;
  const toolResult=await tool.execute('query',{user_id:s.state.user.id,query:q});
  expect(toolResult.details).toMatchObject({rows:result.rows});
});
it('keeps fund classification and quote/FX gaps explicit instead of publishing partial totals',async()=>{
  delete s.state.portfolio!.MMF.fund!.product_class;await save();
  let row=(await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')!;
  expect(row).toMatchObject({complete:false,asset_value:null,money_market_fund_value:null});expect(row.issues).toContain('product class');
  const allFunds=(await query({from:'fund_valuations',where:{field:'channel',op:'eq',value:'alpha'}})).rows;
  expect(allFunds).toHaveLength(2);
  expect(allFunds.find(f=>f.key==='MMF')).toMatchObject({market_value:'7.5',money_market_eligible:null,classification_status:'unclassified'});
  expect(allFunds.find(f=>f.key==='OTHER')).toMatchObject({market_value:'400',product_class:'equity',money_market_eligible:false});
  s.state.portfolio!.MMF.fund!.product_class='mmf';await save({payload:p=>{p.model!.live.fxRates={};}});
  row=(await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')!;
  expect(row).toMatchObject({complete:false,asset_value:null,cash_balance:null});expect(row.issues).toContain('FX');
  await save({prices:{BETA:2}});
  row=(await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')!;
  expect(row).toMatchObject({complete:false,asset_value:null,stock_market_value:null});expect(row.issues).toContain('cost fallback');
});
it('retains unknown cash and broker aggregate fund gaps; prefers signed reported broker cash without adding it twice',async()=>{
  s.state.cash=undefined;await save();
  expect((await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')).toMatchObject({cash_balance:null,asset_value:null});
  await save({payload:p=>{p.connectionMetrics={alpha:{as_of:'2026-11-14',currency:'SGD',broker_cash:-8}};}});
  expect((await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')).toMatchObject({cash_balance:'-6.00',asset_value:'21.50',complete:true});
  delete s.state.portfolio!.MMF;delete s.state.portfolio!.OTHER;
  await save({payload:p=>{p.connectionMetrics={alpha:{as_of:'2026-11-14',currency:'USD',broker_cash:0,fund_assets:100}};}});
  const row=(await query({from:'channel_asset_values'})).rows.find(r=>r.channel==='alpha')!;
  expect(row).toMatchObject({complete:false,asset_value:null,money_market_fund_value:null});expect(row.issues).toContain('aggregate fund assets');
});
it('keeps missing holdings unknown and explicit foreign zero cash valid without requiring an unused FX rate',async()=>{
  s.state.portfolio={};s.state.cash=[{channel:'alpha',currency:'SGD',amount:0,updated_at:'2026-11-14'}];
  await save({rates:{}});
  expect((await query({from:'channel_asset_values'})).rows[0]).toMatchObject({complete:true,asset_value:'0',stock_market_value:'0',money_market_fund_value:'0',cash_balance:'0'});
  s.state.portfolio=undefined;await save({rates:{}});
  expect((await query({from:'channel_asset_values'})).rows[0]).toMatchObject({complete:false,asset_value:null,stock_market_value:null,money_market_fund_value:null,cash_balance:'0'});
});
it('requires broker fund-scope evidence and accepts explicitly reported zero fund assets',async()=>{
  const source=addBrokerSource(s.state,'ibkr',{token:'synthetic'});
  const id=addBrokerAccount(s.state,{source_id:source,account_id:'A',label:'Evidence account',config:{activity_query_id:'synthetic'}});
  const channel=readBrokerAccountModel(s.state).connections[id].channel;
  await save({payload:p=>{p.connectionMetrics={[channel]:{as_of:'2026-11-14',currency:'USD',broker_cash:0}};}});
  let row=(await query({from:'channel_asset_values',where:{field:'channel',op:'eq',value:channel}})).rows[0];
  expect(row).toMatchObject({complete:false,money_market_fund_value:null,asset_value:null,cash_balance:'0'});
  expect(row.issues).toContain('fund scope is unreported');
  await save({payload:p=>{p.connectionMetrics={[channel]:{as_of:'2026-11-14',currency:'USD',broker_cash:0,fund_assets:0}};}});
  row=(await query({from:'channel_asset_values',where:{field:'channel',op:'eq',value:channel}})).rows[0];
  expect(row).toMatchObject({complete:true,asset_value:'0',money_market_fund_value:'0',cash_balance:'0'});
});
it('rejects stale generations and pins pagination across same-revision valuation refreshes',async()=>{
  expect(queryDatasets.channel_asset_values.available(s.state)).toBe(false);
  await expect(query({from:'channel_asset_values'})).rejects.toThrow(/being prepared/);
  await save();
  const first=await query({from:'channel_asset_values',limit:1});
  await expect(query({from:'channel_asset_values',offset:1,expected_revision:s.revision})).rejects.toThrow(/expected_source_version/);
  await save({time:'2026-11-14T09:00:00.000Z',prices:{STOCK:3,BETA:2}});
  await expect(query({from:'channel_asset_values',offset:1,expected_revision:s.revision,expected_source_version:first.source_version})).rejects.toThrow(/Source data changed/);
  s.state.portfolio!.STOCK.units=20;
  await expect(query({from:'channel_asset_values'})).rejects.toThrow(/being prepared/);
});
it('does not mutate frozen saved views or source holdings',async()=>{
  await save();const projection=readPortfolioProjection(s.state)!,before=JSON.stringify(projection),stateBefore=JSON.stringify(s.state);
  channelAssetValues(s.state,projection);expect(JSON.stringify(projection)).toBe(before);expect(JSON.stringify(s.state)).toBe(stateBefore);
});
