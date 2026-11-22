import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { listNotifications, notifyUser, publicBinDriveOrigin, resolveDataRoot } from 'utarus';
import { getDatabaseRuntime, NoteRepositoryError } from 'utarus/database';
import type { InvestorSnapshot } from '../state/investor-store.js';
import { reportCoverage, renderPremarketReport, type ReportTrigger } from './report.js';
import { scanPremarket, type Session } from './scan.js';

export interface PendingReport {
  noteId: string;
  title: string;
  createdAt: string;
  /** Keep the full report until the native note can be read by its owner. */
  body?: string;
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
  if (report.body !== undefined) {
    // Each execution reserves the note ID in its durable draft before inserting.
    try {
      await notes.create({ id: report.noteId, owner_user_id: userId, kind: 'markdown', title: report.title,
        body: report.body, notebook_id: 'default', tags: [], provenance: 'system',
        created_at: report.createdAt, updated_at: report.createdAt });
    } catch (error) {
      if (!(error instanceof NoteRepositoryError && error.code === 'conflict')) throw error;
    }
  }
  return notes.read(userId, report.noteId);
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
