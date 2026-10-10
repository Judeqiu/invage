import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertUserId, resolveDataRoot } from 'utarus';

export interface BrokerSyncRun {
  id: string;
  at: string;
  trigger: 'manual' | 'scheduled';
  ok: boolean;
  as_of?: string;
  account_id?: string;
  lots_upserted?: number;
  lots_removed?: number;
  error?: string;
  raw_data_id?: string;
}

/** Includes retired/disconnected channels, not only current broker connections. */
export function listBrokerSyncChannels(userId: string): string[] {
  assertUserId(userId);
  const root = join(resolveDataRoot(), 'broker-sync-history', userId);
  const stat = lstatSync(root, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid sync history directory.');
  return readdirSync(root, { withFileTypes: true }).map(entry => {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-z][a-z0-9_-]*$/.test(entry.name)) throw new Error('Invalid sync history channel directory.');
    return entry.name;
  }).sort();
}

function historyDir(slug: string, channel: string): string {
  assertUserId(slug);
  if (!/^[a-z][a-z0-9_-]*$/.test(channel)) throw new Error('Invalid broker channel.');
  return join(resolveDataRoot(), 'broker-sync-history', slug, channel);
}

export function recordBrokerSyncRun(slug: string, channel: string, run: Omit<BrokerSyncRun, 'id'> & { id?: string }): BrokerSyncRun {
  const dir = historyDir(slug, channel);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const entry = { id: run.id ?? randomUUID(), ...run };
  const temp = join(dir, `${entry.id}.tmp`);
  writeFileSync(temp, JSON.stringify(entry), { flag: 'wx', mode: 0o600 });
  renameSync(temp, join(dir, `${entry.id}.json`));
  return entry;
}

export function listBrokerSyncRuns(slug: string, channel: string, offset = 0, limit = 20): {
  runs: BrokerSyncRun[]; total: number; next_offset: number | null;
} {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid sync history pagination.');
  }
  const dir = historyDir(slug, channel);
  let names: string[];
  try { names = readdirSync(dir).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [], total: 0, next_offset: null };
    throw error;
  }
  const runs = names.map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as BrokerSyncRun)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return { runs: runs.slice(offset, offset + limit), total: runs.length,
    next_offset: offset + limit < runs.length ? offset + limit : null };
}

export function getBrokerSyncRun(slug: string, channel: string, id: string): BrokerSyncRun | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try { return JSON.parse(readFileSync(join(historyDir(slug, channel), `${id}.json`), 'utf8')) as BrokerSyncRun; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Latest confirmed statement date, retained even when the most recent attempt failed. */
export function latestSuccessfulBrokerSyncRun(slug: string, channel: string): BrokerSyncRun | null {
  let offset = 0;
  for (;;) {
    const page = listBrokerSyncRuns(slug, channel, offset, 100);
    const success = page.runs.find(run => run.ok && run.as_of);
    if (success) return success;
    if (page.next_offset == null) return null;
    offset = page.next_offset;
  }
}
