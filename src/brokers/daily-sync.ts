import { listUserIds } from 'utarus';
import { loadInvestor, saveInvestor } from '../state/investor-store.js';
import { brokerBatchAccounts as accounts, captureBrokerBatchSnapshot, finishBrokerSyncBatch } from './sync-batch.js';
import { brokerSyncInProgress, syncBrokerAccount } from './accounts.js';

const runtime = { listUserIds, loadInvestor, saveInvestor, syncBrokerAccount,
  brokerSyncInProgress,
  capturePortfolioSnapshot: captureBrokerBatchSnapshot };
const RETRY_MS = 30 * 60_000;
const LEASE_MS = 6 * 60 * 60_000;

/** Every user is scanned on each tick, so existing and future accounts opt in automatically. */
export async function runDailyBrokerSyncs(now = new Date(), deps: typeof runtime = runtime): Promise<void> {
  // Singapore is UTC+8 year-round; the batch date is fixed before any network work.
  const singapore = new Date(now.getTime() + 8 * 60 * 60_000);
  const today = singapore.toISOString().slice(0, 10);
  for (const slug of await deps.listUserIds()) {
    let claimed = false;
    try {
      const snapshot = await deps.loadInvestor(slug);
      const eligible = accounts(snapshot.state);
      if (!Object.keys(eligible).length) continue;
      let batch = snapshot.state.daily_broker_sync;
      if (batch?.lease_until && Date.parse(batch.lease_until) > now.getTime()) continue;
      if (batch?.retry_after && Date.parse(batch.retry_after) > now.getTime()) continue;
      if (!batch || (batch.date !== today && (batch.completed_at || singapore.getUTCHours() >= 14))) {
        if (singapore.getUTCHours() < 14) continue;
        batch = { date: today, synced_accounts: {} };
      }
      const completed = batch;
      if (completed.completed_at && Object.entries(eligible).every(([id, key]) => completed.synced_accounts[id] === key)) continue;
      delete batch.completed_at;
      batch.lease_until = new Date(now.getTime() + LEASE_MS).toISOString();
      snapshot.state.daily_broker_sync = batch;
      // The optimistic revision claim prevents another scheduler from starting this batch.
      await deps.saveInvestor(snapshot);
      claimed = true;
      const date = batch.date;
      for (const [id, key] of Object.entries(eligible)) {
        if (batch.synced_accounts[id] === key) continue;
        try {
          const fresh = await deps.loadInvestor(slug);
          if (accounts(fresh.state)[id] !== key || deps.brokerSyncInProgress(fresh.state.user.id, id)) continue;
          await deps.syncBrokerAccount(fresh, id, undefined, 'scheduled');
          const updated = await deps.loadInvestor(slug);
          const progress = updated.state.daily_broker_sync;
          if (!progress || progress.date !== date) throw new Error('Daily broker sync batch changed.');
          progress.synced_accounts[id] = key;
          await deps.saveInvestor(updated);
        } catch (error) {
          console.error('[broker/daily-sync] account', slug, id, error);
        }
      }
      const fresh = await deps.loadInvestor(slug);
      batch = fresh.state.daily_broker_sync!;
      const captured = await finishBrokerSyncBatch(fresh.state, date, batch.synced_accounts, deps.capturePortfolioSnapshot);
      if (captured) {
        batch.completed_at = new Date().toISOString();
        delete batch.retry_after;
      } else {
        batch.retry_after = new Date(now.getTime() + RETRY_MS).toISOString();
      }
      delete batch.lease_until;
      await deps.saveInvestor(fresh);
    } catch (error) {
      console.error('[broker/daily-sync] batch', slug, error);
      if (claimed) {
        try {
          const fresh = await deps.loadInvestor(slug);
          if (fresh.state.daily_broker_sync) {
            delete fresh.state.daily_broker_sync.lease_until;
            fresh.state.daily_broker_sync.retry_after = new Date(now.getTime() + RETRY_MS).toISOString();
            await deps.saveInvestor(fresh);
          }
        } catch (releaseError) {
          console.error('[broker/daily-sync] release', slug, releaseError);
        }
      }
    }
  }
}
