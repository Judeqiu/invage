import { loadState, saveState } from 'utarus';
import { createDatabasePool, createSecretCodec, getDatabaseRuntime, readDatabaseConfig } from 'utarus/database';
import { hasFinancialData, sourceHash } from '../finance/import-personal.js';
import { withFinanceScope } from '../finance/repository.js';
import { assertFinanceSourceCurrent, recordFinanceChange, syncPersonalFinance } from '../finance/sync-personal.js';
import { syncUserSourceFiles } from '../finance/source-files.js';
import type { InvestorState } from './portfolio-state.js';

/** A database read and its concurrency token travel together through mutations. */
export interface InvestorSnapshot {
  state: InvestorState;
  revision: number;
}

export async function loadInvestor(slug: string): Promise<InvestorSnapshot> {
  const snapshot = await loadState(slug);
  await assertInvestorFinanceCurrent(snapshot.state as InvestorState);
  return { state: snapshot.state as InvestorState, revision: snapshot.revision };
}

/** Detect framework or external writes that bypass the finance transaction. */
export async function assertInvestorFinanceCurrent(state: InvestorState): Promise<void> {
  const orgId = state.user.org_id;
  if (process.env.WALLETSTREET_ORG_FINANCE_ENABLED !== 'true' || !orgId) return;
  const pool = createDatabasePool(readDatabaseConfig(process.env), error => { throw error; });
  try {
    await withFinanceScope(pool, state.user.id, orgId, 'read', async ({ client }) => {
      const checkpoint = await client.query<{ source_sha256: string }>(
        `SELECT source_sha256 FROM finance.legacy_migrations
         WHERE org_id=$1 AND source_user_id=$2`, [orgId, state.user.id],
      );
      if (checkpoint.rows[0]?.source_sha256 !== sourceHash(state)) {
        throw new Error('Organization finance differs from the current user state; reconcile before reading');
      }
    });
  } finally {
    await pool.end();
  }
}

export async function saveInvestor(snapshot: InvestorSnapshot): Promise<void> {
  const orgId = snapshot.state.user.org_id;
  if (process.env.WALLETSTREET_ORG_FINANCE_ENABLED === 'true') {
    if (!orgId) {
      if (hasFinancialData(snapshot.state)) {
        throw new Error('Financial data requires organization membership');
      }
      await saveState(snapshot.state, snapshot.revision);
    } else {
      const pool = createDatabasePool(readDatabaseConfig(process.env), error => { throw error; });
      try {
        await withFinanceScope(pool, snapshot.state.user.id, orgId, 'write', async scope => {
          const previous = await getDatabaseRuntime().users.readInTransaction(
            scope.client, snapshot.state.user.slug,
          );
          if (previous.revision !== snapshot.revision) throw new Error('User revision conflict');
          await assertFinanceSourceCurrent(scope.client, orgId, previous.state as InvestorState);
          const previousHash = sourceHash(previous.state as InvestorState);
          const nextHash = sourceHash(snapshot.state);
          await getDatabaseRuntime().users.updateInTransaction(
            scope.client, snapshot.state, snapshot.revision,
          );
          if (previousHash === nextHash) {
            await scope.client.query(
              `UPDATE finance.legacy_migrations SET source_revision=$3
               WHERE org_id=$1 AND source_user_id=$2`,
              [orgId, snapshot.state.user.id, snapshot.revision + 1],
            );
          } else {
            await syncPersonalFinance(scope.client, orgId, snapshot.state, snapshot.revision + 1);
            await recordFinanceChange(scope.client, orgId, previous.state as InvestorState, snapshot.state,
              snapshot.revision + 1, previousHash, nextHash);
          }
          const codec = createSecretCodec({
            keyId: process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
            keyBase64: process.env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '',
          });
          await syncUserSourceFiles(scope.client, orgId, snapshot.state.user.id,
            snapshot.state.user.slug, codec);
        });
      } finally {
        await pool.end();
      }
    }
  } else {
    await saveState(snapshot.state, snapshot.revision);
  }
  // The repository increments exactly once on successful optimistic update.
  snapshot.revision += 1;
}
