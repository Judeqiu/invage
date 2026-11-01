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

it('updates readable cash while retaining unavailable balances and dates in state and books',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state,ledger=await balances(id);
  const doc=statement('2026-11-01');doc.cash=[{currency:'USD',amount:999}];
  doc.lots[0].holding.units=3;doc.skipped=[invalidCashSkip('SGD')];
  const result=await apply(id,doc),after=(await loadInvestor(id)).state;
  expect(after.cash!.find(c=>c.currency==='USD')).toMatchObject({amount:999,updated_at:'2026-11-01'});
  expect(after.cash!.find(c=>c.currency==='SGD')).toEqual(before.cash!.find(c=>c.currency==='SGD'));
  expect((await balances(id)).find(c=>c.currency==='USD')?.amount).toBe(999);
  expect((await balances(id)).find(c=>c.currency==='SGD')).toEqual(ledger.find(c=>c.currency==='SGD'));
  expect(Object.values(after.portfolio!)[0].units).toBe(3);
  expect(result).toMatchObject({asOf:'2026-10-30',positionsAsOf:'2026-11-01',deferred:['cash'],lotsUpserted:1});
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('SGD 2026-10-30');
  expect(doc.skipped).toHaveLength(1); // Retries must not mutate or duplicate source diagnostics.
  const updatedLedger=await balances(id);await apply(id,doc);expect(await balances(id)).toEqual(updatedLedger);
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

it('defers all cash for an unidentified currency, retaining both balances and dates',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state.cash,ledger=await balances(id);
  const doc=statement('2026-11-01');doc.cash=[{currency:'USD',amount:999}];doc.skipped=[invalidCashSkip()];
  const result=await apply(id,doc);
  expect((await loadInvestor(id)).state.cash).toEqual(before);expect(await balances(id)).toEqual(ledger);
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('no cash from this response was applied');
});
it('retains omitted currencies in a partial snapshot and never creates missing balances as zero',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state.cash,ledger=await balances(id);
  const doc=statement('2026-11-01');doc.cash=[{currency:'USD',amount:0}];doc.skipped=[invalidCashSkip('MYR'),invalidCashSkip('AUD')];
  const result=await apply(id,doc),after=(await loadInvestor(id)).state;
  expect(after.cash!.find(c=>c.currency==='USD')).toMatchObject({amount:0,updated_at:'2026-11-01'});
  expect(after.cash!.find(c=>c.currency==='SGD')).toEqual(before!.find(c=>c.currency==='SGD'));
  expect(after.cash!.some(c=>['MYR','AUD'].includes(c.currency))).toBe(false);
  expect((await balances(id)).find(c=>c.currency==='USD')?.amount??0).toBe(0);
  expect((await balances(id)).find(c=>c.currency==='SGD')).toEqual(ledger.find(c=>c.currency==='SGD'));
  expect(result.skipped.map(s=>s.reason).join(' ')).toContain('Cash remains unknown: MYR, AUD; no zero balance was substituted');
});
it('withholds contradictory currencies and preserves a newer retained balance during partial updates',async()=>{
  const id=await fixture(),before=(await loadInvestor(id)).state.cash;
  const doc=statement('2026-11-01');doc.cash=[{currency:'USD',amount:-25},{currency:'SGD',amount:999}];doc.skipped=[invalidCashSkip('SGD')];
  await apply(id,doc);
  expect((await loadInvestor(id)).state.cash!.find(c=>c.currency==='SGD')).toEqual(before!.find(c=>c.currency==='SGD'));
  const prior=(await loadInvestor(id)).state.cash;
  await expect(apply(id,{...doc,as_of:'2026-10-31'})).rejects.toThrow(/older than/);
  expect((await loadInvestor(id)).state.cash).toEqual(prior);
});
