import { expect, it, vi } from 'vitest';
import { beginBrokerSync, dueBrokerSyncs, finishBrokerSync, queueFullBrokerSync } from '../src/brokers/sync-retries.js';
it('retains failed work independently of SQL, preserves full sync, backs off and completes only the owning attempt', () => {
  const now = new Date('2026-10-23T00:00:00Z');
  const first=beginBrokerSync('user','conn','binding',true,now);
  expect(dueBrokerSyncs(now)).toEqual([]);
  finishBrokerSync(first,false,now);
  expect(dueBrokerSyncs(new Date(+now+30_000))).toEqual([expect.objectContaining({full:true,attempts:1})]);
  const retry=beginBrokerSync('user','conn','binding',false,new Date(+now+30_000));
  expect(retry).toMatchObject({full:true,attempts:2});
  finishBrokerSync(first,true,now); // Late completion must not remove new work.
  finishBrokerSync(retry,false,now);
  expect(dueBrokerSyncs(new Date(+now+60_000))).toEqual([expect.objectContaining({id:retry.id})]);
  finishBrokerSync(retry,true,now);
  expect(dueBrokerSyncs(new Date(+now+86400000))).toEqual([]);
});
it('does not inherit full history requests after account rebinding', () => {
  const now=new Date();
  beginBrokerSync('other','conn','old',true,now);
  const changed=beginBrokerSync('other','conn','new',false,now);
  expect(changed).toMatchObject({full:false,attempts:1});
  finishBrokerSync(changed,true);
});

it('keeps a retry intent when PostgreSQL is unavailable before loading the account', async () => {
  const {retryBrokerSyncs}=await import('../src/brokers/scheduler.js');
  const now=new Date(),job=beginBrokerSync('offline','conn','binding',false,now);
  finishBrokerSync(job,false,now);
  const finish=vi.fn();
  await retryBrokerSyncs(new Date(+now+60_000),{
    dueBrokerSyncs:()=>[job], loadInvestor:async()=>{throw new Error('database unavailable')}, finishBrokerSync:finish,
  });
  expect(finish).not.toHaveBeenCalled();
  finishBrokerSync(job,true);
});

it('preserves a newly requested Full sync when an older running attempt completes',()=>{
  const now=new Date();const old=beginBrokerSync('full-request','conn','binding',false,now);
  queueFullBrokerSync('full-request','conn','binding');
  finishBrokerSync(old,true);
  const pending=dueBrokerSyncs(new Date(+now+60_000));
  expect(pending).toContainEqual(expect.objectContaining({userId:'full-request',full:true}));
  finishBrokerSync(pending.find(j=>j.userId==='full-request')!,true);
});

it('acknowledges only Full requests captured before an attempt began',()=>{
  const now=new Date();
  queueFullBrokerSync('immutable-full','conn','binding');
  const started=beginBrokerSync('immutable-full','conn','binding',false,now);
  expect(started.full).toBe(true);
  queueFullBrokerSync('immutable-full','conn','binding');
  finishBrokerSync(started,true);
  const remaining=dueBrokerSyncs(new Date(+now+60_000));
  expect(remaining).toContainEqual(expect.objectContaining({userId:'immutable-full',full:true,request:true}));
  const next=beginBrokerSync('immutable-full','conn','binding',false,now);
  finishBrokerSync(next,true);
  expect(dueBrokerSyncs(new Date(+now+60_000)).filter(j=>j.userId==='immutable-full')).toEqual([]);
});
