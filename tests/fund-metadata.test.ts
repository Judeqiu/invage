import {expect,it} from 'vitest';
import {fundReferences,enrichFundMetadata,retainFundMetadata,validIsin} from '../src/funds/metadata.js';
import {mapTigerBundleToStatement} from '../src/tiger/tiger-map.js';
import {tigerLedgerBundle} from './helpers/cash-ledger.js';
import type {Holding} from '../src/market/types.js';

it('records issuer-backed exact identities and full broker names without deriving class from a name',()=>{
  const raw=tigerLedgerBundle();raw.history=undefined;
  raw.positions.FUND.data={items:[
    {secType:'FUND',market:'SG',symbol:'SG9999006043.USD',name:'PHILLIP USD MONEY MARKET FUND "A" (USDHDG) ACC',contractId:123,currency:'USD',positionQty:2,averageCost:1,latestPrice:1.1},
    {secType:'FUND',market:'SG',symbol:'SGXZ40088619.SGD',name:'Fullerton SGD Liquidity Fund Class A',contractId:456,currency:'SGD',positionQty:3,averageCost:1,latestPrice:1.2},
    {secType:'FUND',market:'SG',symbol:'UNRESOLVED',name:'Money market wording is not authority',currency:'USD',positionQty:4,averageCost:1,latestPrice:1.3},
  ]};
  const before=structuredClone(raw),statement=mapTigerBundleToStatement(raw,'tiger-A');
  expect(statement.lots).toHaveLength(3);
  expect(statement.lots[0].holding).toMatchObject({units:2,avg_price:1,broker_ref:{native_id:'123'},fund:{name:'PHILLIP USD MONEY MARKET FUND "A" (USDHDG) ACC',mark:1.1,product_class:'mmf',isin:'SG9999006043',broker_symbol:'SG9999006043.USD',classification_source:{kind:'issuer_document',isin:'SG9999006043'}}});
  expect(statement.lots[1].holding.fund).toMatchObject({product_class:'mmf',isin:'SGXZ40088619',name:'Fullerton SGD Liquidity Fund Class A'});
  expect(statement.lots[2].holding.fund).toEqual({quote_source:'manual',mark:1.3,name:'Money market wording is not authority',broker_symbol:'UNRESOLVED'});
  expect(raw).toEqual(before);
  expect(fundReferences.every(f=>validIsin(f.isin))).toBe(true);
});
it('matches explicit ISIN independently of broker spelling and does not extend a share class into a different currency',()=>{
  const base={quote_source:'manual' as const,mark:0,name:'Unmodified broker name'};
  expect(enrichFundMetadata(base,{broker_id:'another-broker',symbol:'its-own-code',currency:'SGD',isin:'SGXZ40088619'})).toMatchObject({product_class:'mmf',mark:0,broker_symbol:'its-own-code'});
  expect(enrichFundMetadata(base,{broker_id:'tiger',symbol:'SG9999006043.USD',currency:'SGD'}).product_class).toBeUndefined();
  expect(()=>enrichFundMetadata(base,{broker_id:'another-broker',symbol:'code',currency:'USD',isin:'SGXZ40088619'})).toThrow(/currency/);
});
it('retains classification only for the same account/security and leaves new financial evidence untouched',()=>{
  const old:Holding={instrument:'fund',currency:'USD',channel:'account-A',units:2,avg_price:1,broker_ref:{native_id:'contract'},fund:{quote_source:'manual',mark:1.1,broker_symbol:'native-fund',name:'Old label',product_class:'income'}};
  const incoming:Holding={...old,units:3,avg_price:0.9,fund:{quote_source:'manual',mark:1.2,name:'New broker name',broker_symbol:'native-fund'}};
  const prior=structuredClone(old),latest=structuredClone(incoming);
  expect(retainFundMetadata(old,incoming)).toEqual({...incoming,fund:{...incoming.fund,product_class:'income'}});
  expect(retainFundMetadata(old,{...incoming,channel:'another-account'}).fund?.product_class).toBeUndefined();
  expect(retainFundMetadata(old,{...incoming,broker_ref:{native_id:'other-contract'}}).fund?.product_class).toBeUndefined();
  expect(()=>retainFundMetadata(old,{...incoming,fund:{...incoming.fund!,product_class:'mmf'}})).toThrow(/conflicts/);
  expect(old).toEqual(prior);expect(incoming).toEqual(latest);
});
