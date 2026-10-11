/**
 * Postgres pool for Invage books. Fail fast when URL missing or query fails.
 */

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function booksDatabaseUrl(): string | null {
  const url = process.env.INVAGE_BOOKS_DATABASE_URL;
  if (url == null || String(url).trim().length === 0) return null;
  return String(url).trim();
}

export function isBooksEnabled(): boolean {
  return booksDatabaseUrl() != null;
}

export function requireBooksUrl(): string {
  const url = booksDatabaseUrl();
  if (url == null) {
    throw new Error(
      'INVAGE_BOOKS_DATABASE_URL is required for books of record operations.',
    );
  }
  return url;
}

export function getPool(): pg.Pool {
  if (pool != null) return pool;
  const url = requireBooksUrl();
  pool = new Pool({ connectionString: url });
  pool.on('error', (err) => {
    console.error('[books] idle client error', err);
  });
  return pool;
}

/** Reset pool (tests). */
export async function closePool(): Promise<void> {
  if (pool != null) {
    await pool.end();
    pool = null;
  }
}

export type BooksClient = pg.PoolClient;

/**
 * Run work in a transaction with RLS tenant GUC set.
 * householdId must be a UUID string matching households.id.
 */
export async function withHouseholdTx<T>(
  householdId: string,
  fn: (client: BooksClient) => Promise<T>,
): Promise<T> {
  if (typeof householdId !== 'string' || householdId.trim().length === 0) {
    throw new Error('withHouseholdTx: householdId is required.');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // set_config is transaction-local when is_local = true
    await client.query(`SELECT set_config('app.household_id', $1, true)`, [
      householdId.trim(),
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Superuser / migrator connection without RLS tenant (schema setup, bootstrap household). */
export async function withAdminClient<T>(
  fn: (client: BooksClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
