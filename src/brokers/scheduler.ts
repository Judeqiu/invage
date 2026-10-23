import { dueBrokerSyncs, finishBrokerSync, brokerSyncBinding } from './sync-retries.js';
import { loadInvestor } from '../state/investor-store.js';
import { brokerSyncInProgress, readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const retryRuntime = { dueBrokerSyncs, finishBrokerSync, loadInvestor, brokerSyncInProgress, readBrokerAccountModel, syncBrokerAccount };
export async function retryBrokerSyncs(now = new Date(), overrides: Partial<typeof retryRuntime> = {}): Promise<void> {
  const deps = { ...retryRuntime, ...overrides };
  for (const job of deps.dueBrokerSyncs(now)) {
    try {
      const snapshot = await deps.loadInvestor(job.userId);
      const connection = deps.readBrokerAccountModel(snapshot.state).connections[job.connectionId];
      if (!connection?.enabled || brokerSyncBinding(connection) !== job.binding) {
        deps.finishBrokerSync(job, true); // Explicit pause/removal/rebinding cancels retries.
        continue;
      }
      if (deps.brokerSyncInProgress(job.userId, job.connectionId)) continue;
      await deps.syncBrokerAccount(snapshot, job.connectionId, undefined, 'scheduled', job.full);
    } catch (error) {
      // If SQL is unavailable even before sync starts, keep the disk-backed intent.
      deps.finishBrokerSync(job, false, now);
      console.error('[broker/scheduler] retry', job.userId, job.connectionId, error);
    }
  }
}

import { runDailyBrokerSyncs } from './daily-sync.js';

const TICK_MS = 60_000;

export function startBrokerSyncScheduler(): { stop: () => Promise<void> } {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = (async () => {
      const now = new Date();
      try { await retryBrokerSyncs(now); } catch (error) { console.error('[broker/scheduler] recovery scan', error); }
      await runDailyBrokerSyncs(now);
    })().catch(error => console.error('[broker/scheduler]', error))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, TICK_MS);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); await active; } };
}
