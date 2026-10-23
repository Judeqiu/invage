import { runDailyBrokerSyncs } from './daily-sync.js';

const TICK_MS = 60_000;

export function startBrokerSyncScheduler(): { stop: () => Promise<void> } {
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped || active) return;
    active = (async () => {
      const now = new Date();
      await runDailyBrokerSyncs(now);
    })().catch(error => console.error('[broker/scheduler]', error))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, TICK_MS);
  tick();
  return { stop: async () => { stopped = true; clearInterval(timer); await active; } };
}
