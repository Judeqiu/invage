import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';

export interface BrokerSyncIntent {
  version: 1; id: string; userId: string; connectionId: string; binding: string; full: boolean;
  attempts: number; retryAt: string; ownerPid?: number;
  request?: true; fullRequests?: string[];
}
const directory = () => join(resolveDataRoot(), 'broker-sync-retries');
const filename = (userId: string, connectionId: string) => join(directory(), createHash('sha256').update(JSON.stringify([userId, connectionId])).digest('hex') + '.json');
const jobFile = (job: BrokerSyncIntent) => job.request ? filename(job.userId,job.connectionId).replace(/\.json$/,`.full-${job.id}.json`) : filename(job.userId,job.connectionId);
function read(file: string): BrokerSyncIntent | undefined {
  try {
    const job = JSON.parse(readFileSync(file, 'utf8')) as BrokerSyncIntent;
    if (job.version !== 1 || typeof job.id !== 'string' || !/^[-a-f0-9]{36}$/.test(job.id) || typeof job.userId !== 'string' || typeof job.connectionId !== 'string' ||
        typeof job.binding !== 'string' || (job.request !== undefined && job.request !== true) ||
        (job.fullRequests !== undefined && (!Array.isArray(job.fullRequests) || job.fullRequests.some(id=>typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id)))) || (job.ownerPid !== undefined && (!Number.isSafeInteger(job.ownerPid) || job.ownerPid <= 0)) || typeof job.full !== 'boolean' || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || !Number.isFinite(Date.parse(job.retryAt))) {
      throw new Error('Invalid durable broker sync intent');
    }
    return job;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
function write(job: BrokerSyncIntent): void {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const file = jobFile(job), temp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(job)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  const dir = openSync(directory(), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
/** Persist before network/SQL work. Contains IDs only, never credentials or broker data. */
export function beginBrokerSync(userId: string, connectionId: string, binding: string, full: boolean, now = new Date()): BrokerSyncIntent {
  const prior = read(filename(userId, connectionId));
  const requests = allBrokerSyncs().filter(j=>j.request && j.userId===userId && j.connectionId===connectionId && j.binding===binding);
  const sameBinding = prior?.binding === binding;
  const job: BrokerSyncIntent = { version: 1, id: randomUUID(), userId, connectionId, binding,
    full: full || sameBinding && prior.full || requests.length > 0, fullRequests: requests.map(j=>j.id), attempts: sameBinding ? prior.attempts + 1 : 1,
    // Crash recovery: do not replay a healthy long-running broker backfill.
    ownerPid: process.pid, retryAt: new Date(now.getTime() + 6 * 60 * 60_000).toISOString() };
  write(job);
  return job;
}
export function finishBrokerSync(job: BrokerSyncIntent, complete: boolean, now = new Date()): void {
  const file = jobFile(job);
  if (read(file)?.id !== job.id) return; // A newer request owns this entry.
  if (complete) {
    unlinkSync(file);
    // Requests are immutable entries: a newer request has a different filename.
    for(const id of job.fullRequests ?? []) {
      const request=jobFile({...job,id,request:true});
      try { unlinkSync(request); } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
    }
    const dir = openSync(directory(), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } else write({ ...job, ownerPid: undefined, retryAt: new Date(now.getTime() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(job.attempts - 1, 5))).toISOString() });
}
function allBrokerSyncs(): BrokerSyncIntent[] {
  let files: string[];
  try { files = readdirSync(directory()); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return files.filter(f => /^[a-f0-9]{64}(?:\.full-[-a-f0-9]{36})?\.json$/.test(f)).flatMap(f => {
    try { const job=read(join(directory(),f));return job ? [job] : []; }
    catch(error) { console.error('[broker/sync-retries] invalid intent retained',f,error);return []; }
  });
}
export function dueBrokerSyncs(now = new Date()): BrokerSyncIntent[] {
  const accounts=new Map<string,BrokerSyncIntent>();
  // An active/backed-off main attempt governs timing. Otherwise pick one Full
  // request per account; beginBrokerSync includes every request already present.
  for(const job of allBrokerSyncs()) {
    const key=JSON.stringify([job.userId,job.connectionId]),prior=accounts.get(key);
    if(!prior || !job.request || prior.request && job.retryAt<prior.retryAt) accounts.set(key,job);
  }
  return [...accounts.values()].filter(job=>{
    let abandoned=false;
    if(job.ownerPid)try { process.kill(job.ownerPid,0); } catch(error) { if((error as NodeJS.ErrnoException).code==='ESRCH')abandoned=true; }
    return abandoned || Date.parse(job.retryAt)<=now.getTime();
  });
}
export function brokerSyncBinding(connection: { broker_id: string; account_id?: string; channel: string; source_id: string }): string {
  return JSON.stringify([connection.broker_id, connection.account_id, connection.channel, connection.source_id]);
}

export function brokerSyncRetry(userId: string, connectionId: string, binding: string): { attempts: number; retry_at: string } | null {
  try {
    const main = read(filename(userId, connectionId));
    const job = main?.binding===binding ? main : allBrokerSyncs().find(j=>j.request && j.userId===userId && j.connectionId===connectionId && j.binding===binding);
    return job?.binding === binding ? { attempts: job.attempts, retry_at: job.retryAt } : null;
  } catch (error) { console.error('[broker/sync-retries] read', userId, connectionId, error); return null; }
}

/** Separate immutable entries avoid a read/unlink race with an older attempt. */
export function queueFullBrokerSync(userId: string, connectionId: string, binding: string): void {
  write({version:1,id:randomUUID(),userId,connectionId,binding,full:true,request:true,attempts:0,retryAt:new Date(Date.now()+30_000).toISOString()});
}
