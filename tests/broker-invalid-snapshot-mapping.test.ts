import {expect,it} from 'vitest';
import {assertBrokerStatement} from '../src/brokers/statement.js';
import type {TigerRawBundle} from '../src/tiger/tiger-types.js';
import type {MooMooRawBundle} from '../src/moomoo/moomoo-types.js';
import type {WebullRawBundle} from '../src/webull/webull-types.js';
import {mapTigerBundleToStatement} from '../src/tiger/tiger-map.js';
import {mapMooMooBundleToStatement} from '../src/moomoo/moomoo-map.js';
import {mapWebullBundleToStatement} from '../src/webull/webull-map.js';
import {mapFutubullSnapshot} from '../src/futubull/futubull-map.js';
const at='2026-11-01T00:00:00Z',empty={code:0,data:{items:[]}};
const tiger={schema:'invage.tiger.raw.v1',fetched_at:at,account:'A1',gateway:'https://example.test',license:'TBSG',account_kind:'prime',managed_accounts:null,
 assets:{method:'prime_assets',envelope:{code:0,data:{account:'A1',segments:{S:{currency:'USD',currencyAssets:{USD:{cashBalance:'100'},SGD:{cashBalance:'unavailable'}}}}}}},positions:{STK:empty,OPT:empty,FUND:empty}};
const cloud={schema:'invage.moomoo.raw.v1',fetched_at:at,acc_id:'A1',authorized:{s:'ok'},funds:{s:'ok',d:{currency:'USD',us_cash:'100',sg_cash:'unavailable'}},positions:{s:'ok',d:[]}};
const webull={schema:'invage.webull.raw.v1',fetched_at:at,account_id:'A1',region:'us',host:'api.webull.com',accounts:[],balances:{account_currency_assets:[{currency:'USD',cash_balance:'100'},{currency:'SGD',cash_balance:'unavailable'}]},positions:[]};
const opend={schema:'invage.futubull.raw.v1',fetched_at:at,acc_id:'123',funds:[{us_cash:'100',sg_cash:'unavailable'}],positions:[]};
const mappings = [
  ['tiger',()=>mapTigerBundleToStatement(tiger as TigerRawBundle,'tiger',false)],
  ['moomoo-cloud',()=>mapMooMooBundleToStatement(cloud as MooMooRawBundle,'moomoo',false)],
  ['futubull-cloud',()=>mapMooMooBundleToStatement({...cloud,schema:'invage.futubull.cloud.raw.v1'} as MooMooRawBundle,'futubull',false)],
  ['webull',()=>mapWebullBundleToStatement(webull as WebullRawBundle,'webull',false)],
  ['futubull-opend',()=>mapFutubullSnapshot(opend,'futubull',false)],
] as const;
it.each(mappings)('%s flags a returned unreadable currency and defers the full cash section',(_name,map)=>{
  const statement=assertBrokerStatement(map());
  expect(statement.skipped).toContainEqual(expect.objectContaining({kind:'cash',currency:'SGD',defer:'cash'}));
  expect(statement.cash).toEqual([{currency:'USD',amount:100}]);
});
it.each([false,true])('Cloud invalid cost remains unchanged in source evidence and deferred for both brands (%s)',futu=>{
  const raw={...cloud,schema:futu?'invage.futubull.cloud.raw.v1':'invage.moomoo.raw.v1',
    positions:{s:'ok',d:[{code:'US.AAPL',currency:'USD',qty:'1',cost_price:'-100',cost_price_valid:false,security_type:'STOCK',position_side:'LONG'}]}};
  const original=structuredClone(raw);
  const result=mapMooMooBundleToStatement(raw as MooMooRawBundle,futu?'futubull':'moomoo',false);
  expect(result.lots).toEqual([]);
  expect(result.skipped).toContainEqual(expect.objectContaining({kind:'position',symbol:'US.AAPL',defer:'positions'}));
  expect(raw).toEqual(original);
});
it('OpenD rejects an explicitly invalid fallback cost but retains its independent average_cost',()=>{
  const raw={...opend,positions:[{code:'US.AAPL',currency:'USD',qty:1,cost_price:100,cost_price_valid:false}]};
  expect(mapFutubullSnapshot(raw,'futubull',false).skipped).toContainEqual(expect.objectContaining({symbol:'US.AAPL',defer:'positions'}));
  expect(mapFutubullSnapshot({...raw,positions:[{...raw.positions[0],average_cost:0}]},'futubull',false).lots[0].holding.avg_price).toBe(0);
});
it.each([null,'', 'unavailable'])('Cloud retains a diagnostic when every returned cash field is unreadable: %s',amount=>{
  const raw={...cloud,funds:{s:'ok',d:{us_cash:amount}}};
  const result=assertBrokerStatement(mapMooMooBundleToStatement(raw as MooMooRawBundle,'moomoo',false));
  expect(result.cash).toEqual([]);expect(result.skipped).toContainEqual(expect.objectContaining({currency:'USD',defer:'cash'}));
});
it('Tiger flags malformed currency rows instead of silently filtering them out',()=>{
  const raw=structuredClone(tiger);
  Object.assign(raw.assets.envelope.data.segments.S,{currencyAssets:[{currency:'USD',cashBalance:0},{cashBalance:5},null]});
  const result=mapTigerBundleToStatement(raw as TigerRawBundle,'tiger',false);
  expect(result.cash).toEqual([{currency:'USD',amount:0}]);
  expect(result.skipped.filter(s=>s.defer==='cash')).toHaveLength(2);
});
