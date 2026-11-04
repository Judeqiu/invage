import { getAccountAuthority } from '../../node_modules/utarus/dist/database/binding.js';
import { getSharedAccountClient } from '../../node_modules/utarus/dist/accounts/shared-runtime.js';
import { loadInvestor, type InvestorSnapshot } from './investor-store.js';
import { resolveDataRoot } from 'utarus';
import { freezeReadModel } from './freeze-read-model.js';

interface ReadRuntime {
  identity(userId: string): Promise<{revision: number; state: {user: {deleted_at?: string}}}>;
  load(userId: string): Promise<InvestorSnapshot>;
  shared(): boolean;
  namespace(): string;
}
/** Fresh revision check on every read; mutable writes always use loadInvestor. */
export function createReadModelStateLoader(runtime: ReadRuntime) {
  const cached = new Map<string, InvestorSnapshot>();
  const pending = new Map<string, Promise<InvestorSnapshot>>();
  return async (userId: string): Promise<InvestorSnapshot> => {
    if (runtime.shared()) return runtime.load(userId);
    const identity = await runtime.identity(userId);
    if (identity.state.user.deleted_at !== undefined) throw new Error('Investor account unavailable');
    const key = runtime.namespace() + ':' + userId;
    const prior = cached.get(key);
    if (prior?.revision === identity.revision) return prior;
    const running = pending.get(key);
    if (running) {
      const result = await running;
      if (result.revision >= identity.revision) return result;
    }
    const work = runtime.load(userId).then(snapshot => {
      if (snapshot.state.user.id !== userId) throw new Error('Investor account mismatch');
      if (snapshot.revision < identity.revision) throw new Error('Investor revision changed during read');
      freezeReadModel(snapshot);
      cached.set(key,snapshot);
      return snapshot;
    });
    pending.set(key,work);
    try {return await work;} finally {if(pending.get(key)===work)pending.delete(key);}
  };
}
export const loadInvestorForRead = createReadModelStateLoader({
  identity: userId => getAccountAuthority().users.readIdentityById(userId),
  load: loadInvestor, shared: () => Boolean(getSharedAccountClient()), namespace: resolveDataRoot,
});
