import { beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { mapTigerBundleToStatement } from '../src/tiger/tiger-map.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';
import { assertBrokerStatement } from '../src/brokers/statement.js';
import { applyBrokerStatement } from '../src/brokers/apply-statement.js';
import { loadInvestor } from '../src/state/investor-store.js';
import { getCashes, assertCashBalance } from '../src/state/portfolio-state.js';
import { buildLivePositions, filterLiveByChannel } from '../src/report/dashboard-model.js';
import { migrateBooks, withHouseholdTx, listCashBalances, booksListJournals, booksPostAdjustment, booksImportState } from '../src/books/index.js';

await useTestDatabase({ books: true });
beforeAll(migrateBooks);

function bundle(sgd: number): TigerRawBundle {
  return { schema:'invage.tiger.raw.v1',fetched_at:'2026-10-27T07:06:00Z',gateway:'https://test.invalid',
    account:'TEST-TIGER',license:'TBSG',account_kind:'prime',managed_accounts:null,
    assets:{method:'prime_assets',envelope:{code:0,data:{account:'TEST-TIGER',segments:{S:{currency:'USD',currencyAssets:{
      USD:{cashBalance:10000},SGD:{cashBalance:sgd},HKD:{cashBalance:0},
    }}}}}},positions:{STK:{code:0,data:{items:[{symbol:'AAPL',secType:'STK',market:'US',currency:'USD',positionQty:10,averageCost:100}]}},
      OPT:{code:0,data:{items:[]}},FUND:{code:0,data:{items:[]}}} };
}
async function investor(cash?: number) {
  const id=randomUUID();
  await createInvestorFixture({user:{id,slug:'debit-'+id,created_at:'2026-10-27',auth_token:randomUUID()},
    profile:{display_name:'Debit test',contact_email:id+'@test.invalid'},log:[],
    ...(cash === undefined ? {} : {cash:[{currency:'SGD',channel:'tiger',amount:cash,updated_at:'2026-10-27'}]})});
  return id;
}

it('imports signed Tiger balances, reconciles across zero, replays safely, and keeps other accounts isolated',async()=>{
  const id=await investor(),other=await investor(50);
  const apply=async(sgd:number,beforeSave?:()=>void)=>applyBrokerStatement(await loadInvestor(id),'tiger',
    mapTigerBundleToStatement(bundle(sgd),'tiger',false),undefined,beforeSave,undefined,{requireCompleteSnapshot:true});
  for(const amount of [100,-4955.41,-6000,-3000,0,100]) {
    await apply(amount);
    const state=(await loadInvestor(id)).state;
    expect(getCashes(state).find(c=>c.currency==='SGD')?.amount).toBe(amount);
    const ledger=await withHouseholdTx(id,c=>listCashBalances(c,id));
    expect(ledger.find(c=>c.currency==='SGD')?.amount??0).toBe(amount);
    const journals=await booksListJournals(state,100);
    await apply(amount);
    expect(await booksListJournals((await loadInvestor(id)).state,100)).toEqual(journals);
  }
  await expect(apply(-4955.41,()=>{throw Error('state save interrupted');})).rejects.toThrow('state save interrupted');
  const beforeReplay=(await loadInvestor(id)).state;
  expect(getCashes(beforeReplay).find(c=>c.currency==='SGD')?.amount).toBe(100);
  const posted=await booksListJournals(beforeReplay,100);
  await apply(-4955.41);
  expect(await booksListJournals((await loadInvestor(id)).state,100)).toEqual(posted);
  expect(getCashes((await loadInvestor(other)).state)[0].amount).toBe(50);
  const sums=await withHouseholdTx(id,c=>c.query(`SELECT entry_id,currency,sum(amount_minor)::text AS net
    FROM journal_lines WHERE household_id=$1 GROUP BY entry_id,currency HAVING sum(amount_minor)<>0`,[id]));
  expect(sums.rows).toEqual([]);
  const snapshot=await loadInvestor(id),incomplete=mapTigerBundleToStatement(bundle(-1),'tiger',false);
  incomplete.skipped=[{kind:'position',reason:'Position sleeve unavailable'}];
  await expect(applyBrokerStatement(snapshot,'tiger',incomplete,undefined,undefined,undefined,{requireCompleteSnapshot:true})).rejects.toThrow('snapshot is incomplete');
  expect((await loadInvestor(id)).state).toEqual(snapshot.state);
  expect(await booksListJournals(snapshot.state,100)).toEqual(posted);
});

it('seeds a debit balance losslessly and allows repayment without permitting new manual borrowing',async()=>{
  const id=await investor(-4955.41),snapshot=await loadInvestor(id);
  await booksImportState(snapshot.state);
  let rows=await withHouseholdTx(id,c=>listCashBalances(c,id));
  expect(rows[0].amount).toBe(-4955.41);
  await booksPostAdjustment(snapshot.state,{amount:100,currency:'SGD',channel:'tiger',valueDate:'2026-10-27',memo:'Partial repayment of broker debit',contra:'adjustment',requestId:randomUUID()});
  rows=await withHouseholdTx(id,c=>listCashBalances(c,id));expect(rows[0].amount).toBe(-4855.41);
  await expect(booksPostAdjustment(snapshot.state,{amount:-1,currency:'SGD',channel:'tiger',valueDate:'2026-10-27',memo:'Manual borrowing still rejected',contra:'adjustment',requestId:randomUUID()})).rejects.toThrow(/negative|Insufficient/);
});

it('subtracts the debit after FX in both account and merged NAV and fails closed without FX',()=>{
  const cash=[{amount:10000,currency:'USD',channel:'tiger'},{amount:-4955.41,currency:'SGD',channel:'tiger'}];
  const live=buildLivePositions({AAPL:{units:10,avg_price:100,currency:'USD',channel:'tiger'}},{AAPL:200},{},cash,[],
    '2026-10-27',{reportingCurrency:'USD',fxRates:{SGD:0.75}});
  expect(live.cashAmount).toBeCloseTo(10000-4955.41*0.75);
  expect(live.totalValue).toBeCloseTo(12000-4955.41*0.75);
  expect(filterLiveByChannel(live,'tiger').totalValue).toBeCloseTo(live.totalValue);
  expect(filterLiveByChannel(live,'tiger').cashBalances).toEqual(cash);
  expect(()=>buildLivePositions({AAPL:{units:10,avg_price:100,currency:'USD',channel:'tiger'}},{AAPL:200},{},cash,[],
    '2026-10-27',{reportingCurrency:'USD',fxRates:{}},{resilient:true})).toThrow(/Missing FX rate/);
});

it('accepts finite signed cash and settled balances but rejects malformed money',()=>{
  const statement=mapTigerBundleToStatement(bundle(-4955.41),'tiger',false);
  expect(statement.skipped).toEqual([]);
  statement.cash[1].settled_amount=-4900;
  expect(assertBrokerStatement(statement).cash[1]).toMatchObject({amount:-4955.41,settled_amount:-4900});
  expect(assertCashBalance({amount:-4955.41,settled_amount:-4900,currency:'SGD',updated_at:'2026-10-27'}).amount).toBe(-4955.41);
  for(const amount of [NaN,Infinity,-Infinity]) {
    statement.cash[1].amount=amount;
    expect(()=>assertBrokerStatement(statement)).toThrow(/finite/);
  }
});
