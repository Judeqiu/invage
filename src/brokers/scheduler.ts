import { listUserSlugs } from 'utarus';
import { loadInvestor, saveInvestor } from '../state/investor-store.js';
import { brokerSyncInProgress, nextBrokerSyncAt, persistBrokerAccountModel, readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const TICK_MS = 60_000;
const runtime = { listUserSlugs, loadInvestor, saveInvestor, syncBrokerAccount };

/** Claim a due run in the optimistic state store before contacting a broker. */
export async function runDueBrokerSyncs(now = new Date(), deps: typeof runtime = runtime): Promise<void> {
  for (const slug of await deps.listUserSlugs()) {
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
    for (const id of ids) {
      try {
        const snapshot = await deps.loadInvestor(slug);
        const model = readBrokerAccountModel(snapshot.state);
        const conn = model.connections[id];
        const schedule = conn?.sync_schedule;
        if (!conn?.enabled || !conn.account_id || !schedule || brokerSyncInProgress(slug, id) ||
            Date.parse(schedule.next_run_at) > now.getTime()) continue;
        schedule.next_run_at = nextBrokerSyncAt(schedule.frequency, now);
        persistBrokerAccountModel(snapshot.state, model);
        await deps.saveInvestor(snapshot);
        await deps.syncBrokerAccount(snapshot, id, undefined, 'scheduled');
      } catch (error) {
        console.error('[broker/scheduler] sync', slug, id, error);
      }
    }
  }
}

export function startBrokerSyncScheduler(): { stop: () => Promise<void> } {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = runDueBrokerSyncs().catch(error => console.error('[broker/scheduler]', error))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, TICK_MS);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); await active; } };
}
