import { randomUUID } from 'node:crypto';
import { loadInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { readBrokerAccountModel, syncBrokerAccount } from './accounts.js';

const runtime = { loadInvestor, syncBrokerAccount };
export type BrokerSyncJob = {
  id: string;
  status: 'running' | 'completed';
  calculationStatus?: 'ready' | 'pending' | 'failed';
  accounts: { id: string; label: string; status: 'pending' | 'running' | 'succeeded' | 'failed' }[];
};

/** One background batch per investor. Retain only the latest job for each user. */
export function createBrokerSyncJobs(deps = runtime) {
  const jobs = new Map<string, BrokerSyncJob>();
  return {
    get: (userId: string) => jobs.get(userId) ?? null,
    start(snapshot: InvestorSnapshot): BrokerSyncJob {
      const userId = snapshot.state.user.id;
      const active = jobs.get(userId);
      if (active?.status === 'running') return active;
      const job: BrokerSyncJob = {
        id: randomUUID(), status: 'running',
        accounts: Object.entries(readBrokerAccountModel(snapshot.state).connections)
          .filter(([, conn]) => conn.enabled)
          .map(([id, conn]) => ({ id, label: conn.label, status: 'pending' })),
      };
      jobs.set(userId, job);
      // Reload before each account: successful syncs update the investor revision.
      // Sequential imports also avoid competing writes to shared portfolio state.
      void (async () => {
        job.calculationStatus = 'ready';
        for (const account of job.accounts) {
          account.status = 'running';
          try {
            const result = await deps.syncBrokerAccount(await deps.loadInvestor(userId), account.id);
            const status = result?.aggregation?.status;
            if (status === 'failed') job.calculationStatus = 'failed';
            else if (status !== 'ready' && job.calculationStatus !== 'failed') job.calculationStatus = 'pending';
            account.status = 'succeeded';
          } catch {
            account.status = 'failed';
          }
        }
        job.status = 'completed';
      })();
      return job;
    },
  };
}
