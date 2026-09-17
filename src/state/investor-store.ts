import { loadState, saveState } from 'utarus';
import type { InvestorState } from './portfolio-state.js';

/** A database read and its concurrency token travel together through mutations. */
export interface InvestorSnapshot {
  state: InvestorState;
  revision: number;
}

export async function loadInvestor(slug: string): Promise<InvestorSnapshot> {
  const snapshot = await loadState(slug);
  return { state: snapshot.state as InvestorState, revision: snapshot.revision };
}

export async function saveInvestor(snapshot: InvestorSnapshot): Promise<void> {
  await saveState(snapshot.state, snapshot.revision);
  // The repository increments exactly once on successful optimistic update.
  snapshot.revision += 1;
}
