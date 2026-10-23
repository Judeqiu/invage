import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';

/** Kernel-owned lock covers the app, Drive and operator processes. The child
 * reads our pipe; process death closes it and releases flock without stale locks.
 */
export async function withBrokerSyncLease<T>(userId: string, connectionId: string, work: () => Promise<T>): Promise<T> {
  const dir = join(resolveDataRoot(), 'broker-sync-locks');
  mkdirSync(dir, {recursive:true, mode:0o700});
  const name = createHash('sha256').update(JSON.stringify([userId,connectionId])).digest('hex');
  const child = spawn('flock', ['-n',join(dir,name+'.lock'),'sh','-c','printf locked; cat >/dev/null'], {stdio:['pipe','pipe','pipe']});
  child.stdin.on('error',()=>{}); // A busy flock can exit before its pipe closes.
  const exited = new Promise<void>(resolve => child.once('close',()=>resolve()));
  try {
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('Broker sync lock did not respond.'));},5000);
      child.once('error',error=>{clearTimeout(timer);reject(error)});
      child.once('close',()=>{clearTimeout(timer);reject(new Error('Sync already in progress.'))});
      child.stdout.once('data',()=>{clearTimeout(timer);resolve()});
    });
    return await work();
  } finally {
    child.stdin.end();
    await exited;
  }
}
