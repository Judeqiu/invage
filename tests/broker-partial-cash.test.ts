import { expect, it } from 'vitest';
import { cashSnapshotPolicy, invalidCashSkip } from '../src/brokers/snapshot-validation.js';

it.each(['USD','HKD','CNH','JPY','SGD','KRW','MYR','AUD','EUR'])('updates readable %s cash without assuming a balance for another currency',currency=>{
  for(const amount of [-6602.15,0,6602.15]) {
    const cash=[{currency,amount}];
    expect(cashSnapshotPolicy({cash,skipped:[invalidCashSkip('ZZZ')]})).toEqual({partial:true,all:false,cash});
  }
});
it.each([undefined,'?','USD/SGD',''])('preserves all cash when the unreadable row has no identifiable currency (%s)',currency=>{
  expect(cashSnapshotPolicy({cash:[{currency:'USD',amount:1}],skipped:[invalidCashSkip(currency)]})).toMatchObject({all:true,cash:[]});
});
it('withholds conflicting readable and unreadable rows for the same currency',()=>{
  expect(cashSnapshotPolicy({cash:[{currency:'USD',amount:1},{currency:'SGD',amount:-2}],skipped:[invalidCashSkip(' usd ')]})).toEqual({partial:true,all:false,cash:[{currency:'SGD',amount:-2}]});
});
it('keeps complete snapshot replacement unchanged',()=>{
  const cash=[{currency:'USD',amount:0}];
  expect(cashSnapshotPolicy({cash,skipped:[]})).toEqual({partial:false,all:false,cash});
});
