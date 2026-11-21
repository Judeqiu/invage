import { mkdir, readFile, readdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { listNotifications, listUserIds, notifyUser, publicBinDriveOrigin, resolveDataRoot } from 'utarus';
import { getDatabaseRuntime, NoteRepositoryError } from 'utarus/database';
import { withBrokerSyncLease } from '../brokers/sync-lease.js';
import { validDate } from '../brokers/option-executions.js';
import { loadInvestor } from '../state/investor-store.js';
import { premarketOptionsEnabled } from '../webapp/experience-settings.js';
import { dueSession, readTradingDay } from './session.js';
import { renderPremarketReport } from './report.js';
import { scanPremarket } from './scan.js';

let verifiedCalendar: { date: string; trading: boolean } | undefined;
async function tradingDay(date: string) {
  if (verifiedCalendar?.date === date) return verifiedCalendar.trading;
  const trading = await readTradingDay(date);
  verifiedCalendar = { date, trading };
  return trading;
}
const runtime = { listUserIds, loadInvestor, listNotifications, notifyUser, readTradingDay: tradingDay, scanPremarket };
export type PremarketRuntime = Partial<typeof runtime>;

interface PendingReport {
  noteId: string;
  title: string;
  createdAt: string;
  /** Keep the full report until the native note can be read by its owner. */
  body?: string;
  severity?: 'info' | 'medium';
}

const missingFile = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) { if (!missingFile(error)) throw error; }
}
async function removeIfPresent(path: string) {
  try { await unlink(path); }
  catch (error) { if (!missingFile(error)) throw error; }
}
async function atomicWrite(path: string, data: string | Buffer) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}

async function publishReport(userId: string, report: PendingReport, pendingPath: string,
  deps: typeof runtime): Promise<boolean> {
  const notes = getDatabaseRuntime().notes;
  if (report.body !== undefined) {
    // Allocate the ID in the durable draft before creating the native note. A
    // process restart between the database commit and receipt write reuses it.
    try {
      await notes.create({ id: report.noteId, owner_user_id: userId, kind: 'markdown', title: report.title,
        body: report.body, notebook_id: 'default', tags: [], provenance: 'system',
        created_at: report.createdAt, updated_at: report.createdAt });
    } catch (error) {
      if (!(error instanceof NoteRepositoryError && error.code === 'conflict')) throw error;
    }
    await notes.read(userId, report.noteId);
    delete report.body;
    await atomicWrite(pendingPath, JSON.stringify(report));
  } else {
    await notes.read(userId, report.noteId);
  }

  if (report.severity) {
    const href = `/notes/${report.noteId}`;
    // If inbox insertion succeeded before a crash, the framework owns push retries.
    if (!(await deps.listNotifications(userId)).some(notification => notification.href === href)) {
      if (!premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) return false;
      const origin = process.env.UTARUS_PUBLIC_BASE_URL?.trim() || publicBinDriveOrigin();
      // The inbox uses its own origin. Linked channels receive the same link as an absolute URL.
      await deps.notifyUser({ userId, href, source: 'system', title: 'Premarket options report',
        body: new URL(href, origin).href, severity: report.severity });
    }
  }
  return true;
}

export async function runPremarketScans(now = new Date(), overrides: PremarketRuntime = {}) {
  const session = dueSession(now);
  if (!session) return;
  const deps = { ...runtime, ...overrides };
  const enabled = [];
  for (const userId of await deps.listUserIds()) {
    try {
      const snapshot = await deps.loadInvestor(userId);
      if (premarketOptionsEnabled(snapshot.state)) enabled.push(snapshot.state.user.id);
    } catch { console.error('[premarket] Could not read a user setting'); }
  }
  if (!enabled.length || !await deps.readTradingDay(session.date)) return;
  await Promise.all(enabled.map(async userId => {
    const root = join(resolveDataRoot(), 'premarket-options', userId);
    const pendingDir = join(root, 'pending');
    const queuedFiles = await readdir(pendingDir).catch(error => {
      if (missingFile(error)) return [];
      throw error;
    });
    const outstanding = queuedFiles.filter(file => file.endsWith('.json')).map(file => file.slice(0, -5))
      .filter(date => validDate(date) && date < session.date).sort();
    for (const date of [...outstanding, session.date]) {
      try {
        await withBrokerSyncLease(userId, `premarket-options/${date}`, async () => {
          const dir = join(root, date);
          const receipt = join(dir, 'receipt.json');
          const pendingPath = join(pendingDir, `${date}.json`);
          if ((await readJson<{ complete: boolean }>(receipt))?.complete) {
            await removeIfPresent(pendingPath);
            return;
          }
          const snapshot = await deps.loadInvestor(userId);
          if (!premarketOptionsEnabled(snapshot.state)) return;
          let report = await readJson<PendingReport>(pendingPath);
          if (!report) {
            if (date !== session.date) return;
            await mkdir(dir, { recursive: true, mode: 0o700 });
            const scan = await deps.scanPremarket(snapshot, session, now, async (raw, sha256) => {
              const path = join(dir, `${sha256}.${raw.kind}`);
              await atomicWrite(path, raw.body);
              return `${relative(resolveDataRoot(), path)} · SHA-256 ${sha256}`;
            });
            const coverageGap = !!(scan.rows.some(row => row.unverified.length) || scan.notes.length ||
              scan.sources.some(source => source.coverage.length));
            report = { noteId: randomUUID(), createdAt: scan.collectedAt, ...renderPremarketReport(scan),
              severity: coverageGap ? 'medium' : scan.rows.length ? 'info' : undefined };
            await mkdir(pendingDir, { recursive: true, mode: 0o700 });
            await atomicWrite(pendingPath, JSON.stringify(report));
          }
          if (!premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) return;
          if (!await publishReport(userId, report, pendingPath, deps)) return;
          await atomicWrite(receipt, JSON.stringify({ complete: true, noteId: report.noteId }));
          await removeIfPresent(pendingPath);
        });
      } catch (error) { console.error('[premarket] Scan could not finish', userId, date, error); }
    }
  }));
}

export function startPremarketScheduler() {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (active || stopped) return;
    active = runPremarketScans().catch(error => console.error('[premarket] scheduler', error))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 60_000);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); await active; } };
}
