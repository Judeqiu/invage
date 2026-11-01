import { expect, it } from 'vitest';
import { mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { mergeBrokerHistory } from '../src/brokers/history.js';
import { reconciledHistorySkips } from '../src/brokers/snapshot-validation.js';
import type { MooMooRawBundle } from '../src/moomoo/moomoo-types.js';

const code = 'US.SPCX260918P122000';
function bundle(): MooMooRawBundle {
  return { schema:'invage.futubull.cloud.raw.v1', acc_id:'A', fetched_at:'2026-11-01T00:00:00Z',
    authorized:{s:'ok'}, funds:{s:'ok',d:{currency:'USD',us_cash:'6602.15',funds_assets:'23974.43'}},
    positions:{s:'ok',d:[]}, history_mode:'full', fills_history:{start:'946684800000000',end:'1793491200000000',rows:[
      {deal_id:'sell',order_id:'open',code,trd_side:'SELL_SHORT',qty:'1',price:'2.11',status:'OK',create_time:'1787755217425015'},
      {deal_id:'buy',order_id:'close',code,trd_side:'BUY_BACK',qty:'1',price:'0',status:'OK',create_time:'1789794596277868'},
    ]} };
}
it('removes a stale expired-contract notice only after retained evidence resolves the actual fills', () => {
  const raw=bundle();
  const prior=mapMooMooBundleToStatement({...raw,option_basicinfo:[{code,stock_type:'DRVT',contract_size:100}]},'futubull').history!;
  const incoming=mapMooMooBundleToStatement(raw,'futubull');
  const before=structuredClone(incoming);
  expect(incoming.skipped).toContainEqual(expect.objectContaining({symbol:code,kind:'event'}));
  const merged=mergeBrokerHistory(prior,incoming.history!);
  expect(merged.executions.map(e=>e.multiplier)).toEqual(['100','100']);
  expect(merged.executions.map(e=>Number(e.gross_cash))).toEqual([211,-0]);
  const skips=reconciledHistorySkips(incoming.skipped,incoming.history,merged);
  expect(skips.some(s=>s.symbol===code)).toBe(false);
  expect(skips).toContainEqual(expect.objectContaining({kind:'position',currency:'USD'}));
  expect(incoming).toEqual(before);
  expect(reconciledHistorySkips(skips,incoming.history,merged)).toEqual(skips);
});
it('preserves unresolved metadata, cash warnings and notices when reconciliation is unavailable', () => {
  const incoming=mapMooMooBundleToStatement(bundle(),'futubull');
  incoming.skipped.push({kind:'cash',currency:'MYR',defer:'cash',reason:'Unavailable'});
  expect(reconciledHistorySkips(incoming.skipped,incoming.history,mergeBrokerHistory(undefined,incoming.history!))).toEqual(incoming.skipped);
  expect(reconciledHistorySkips(incoming.skipped,incoming.history)).toEqual(incoming.skipped);
  expect(reconciledHistorySkips(incoming.skipped)).toEqual(incoming.skipped);
});
