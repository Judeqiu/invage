import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listNotifications, listUserIds, notifyUser, resolveDataRoot } from 'utarus';
import { withBrokerSyncLease } from '../brokers/sync-lease.js';
import { validDate } from '../brokers/option-executions.js';
import { loadInvestor } from '../state/investor-store.js';
import { premarketOptionsEnabled } from '../webapp/experience-settings.js';
import { dueSession, readTradingDay } from './session.js';
import { scanPremarket } from './scan.js';
import { atomicWrite, missingFile, readJson, removeIfPresent, saveReportNote, sendReportLink,
  prepareReport, type PendingReport } from './publication.js';

let verifiedCalendar: { date: string; trading: boolean } | undefined;
async function tradingDay(date: string) {
  if (verifiedCalendar?.date === date) return verifiedCalendar.trading;
  const trading = await readTradingDay(date);
  verifiedCalendar = { date, trading };
  return trading;
}
const runtime = { listUserIds, loadInvestor, listNotifications, notifyUser, readTradingDay: tradingDay, scanPremarket };
export type PremarketRuntime = Partial<typeof runtime>;

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
            ({ report } = await prepareReport(snapshot, session, now, dir, deps.scanPremarket));
            await mkdir(pendingDir, { recursive: true, mode: 0o700 });
            await atomicWrite(pendingPath, JSON.stringify(report));
          }
          if (!premarketOptionsEnabled((await deps.loadInvestor(userId)).state)) return;
          await saveReportNote(userId, report);
          if (report.body !== undefined) {
            delete report.body;
            await atomicWrite(pendingPath, JSON.stringify(report));
          }
          if (!await sendReportLink(userId, report, deps,
              async () => premarketOptionsEnabled((await deps.loadInvestor(userId)).state))) return;
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
