import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { listNotifications, notifyUser, resolveDataRoot } from 'utarus';
import { withBrokerSyncLease } from '../brokers/sync-lease.js';
import { loadInvestor } from '../state/investor-store.js';
import { atomicWrite, noteHref, prepareReport, readJson, saveReportNote, sendReportLink, type PendingReport } from './publication.js';
import { scanPremarket, type Session } from './scan.js';
import { decisionSession, isUsWeekend, readTradingDay } from './session.js';
import type { ReportTrigger, reportCoverage } from './report.js';

interface ManualReport {
  report: PendingReport;
  session: Session;
  coverage: ReturnType<typeof reportCoverage>;
  notified: boolean;
}

const runtime = { loadInvestor, scanPremarket, readTradingDay, listNotifications, notifyUser };
export type ManualReportDependencies = Partial<typeof runtime>;
export interface ManualReportAction {
  userId: string;
  conversationId: string;
  requestId: string;
}

async function marketStatus(date: string, tradingDay: typeof readTradingDay): Promise<ReportTrigger['market']> {
  if (isUsWeekend(date)) return 'weekend';
  try { return await tradingDay(date) ? 'trading-day' : 'holiday'; }
  catch { return 'unknown'; }
}

function actionResult(run: ManualReport) {
  return {
    href: noteHref(run.report.noteId),
    title: run.report.title,
    session: run.session,
    coverage: run.coverage,
    notified: run.notified,
  };
}
export type ManualReportResult = ReturnType<typeof actionResult>;
const inFlight = new Map<string, Promise<ManualReportResult>>();

/** Use the host's human message identity to replay a single action; a new message always rescans. */
export async function runOnDemandOptionReport(action: ManualReportAction, now = new Date(),
  overrides: ManualReportDependencies = {}): Promise<ManualReportResult> {
  const { userId, conversationId, requestId } = action;
  const key = createHash('sha256').update(JSON.stringify([userId, conversationId, requestId])).digest('hex');
  const existing = inFlight.get(key);
  if (existing) return existing;

  const deps = { ...runtime, ...overrides };
  const work = withBrokerSyncLease(userId, `premarket-options/manual/${key}`, async () => {
    const dir = join(resolveDataRoot(), 'premarket-options', userId, 'manual', key);
    const receipt = join(dir, 'run.json');
    let run = await readJson<ManualReport>(receipt);
    if (!run) {
      const snapshot = await deps.loadInvestor(userId);
      const session = decisionSession(now);
      const market = await marketStatus(session.date, deps.readTradingDay);
      const { report, coverage } = await prepareReport(snapshot, session, now, dir, deps.scanPremarket, { kind: 'manual', market });
      run = { report, coverage, session, notified: false };
      await atomicWrite(receipt, JSON.stringify(run));
    }

    await saveReportNote(userId, run.report);
    if (run.notified && run.report.body === undefined) return actionResult(run);
    if (!run.notified) {
      try {
        await sendReportLink(userId, run.report, deps);
        run.notified = true;
      } catch (error) {
        // The note can already be opened. A replay will retry only the notification.
        console.error('[premarket/manual] Could not finish report notification', error);
      }
    }
    delete run.report.body;
    try { await atomicWrite(receipt, JSON.stringify(run)); }
    catch (error) {
      // The draft already on disk retains the same note ID for a replay.
      console.error('[premarket/manual] Could not update the report receipt', error);
    }
    return actionResult(run);
  });
  inFlight.set(key, work);
  try { return await work; }
  finally { inFlight.delete(key); }
}
