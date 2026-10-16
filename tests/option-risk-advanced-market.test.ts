import { expect, it } from 'vitest';
import { alignObservedHistory, comboExecutionQuote, dailyHistory } from '../src/risk/advanced-market.js';
import type { RiskMarketContract } from '../src/risk/types.js';
const c={underlying:'AAPL',right:'call',strike:100,expiryAt:'2027-01-15T16:00:00-05:00'} as RiskMarketContract;
it('pairs observed spot and exact-contract IV without filling missing observations',()=>{
  const r=alignObservedHistory(c,[{date:'2026-10-13',close:100},{date:'2026-10-14',close:101}],
    [{date:'2026-10-12',implied_volatility:25},{date:'2026-10-13',implied_volatility:20},{date:'2026-10-14'}],0);
  expect(r).toMatchObject({key:'AAPL|call|100|2027-01-15',dates:['2026-10-13'],spots:[100],ivs:[.2]});
});
it('rejects wrong-leg, crossed and invalid bid/ask quotes and preserves unknown depth',()=>{
  const row={rsp_code:0,legs:[{code:'US.AAPL270115C100000',side:'BUY',quantity:1}],bid_price:4,ask_price:5};
  const at='2026-10-16T15:00:00Z',code=row.legs[0].code;
  expect(comboExecutionQuote(row,code,at)).toMatchObject({bid:4,ask:5,bidSize:null,askSize:null,quoteAsOf:null});
  for(const patch of [{bid_price:6},{ask_price:NaN},{rsp_code:1},{legs:[{...row.legs[0],quantity:2}]}])expect(comboExecutionQuote({...row,...patch},code,at)).toBeNull();
  expect(comboExecutionQuote(row,'different',at)).toBeNull();
});
it('excludes incomplete current-day bars and paginates backward without lookahead',async()=>{
  const calls:Record<string,string>[]=[];
  const result=await dailyHistory(async(path,body,params)=>{calls.push(params!);return {kline_list:[
    {date:20261015,close:100},{date:20261016,close:102},{date:20261017,close:104}]};},'US.AAPL',Date.parse('2026-10-16T18:00:00Z'));
  expect(calls[0]).toMatchObject({ktype:'2',autype:'0',num:'370'});
  expect(result.map(r=>r.date)).toEqual(['2026-10-15']);
});
