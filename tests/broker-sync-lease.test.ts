import { expect,it } from 'vitest';
import { withBrokerSyncLease } from '../src/brokers/sync-lease.js';
it('excludes another process from the same account, allows other accounts, and releases after failure',async()=>{
 let release!:()=>void;
 let started!:()=>void;
 const ready=new Promise<void>(r=>{started=r});
 const held=withBrokerSyncLease('u','a',async()=>{started();await new Promise<void>(r=>{release=r})});
 await ready;
 try {
  await expect(withBrokerSyncLease('u','a',async()=>{})).rejects.toThrow('already in progress');
  await expect(withBrokerSyncLease('u','b',async()=>42)).resolves.toBe(42);
 } finally {release();await held}
 await expect(withBrokerSyncLease('u','a',async()=>{throw new Error('network unavailable')})).rejects.toThrow('network unavailable');
 await expect(withBrokerSyncLease('u','a',async()=>43)).resolves.toBe(43);
});
