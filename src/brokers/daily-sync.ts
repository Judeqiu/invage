import { readBrokerSyncConfig } from '../webapp/dashboard-config.js';
import { withBrokerSyncBatchNotifications, type BrokerSyncBatchNotice } from './sync-notification.js';
import { getBrokerConnector } from './catalog.js';
import { listUserIds } from 'utarus';
import { loadInvestor, saveInvestor } from '../state/investor-store.js';
import { brokerBatchAccounts as accounts, captureBrokerBatchSnapshot, finishBrokerSyncBatch } from './sync-batch.js';
import { brokerSyncInProgress, readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const runtime = { readBrokerSyncConfig, listUserIds, loadInvestor, saveInvestor, syncBrokerAccount,
  brokerSyncInProgress,
  capturePortfolioSnapshot: captureBrokerBatchSnapshot };
const RETRY_MS = 30 * 60_000;
const LEASE_MS = 6 * 60 * 60_000;

/** Every user is scanned on each tick, so existing and future accounts opt in automatically. */
export async function runDailyBrokerSyncs(now = new Date(), overrides: Partial<typeof runtime> = {}): Promise<void> {
  const deps = { ...runtime, ...overrides };
  const config = deps.readBrokerSyncConfig();
  if (!config.enabled) return;
  // Singapore is UTC+8 year-round; the batch date is fixed before any network work.
  const singapore = new Date(now.getTime() + 8 * 60 * 60_000);
  const today = singapore.toISOString().slice(0, 10);
  const due = singapore.getUTCHours() * 60 + singapore.getUTCMinutes() >= config.minuteOfDay;
  for (const slug of await deps.listUserIds()) {
    const notice: BrokerSyncBatchNotice = { userId: slug, date: today, accounts: [] };
    await withBrokerSyncBatchNotifications(notice, async () => {
      let claimed = false;
      try {
        const snapshot = await deps.loadInvestor(slug);
        const eligible = accounts(snapshot.state);
        if (!Object.keys(eligible).length) return;
        let batch = snapshot.state.daily_broker_sync;
        if (batch?.lease_until && Date.parse(batch.lease_until) > now.getTime()) return;
        if (batch?.retry_after && Date.parse(batch.retry_after) > now.getTime()) return;
        if (!batch || (batch.date !== today && (batch.completed_at || due))) {
          if (!due) return;
          batch = { date: today, synced_accounts: {} };
        }
        const completed = batch;
        if (completed.completed_at && Object.entries(eligible).every(([id, key]) => completed.synced_accounts[id] === key)) return;
        delete batch.completed_at;
        batch.lease_until = new Date(now.getTime() + LEASE_MS).toISOString();
        snapshot.state.daily_broker_sync = batch;
        // The optimistic revision claim prevents another scheduler from starting this batch.
        await deps.saveInvestor(snapshot);
        claimed = true;
        const date = batch.date;
        notice.date = date;
        notice.userId = snapshot.state.user.id;
        const connections = readBrokerAccountModel(snapshot.state).connections;
        const results = Object.entries(eligible).map(([id, key]) => ({ id,
          label: `${getBrokerConnector(connections[id].broker_id).displayName} · ${connections[id].label}`,
          status: batch!.synced_accounts[id] === key ? 'succeeded' : 'pending' }));
        notice.accounts = results;
        notice.snapshotStatus = 'pending';
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
            results.find(account => account.id === id)!.status = 'succeeded';
          } catch (error) {
            results.find(account => account.id === id)!.status = 'failed';
            console.error('[broker/daily-sync] account', slug, id, error);
          }
        }
        const fresh = await deps.loadInvestor(slug);
        batch = fresh.state.daily_broker_sync!;
        const captured = await finishBrokerSyncBatch(fresh.state, date, batch.synced_accounts, deps.capturePortfolioSnapshot);
        if (captured) {
          notice.snapshotStatus = 'saved';
          notice.calculationStatus = captured.aggregation?.status;
          batch.completed_at = new Date().toISOString();
          delete batch.retry_after;
        } else {
          notice.snapshotStatus = 'skipped';
          notice.retryScheduled = true;
          batch.retry_after = new Date(now.getTime() + RETRY_MS).toISOString();
        }
        delete batch.lease_until;
        await deps.saveInvestor(fresh);
      } catch (error) {
        console.error('[broker/daily-sync] batch', slug, error);
        if (claimed) {
          notice.snapshotStatus = 'failed';
          notice.error = 'The sync batch could not finish saving its snapshot and aggregates.';
          notice.retryScheduled = true;
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
    });
  }
}
