import { singaporeDate } from '../report/daily-changes.js';
import { brokerBatchAccounts, captureBrokerBatchSnapshot, finishBrokerSyncBatch } from './sync-batch.js';
import { randomUUID } from 'node:crypto';
import { loadInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const runtime = { loadInvestor, syncBrokerAccount, capturePortfolioSnapshot: captureBrokerBatchSnapshot, now: () => new Date() };
export type BrokerSyncJob = {
  id: string;
  status: 'running' | 'completed';
  syncDate: string;
  snapshotStatus: 'pending' | 'saved' | 'skipped' | 'failed';
  error?: string;
  calculationStatus?: 'ready' | 'pending' | 'failed';
  accounts: { id: string; label: string; status: 'pending' | 'running' | 'succeeded' | 'failed' }[];
};

/** One background batch per investor. Retain only the latest job for each user. */
export function createBrokerSyncJobs(overrides: Partial<typeof runtime> = {}) {
  const deps = { ...runtime, ...overrides };
  const jobs = new Map<string, BrokerSyncJob>();
  return {
    get: (userId: string) => jobs.get(userId) ?? null,
    start(snapshot: InvestorSnapshot): BrokerSyncJob {
      const userId = snapshot.state.user.id;
      const active = jobs.get(userId);
      if (active?.status === 'running') return active;
      const eligible = brokerBatchAccounts(snapshot.state);
      const synced: Record<string, string> = {};
      const job: BrokerSyncJob = {
        id: randomUUID(), status: 'running', syncDate: singaporeDate(deps.now().toISOString()), snapshotStatus: 'pending',
        accounts: Object.entries(readBrokerAccountModel(snapshot.state).connections)
          .filter(([id]) => id in eligible)
          .map(([id, conn]) => ({ id, label: conn.label, status: 'pending' })),
      };
      jobs.set(userId, job);
      // Reload before each account: successful syncs update the investor revision.
      // Sequential imports also avoid competing writes to shared portfolio state.
      void (async () => {
        job.calculationStatus = 'ready';
        try {
          for (const account of job.accounts) {
            account.status = 'running';
            try {
              const fresh = await deps.loadInvestor(userId);
              if (brokerBatchAccounts(fresh.state)[account.id] !== eligible[account.id]) throw new Error('Account binding changed.');
              const result = await deps.syncBrokerAccount(fresh, account.id);
              synced[account.id] = eligible[account.id];
              const status = result?.aggregation?.status;
              if (status === 'failed') job.calculationStatus = 'failed';
              else if (status !== 'ready' && job.calculationStatus !== 'failed') job.calculationStatus = 'pending';
              account.status = 'succeeded';
            } catch {
              account.status = 'failed';
            }
          }
          if (job.accounts.length && job.accounts.every(account => account.status === 'succeeded')) {
            const fresh = await deps.loadInvestor(userId);
            const captured = await finishBrokerSyncBatch(fresh.state, job.syncDate, synced, deps.capturePortfolioSnapshot);
            job.snapshotStatus = captured ? 'saved' : 'skipped';
            if (captured?.aggregation) job.calculationStatus = captured.aggregation.status;
            if (!captured) job.error = 'Broker accounts changed during sync. Sync brokers again to save a complete snapshot.';
          } else job.snapshotStatus = 'skipped';
        } catch {
          job.snapshotStatus = 'failed';
          job.error = 'Could not finish saving the portfolio snapshot and aggregates. Sync brokers again to retry.';
        } finally { job.status = 'completed'; }
      })();
      return job;
    },
  };
}
