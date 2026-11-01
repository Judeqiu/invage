import { expect, it } from 'vitest';
import { mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { assertBrokerStatement } from '../src/brokers/statement.js';
import type { MooMooRawBundle } from '../src/moomoo/moomoo-types.js';

const currencies = {us:'USD',hk:'HKD',cn:'CNH',jp:'JPY',sg:'SGD',kr:'KRW',my:'MYR',au:'AUD'};
function raw(schema:MooMooRawBundle['schema'],funds:Record<string,unknown>):MooMooRawBundle {
  return {schema,acc_id:'A',fetched_at:'2026-11-01T00:00:00Z',authorized:{s:'ok'},
    positions:{s:'ok',d:[]},funds:{s:'ok',d:{currency:'USD',...funds}}};
}
for(const schema of ['invage.moomoo.raw.v1','invage.futubull.cloud.raw.v1'] as const) {
  it(`${schema} accepts the documented successful empty MYR/AUD groups without inventing cash`,()=>{
    const source=raw(schema,{us_cash:'6602.15',hk_cash:'0',cn_cash:'0',jp_cash:'0',sg_cash:'0',kr_cash:'0',
      my_cash:'',my_avl_withdrawal_cash:'',my_net_cash_power:'',au_cash:'',au_avl_withdrawal_cash:'',au_net_cash_power:''});
    const before=structuredClone(source),s=assertBrokerStatement(mapMooMooBundleToStatement(source,'test',false));
    expect(s.cash).toEqual([{currency:'USD',amount:6602.15},{currency:'HKD',amount:0},{currency:'CNH',amount:0},
      {currency:'JPY',amount:0},{currency:'SGD',amount:0},{currency:'KRW',amount:0}]);
    expect(s.cash_omitted).toEqual(['MYR','AUD']);expect(s.skipped).toEqual([]);expect(source).toEqual(before);
  });
  it.each(Object.entries(currencies))(`${schema} imports every reported %s currency, including signs and zeroes`,(prefix,currency)=>{
    for(const value of ['-25.50','0','25.50']) {
      const s=mapMooMooBundleToStatement(raw(schema,{[`${prefix}_cash`]:value,[`${prefix}_avl_withdrawal_cash`]:'',[`${prefix}_net_cash_power`]:''}),'test',false);
      expect(s.cash).toEqual([{currency,amount:Number(value)}]);expect(s.cash_omitted).toBeUndefined();expect(s.skipped).toEqual([]);
    }
  });
  it.each([null,'unavailable',' ',false])(`${schema} defers genuinely malformed amounts (%s)`,amount=>{
    const s=mapMooMooBundleToStatement(raw(schema,{us_cash:'100',my_cash:amount,my_avl_withdrawal_cash:'',my_net_cash_power:''}),'test',false);
    expect(s.skipped).toContainEqual(expect.objectContaining({currency:'MYR',defer:'cash'}));expect(s.cash_omitted).toBeUndefined();
  });
  it(`${schema} does not reinterpret a partially populated group or an entirely empty cash snapshot as complete`,()=>{
    const s=mapMooMooBundleToStatement(raw(schema,{us_cash:'100',my_cash:'',my_avl_withdrawal_cash:'1',my_net_cash_power:''}),'test',false);
    expect(s.skipped).toContainEqual(expect.objectContaining({currency:'MYR',defer:'cash'}));
    expect(()=>mapMooMooBundleToStatement(raw(schema,{my_cash:'',my_avl_withdrawal_cash:'',my_net_cash_power:''}),'test',false)).toThrow(/no importable cash/);
  });
}
it('validates omitted currency metadata and rejects contradictions',()=>{
  const s=mapMooMooBundleToStatement(raw('invage.futubull.cloud.raw.v1',{us_cash:'1'}),'test',false);
  for(const cash_omitted of [['USD'],['MYR','MYR'],['?'],null])expect(()=>assertBrokerStatement({...s,cash_omitted})).toThrow(/omitted cash/);
});
