import { withBrokerSyncBatchNotifications, type BrokerSyncBatchNotice } from './sync-notification.js';
import { singaporeDate } from '../report/daily-changes.js';
import { getBrokerConnector } from './catalog.js';
import { runDailyBrokerSyncs } from './daily-sync.js';
import { listUserIds } from 'utarus';
import { loadInvestor, saveInvestor } from '../state/investor-store.js';
import { brokerSyncInProgress, nextBrokerSyncAt, persistBrokerAccountModel, readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const TICK_MS = 60_000;
const runtime = { listUserIds, loadInvestor, saveInvestor, syncBrokerAccount };

/** Claim a due run in the optimistic state store before contacting a broker. */
export async function runDueBrokerSyncs(now = new Date(), deps: typeof runtime = runtime): Promise<void> {
  for (const slug of await deps.listUserIds()) {
    let ids: string[];
    try {
      const snapshot = await deps.loadInvestor(slug);
      ids = Object.entries(readBrokerAccountModel(snapshot.state).connections)
        .filter(([, conn]) => conn.enabled && conn.account_id && conn.sync_schedule &&
          Date.parse(conn.sync_schedule.next_run_at) <= now.getTime())
        .map(([id]) => id);
    } catch (error) {
      console.error('[broker/scheduler] scan', slug, error);
      continue;
    }
    const notice: BrokerSyncBatchNotice = { userId: slug, date: singaporeDate(now.toISOString()), accounts: [] };
    await withBrokerSyncBatchNotifications(notice, async () => {
      for (const id of ids) {
        let result: BrokerSyncBatchNotice['accounts'][number] | undefined;
        try {
          const snapshot = await deps.loadInvestor(slug);
          notice.userId = snapshot.state.user.id;
          const model = readBrokerAccountModel(snapshot.state);
          const conn = model.connections[id];
          const schedule = conn?.sync_schedule;
          if (!conn?.enabled || !conn.account_id || !schedule || brokerSyncInProgress(slug, id) ||
              Date.parse(schedule.next_run_at) > now.getTime()) continue;
          const alreadySynced = conn.last_sync?.ok && Date.parse(conn.last_sync.at) >= Date.parse(schedule.next_run_at);
          schedule.next_run_at = nextBrokerSyncAt(schedule.frequency, now);
          persistBrokerAccountModel(snapshot.state, model);
          await deps.saveInvestor(snapshot);
          if (alreadySynced) continue;
          result = { label: `${getBrokerConnector(conn.broker_id).displayName} · ${conn.label}`, status: 'running' };
          notice.accounts.push(result);
          const synced = await deps.syncBrokerAccount(snapshot, id, undefined, 'scheduled');
          result.status = 'succeeded';
          if (synced.aggregation?.status === 'failed' || notice.calculationStatus !== 'failed') notice.calculationStatus = synced.aggregation?.status;
        } catch (error) {
          if (result) result.status = 'failed';
          console.error('[broker/scheduler] sync', slug, id, error);
        }
      }
    });
  }
}

export function startBrokerSyncScheduler(): { stop: () => Promise<void> } {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = (async () => {
      const now = new Date();
      await runDailyBrokerSyncs(now);
      await runDueBrokerSyncs(now);
    })().catch(error => console.error('[broker/scheduler]', error))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, TICK_MS);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); await active; } };
}
