import { loadState, saveState } from 'utarus';
import type { InvestorState } from './portfolio-state.js';
import { isBooksEnabled, withHouseholdTx } from '../books/db.js';
import { ensureBooksSeeded, householdContextFromState } from '../books/service.js';
import { reconcileInvestorBooks } from '../books/state-reconcile.js';

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
  if (isBooksEnabled()) {
    // Seed from the persisted revision, then serialize reconciliation and the
    // optimistic state update under the same household advisory lock.
    const persisted = await loadState(snapshot.state.user.slug);
    if (persisted.revision !== snapshot.revision) {
      throw new Error('Investor state changed during this update; reload before saving.');
    }
    await ensureBooksSeeded(persisted.state as InvestorState);
    const ctx = householdContextFromState(snapshot.state);
    await withHouseholdTx(ctx.householdId, async client => {
      const current = await loadState(snapshot.state.user.slug);
      if (current.revision !== snapshot.revision) {
        throw new Error('Investor state changed during this update; reload before saving.');
      }
      await reconcileInvestorBooks(current.state as InvestorState, snapshot.state, snapshot.revision, client);
      await saveState(snapshot.state, snapshot.revision);
    });
  } else {
    if (process.env.INVAGE_REQUIRE_BOOKS_FOR_PORTFOLIO === 'true') {
      const persisted = await loadState(snapshot.state.user.slug);
      if (persisted.revision !== snapshot.revision) {
        throw new Error('Investor state changed during this update; reload before saving.');
      }
      await reconcileInvestorBooks(persisted.state as InvestorState, snapshot.state, snapshot.revision);
    }
    await saveState(snapshot.state, snapshot.revision);
  }
  // The repository increments exactly once on successful optimistic update.
  snapshot.revision += 1;
}
