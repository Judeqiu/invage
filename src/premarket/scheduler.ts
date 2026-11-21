import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { listNotifications, listUserIds, notifyUser, resolveDataRoot, sessionBinDriveViewUrl } from 'utarus';
import { withBrokerSyncLease } from '../brokers/sync-lease.js';
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
interface SessionReceipt {
  filename?: string;
  notificationBody?: string;
  coverageGap?: boolean;
  complete: boolean;
}
async function atomicWrite(path: string, data: string | Buffer) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
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
    try {
      await withBrokerSyncLease(userId, `premarket-options/${session.date}`, async () => {
        const dir = join(resolveDataRoot(), 'premarket-options', userId, session.date);
        const receipt = join(dir, 'receipt.json');
        let outcome: SessionReceipt;
        try { outcome = JSON.parse(await readFile(receipt, 'utf8')) as SessionReceipt; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          outcome = { complete: false };
        }
        if (outcome.complete) return;
        const snapshot = await deps.loadInvestor(userId);
        if (!premarketOptionsEnabled(snapshot.state)) return;
        await mkdir(dir, { recursive: true, mode: 0o700 });
        if (!outcome.filename) {
          const scan = await deps.scanPremarket(snapshot, session, now, async (raw, sha256) => {
            const path = join(dir, `${sha256}.${raw.kind}`);
            await atomicWrite(path, raw.body);
            return `${relative(resolveDataRoot(), path)} · SHA-256 ${sha256}`;
          });
          if (!premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) return;
          const confirmed = scan.rows.filter(row => !row.unverified.length).length;
          const unresolved = scan.rows.length - confirmed;
          const coverageGap = !!(unresolved || scan.notes.length || scan.sources.some(source => source.coverage.length));
          const filename = `premarket-options-${session.date}.html`;
          const drive = join(resolveDataRoot(), 'drive', userId);
          await mkdir(drive, { recursive: true, mode: 0o700 });
          await atomicWrite(join(drive, filename), renderPremarketReport(scan));
          outcome = { filename, coverageGap, complete: false,
            ...(confirmed || coverageGap ? { notificationBody: `${session.date} · ${confirmed} confirmed triggers · ${unresolved} positions to verify. Open your private report to compare holding, covered calls after assignment, rolling and closing.` } : {}) };
          await atomicWrite(receipt, JSON.stringify(outcome));
        }
        if (outcome.notificationBody && premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) {
          const href = new URL(sessionBinDriveViewUrl(userId, outcome.filename!)).pathname;
          // If inbox insertion succeeded before a crash, the framework owns push retries.
          if (!(await deps.listNotifications(userId)).some(notification => notification.href === href)) {
            if (!premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) return;
            await deps.notifyUser({ userId, href, source: 'system', title: 'Premarket options report',
              body: outcome.notificationBody, severity: outcome.coverageGap ? 'medium' : 'info' });
          }
        }
        await atomicWrite(receipt, JSON.stringify({ ...outcome, complete: true }));
      });
    } catch (error) { console.error('[premarket] Scan could not finish', userId, error); }
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
