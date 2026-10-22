import type { InvestorSnapshot } from './investor-store.js';

type Refresher = (userId: string, force?: boolean) => Promise<void>;
let refresher: Refresher | undefined;
export function registerPortfolioRefresher(next: Refresher): () => void {
  refresher = next;
  return () => { if (refresher === next) refresher = undefined; };
}
/** State writes enqueue a refresh; sync completion additionally waits for it. */
export function portfolioStateSaved(snapshot: InvestorSnapshot): void {
  if (refresher) void refresher(snapshot.state.user.id).catch(error => console.error('[portfolio/projection]', error));
}
export async function refreshPortfolioAfterSync(userId: string, force = false): Promise<{ status: 'ready' | 'pending' | 'failed' }> {
  if (!refresher) return { status: 'pending' };
  try { await refresher(userId, force); return { status: 'ready' }; }
  catch (error) { console.error('[portfolio/projection] sync refresh failed', userId, error); return { status: 'failed' }; }
}
