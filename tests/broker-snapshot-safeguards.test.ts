import { beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { loadInvestor } from '../src/state/investor-store.js';
import { applyBrokerStatement } from '../src/brokers/apply-statement.js';
import { invalidCashSkip, invalidCostSkip } from '../src/brokers/snapshot-validation.js';
import { migrateBooks, withHouseholdTx, listCashBalances } from '../src/books/index.js';
import type { BrokerStatement } from '../src/brokers/statement.js';

await useTestDatabase({books:true});
beforeAll(migrateBooks);
const statement = (date='2026-10-30'): BrokerStatement => ({account_id:'A',as_of:date,
  cash:[{currency:'USD',amount:100},{currency:'SGD',amount:-50}],
  lots:[{ticker:'AAPL',currency:'USD',holding:{units:2,avg_price:100}}],skipped:[]});
async function fixture() {
  const id=randomUUID();
  await createInvestorFixture({user:{id,created_at:'2026-10-01',auth_token:randomUUID()},
    profile:{display_name:'Snapshot safeguards',contact_email:'test@example.invalid'},log:[],
    broker_connections:{tiger:{enabled:true,credentials:{}}}});
  await apply(id,statement());
  return id;
}
async function apply(id:string,doc:BrokerStatement) {
  const snapshot=await loadInvestor(id);
  return applyBrokerStatement(snapshot,'tiger',doc,undefined,result=>{
    snapshot.state.broker_connections!.tiger.last_sync={at:'2026-11-01T00:00:00Z',ok:true,as_of:result.asOf,
      ...(result.positionsAsOf ? {positions_as_of:result.positionsAsOf} : {}),
      ...(result.deferred ? {snapshot_deferred:result.deferred} : {})};
  },undefined,undefined,{requireCompleteSnapshot:true});
}
const balances=(id:string)=>withHouseholdTx(id,c=>listCashBalances(c,id));
const positions=(id:string)=>withHouseholdTx(id,async c=>(await c.query(
  `SELECT a.external_key,b.balance_minor::text,b.quantity::text FROM accounts a JOIN account_balances b ON b.account_id=a.id
   WHERE a.household_id=$1 AND a.kind='position' ORDER BY a.external_key`,[id])).rows);

it('retains the entire cash set and original dates in state and books while valid positions advance',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state,ledger=await balances(id);
  const doc=statement('2026-11-01');doc.cash=[{currency:'USD',amount:999}];
  doc.lots[0].holding.units=3;doc.skipped=[invalidCashSkip('SGD')];
  const result=await apply(id,doc),after=(await loadInvestor(id)).state;
  expect(after.cash).toEqual(before.cash);expect(await balances(id)).toEqual(ledger);
  expect(Object.values(after.portfolio!)[0].units).toBe(3);
  expect(result).toMatchObject({asOf:'2026-10-30',positionsAsOf:'2026-11-01',deferred:['cash'],lotsUpserted:1});
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('SGD 2026-10-30');
  expect(doc.skipped).toHaveLength(1); // Retries must not mutate or duplicate source diagnostics.
  await apply(id,doc);expect(await balances(id)).toEqual(ledger);
  expect((await loadInvestor(id)).state.option_observations!.at(-1)!.as_of).toBe('2026-11-01');
  await apply(id,statement('2026-11-01'));
  expect((await loadInvestor(id)).state.broker_connections!.tiger.last_sync?.snapshot_deferred).toBeUndefined();
  expect((await loadInvestor(id)).state.cash!.every(c=>c.updated_at==='2026-11-01')).toBe(true);
});
it('retains all positions and their observations in state and books while valid signed cash advances',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state,ledger=await positions(id);
  const doc=statement('2026-11-01');doc.lots=[];doc.cash=[{currency:'USD',amount:-5},{currency:'SGD',amount:0}];
  doc.skipped=[invalidCostSkip('US.AAPL')];
  const result=await apply(id,doc),after=(await loadInvestor(id)).state;
  expect(after.portfolio).toEqual(before.portfolio);expect(after.option_observations).toEqual(before.option_observations);
  expect(await positions(id)).toEqual(ledger);
  expect(after.cash!.map(c=>c.amount)).toEqual([-5,0]);
  expect((await balances(id)).find(c=>c.currency==='USD')?.amount).toBe(-5);
  expect(result).toMatchObject({asOf:'2026-10-30',positionsAsOf:'2026-10-30',deferred:['positions'],lotsUpserted:0,lotsRemoved:0});
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('not a current snapshot');
  await expect(apply(id,statement('2026-10-31'))).rejects.toThrow(/older than retained cash/);
});
it('keeps first-sync unknown data unknown and allows recovery without a placeholder balance or cost',async()=>{
  const id=randomUUID();
  await createInvestorFixture({user:{id,created_at:'2026-10-01',auth_token:randomUUID()},
    profile:{display_name:'Unknown snapshot',contact_email:'test@example.invalid'},log:[],
    broker_connections:{tiger:{enabled:true,credentials:{}}}});
  const doc=statement();doc.cash=[];doc.lots=[];doc.skipped=[invalidCashSkip('SGD'),invalidCostSkip('US.AAPL')];
  const result=await apply(id,doc),state=(await loadInvestor(id)).state;
  expect(state.cash??[]).toEqual([]);expect(state.portfolio??{}).toEqual({});
  expect(await balances(id)).toEqual([]);expect(await positions(id)).toEqual([]);
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('No previous verified');
  await apply(id,statement('2026-11-01'));
  expect((await loadInvestor(id)).state.broker_connections!.tiger.last_sync).toMatchObject({as_of:'2026-11-01',positions_as_of:'2026-11-01'});
});
