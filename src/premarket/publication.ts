import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { listNotifications, notifyUser, publicBinDriveOrigin, resolveDataRoot } from 'utarus';
import { getDatabaseRuntime, NoteRepositoryError, withTransaction } from 'utarus/database';
import type { PoolClient } from 'pg';
import { managementRepository } from '../management/repository.js';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { REPORT_ARCHIVE_NAME, reportCoverage, renderPremarketReport, type ReportTrigger } from './report.js';
import { scanPremarket, type Session } from './scan.js';

export interface PendingReport {
  noteId: string;
  title: string;
  createdAt: string;
  /** Keep the full report until the native note can be read by its owner. */
  body?: string;
  completeBody?: string;
  severity?: 'info' | 'medium';
  notificationTitle?: string;
}

export const missingFile = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if (!missingFile(error)) throw error; }
}

export async function removeIfPresent(path: string) {
  try { await unlink(path); }
  catch (error) { if (!missingFile(error)) throw error; }
}

export async function atomicWrite(path: string, data: string | Buffer) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

export async function prepareReport(snapshot: InvestorSnapshot, session: Session, startedAt: Date, dir: string,
  scan = scanPremarket, trigger?: ReportTrigger) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const result = await scan(snapshot, session, startedAt, async (raw, sha256) => {
    const path = join(dir, `${sha256}.${raw.kind}`);
    await atomicWrite(path, raw.body);
    return `${relative(resolveDataRoot(), path)} · SHA-256 ${sha256}`;
  });
  const coverage = reportCoverage(result);
  const severity = coverage.incomplete ? 'medium' : trigger?.kind === 'manual' || result.rows.length ? 'info' : undefined;
  const report: PendingReport = { noteId: randomUUID(), createdAt: result.collectedAt,
    ...renderPremarketReport(result, trigger), severity,
    notificationTitle: trigger?.kind === 'manual' ? 'Options decision report' : undefined };
  return { report, coverage };
}

export async function saveReportNote(userId: string, report: PendingReport) {
  const notes = getDatabaseRuntime().notes;
  const { noteId, title, body, completeBody, createdAt } = report;
  if (body !== undefined) {
    const note = { id: noteId, owner_user_id: userId, kind: 'markdown' as const, title,
      body, notebook_id: 'default', tags: [], provenance: 'system' as const,
      created_at: createdAt, updated_at: createdAt };
    if (completeBody !== undefined) {
      return withTransaction(managementRepository().pool, async client => {
        // The Notes repository locks the active owner before attachment publication.
        await createReservedNote(() => notes.createInTransaction(client, note));
        await putReportArchive(client, userId, noteId, Buffer.from(completeBody));
        return notes.readInTransaction(client, userId, noteId);
      });
    }
    await createReservedNote(() => notes.create(note));
  }
  return notes.read(userId, noteId);
}

async function createReservedNote(create: () => Promise<void>) {
  // The durable draft reserves the UUID before publication. An interrupted
  // receipt write can replay that UUID after the note transaction commits.
  try { await create(); }
  catch (error) {
    if (!(error instanceof NoteRepositoryError && error.code === 'conflict')) throw error;
  }
}

/** Store and verify the complete Markdown in the current owner transaction. */
export async function putReportArchive(client: PoolClient, userId: string, noteId: string, bytes: Buffer) {
  await client.query('SELECT utarus.begin_tenant($1,$2,NULL)', [userId, userId]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const read = () => client.query<{ digest: string }>(
    `SELECT encode(sha256(bytes), 'hex') AS digest FROM utarus.note_attachments
     WHERE owner_user_id=$1 AND note_id=$2 AND name=$3`, [userId, noteId, REPORT_ARCHIVE_NAME]);
  let result = await read();
  if (result.rows.length === 0) {
    await client.query(
      `INSERT INTO utarus.note_attachments(owner_user_id,note_id,id,name,mime_type,bytes,created_at)
       VALUES ($1,$2,$3,$4,'application/octet-stream',$5,now())`,
      [userId, noteId, randomUUID(), REPORT_ARCHIVE_NAME, bytes]);
    result = await read();
  }
  if (result.rows.length !== 1 || result.rows[0].digest !== digest) {
    throw new Error('Options decision report attachment could not be verified');
  }
}

export const noteHref = (noteId: string) => `/notes/${noteId}`;
export async function sendReportLink(userId: string, report: PendingReport,
  deps = { listNotifications, notifyUser }, enabled?: () => Promise<boolean>) {
  if (!report.severity) return true;
  const href = noteHref(report.noteId);
  // If inbox insertion succeeded before a crash, the framework owns push retries.
  if ((await deps.listNotifications(userId)).some(notification => notification.href === href)) return true;
  if (enabled && !await enabled()) return false;
  const origin = process.env.UTARUS_PUBLIC_BASE_URL?.trim() || publicBinDriveOrigin();
  await deps.notifyUser({ userId, href, source: 'system', title: report.notificationTitle ?? 'Premarket options report',
    body: new URL(href, origin).href, severity: report.severity });
  return true;
}
