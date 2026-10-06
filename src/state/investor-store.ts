import { loadState, saveState } from 'utarus';
import type { InvestorState } from './portfolio-state.js';
import { isBooksEnabled, withHouseholdPostCommit } from '../books/db.js';
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
    // Seed from the persisted revision, then hold one household lock until
    // books have committed and the optimistic state update has completed.
    const persisted = await loadState(snapshot.state.user.slug);
    if (persisted.revision !== snapshot.revision) {
      throw new Error('Investor state changed during this update; reload before saving.');
    }
    await ensureBooksSeeded(persisted.state as InvestorState);
    const ctx = householdContextFromState(snapshot.state);
    await withHouseholdPostCommit(ctx.householdId,
      async client => {
        const current = await loadState(snapshot.state.user.slug);
        if (current.revision !== snapshot.revision) {
          throw new Error('Investor state changed during this update; reload before saving.');
        }
        return reconcileInvestorBooks(current.state as InvestorState, snapshot.state, snapshot.revision, client);
      },
      () => saveState(snapshot.state, snapshot.revision),
      async client => {
        const actual = await loadState(snapshot.state.user.slug);
        await reconcileInvestorBooks(snapshot.state, actual.state as InvestorState, actual.revision, client);
      },
    );
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
