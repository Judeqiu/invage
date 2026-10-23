import type { InvestorSnapshot } from './investor-store.js';

type Refresher = (userId: string, force?: boolean) => Promise<void>;
let refresher: Refresher | undefined;
type CalculationStatus = { status: 'ready' | 'pending' | 'failed' };
const batches = new Map<string, { depth: number; dirty: boolean }>();
export const portfolioRefreshDeferred = (userId: string) => batches.has(userId);

/** Import all accounts first; a dated snapshot may force the final calculation before returning. */
export async function withPortfolioRefreshBatch<T>(userId: string, work: () => Promise<T>, calculated: (result: CalculationStatus) => void): Promise<T> {
  const batch = batches.get(userId) ?? { depth: 0, dirty: false };
  batch.depth++;
  batches.set(userId, batch);
  try { return await work(); }
  finally {
    if (--batch.depth === 0) {
      batches.delete(userId);
      if (batch.dirty) calculated(await refreshPortfolioAfterSync(userId));
    }
  }
}
export function registerPortfolioRefresher(next: Refresher): () => void {
  refresher = next;
  return () => { if (refresher === next) refresher = undefined; };
}
/** State writes enqueue a refresh; sync completion additionally waits for it. */
export function portfolioStateSaved(snapshot: InvestorSnapshot): void {
  const batch = batches.get(snapshot.state.user.id);
  if (batch) { batch.dirty = true; return; }
  if (refresher) void refresher(snapshot.state.user.id).catch(error => console.error('[portfolio/projection]', error));
}
export async function refreshPortfolioAfterSync(userId: string, force = false): Promise<CalculationStatus> {
  const batch = batches.get(userId);
  if (batch && !force) { batch.dirty = true; return { status: 'pending' }; }
  if (!refresher) return { status: 'pending' };
  try {
    await refresher(userId, force);
    if (batch) batch.dirty = false;
    return { status: 'ready' };
  }
  catch (error) { console.error('[portfolio/projection] sync refresh failed', userId, error); return { status: 'failed' }; }
}
