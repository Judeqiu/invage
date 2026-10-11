import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll } from 'vitest';
import pg from 'pg';
import { createState, type UserState } from 'utarus';
import {
  bindDatabaseRuntime,
  openDatabaseRuntime,
  initializeDatabase,
  createSecretCodec,
  type DatabaseRuntime,
} from 'utarus/database';

/** Each importing test file owns disposable databases; no configured app DB is used. */
export async function useTestDatabase(options: { books?: boolean } = {}) {
  const configured = process.env.UTARUS_TEST_DATABASE_URL;
  if (!configured) {
    throw new Error('UTARUS_TEST_DATABASE_URL is required for database integration tests');
  }
  const adminUrl = new URL(configured);
  if (
    !['postgres:', 'postgresql:'].includes(adminUrl.protocol) ||
    adminUrl.pathname !== '/utarus_test_admin' ||
    adminUrl.search
  ) {
    throw new Error('UTARUS_TEST_DATABASE_URL must explicitly name utarus_test_admin without URL options');
  }
  const admin = new pg.Pool({ connectionString: configured, max: 1 });
  const owned: string[] = [];
  let runtime: DatabaseRuntime | undefined;
  let unbind: (() => void) | undefined;

  async function createDisposable() {
    const name = `invage_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    owned.push(name);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    return url.toString();
  }

  async function cleanup() {
    if (unbind) unbind();
    if (runtime) await runtime.close();
    if (options.books) {
      const { closePool } = await import('../../src/books/db.js');
      await closePool();
    }
    try {
      for (const name of owned) {
        if (!/^invage_test_[a-f0-9]{32}$/.test(name)) {
          throw new Error('Refusing non-test database cleanup');
        }
        await admin.query(`DROP DATABASE "${name}"`);
      }
    } finally {
      await admin.end();
    }
  }

  try {
    const keyBase64 = randomBytes(32).toString('base64');
    const keyId = 'invage-test';
    const databaseUrl = await createDisposable();
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    try {
      await initializeDatabase(pool, 'personal', createSecretCodec({ keyId, keyBase64 }));
    } finally {
      await pool.end();
    }
    runtime = await openDatabaseRuntime({
      mode: 'personal',
      env: {
        UTARUS_DATABASE_URL: databaseUrl,
        UTARUS_DATABASE_SSL_MODE: 'disable',
        UTARUS_DATABASE_POOL_MAX: '2',
        UTARUS_DATABASE_CONNECT_TIMEOUT_MS: '10000',
        UTARUS_DATABASE_QUERY_TIMEOUT_MS: '30000',
        UTARUS_DATABASE_ENCRYPTION_KEY_ID: keyId,
        UTARUS_DATABASE_ENCRYPTION_KEY: keyBase64,
      },
      onError(error) { throw error; },
    });
    unbind = bindDatabaseRuntime(runtime);
    let booksUrl: string | undefined;
    if (options.books) {
      booksUrl = await createDisposable();
      process.env.INVAGE_BOOKS_DATABASE_URL = booksUrl;
    }
    async function clearUsers() {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        // Fixture reset is confined to this helper's freshly-created disposable DB.
        // Temporarily release the truncate guard, transactionally restoring it.
        await client.query('BEGIN');
        await client.query('ALTER TABLE utarus.usage_events DISABLE TRIGGER immutable_usage_events_truncate');
        await client.query('TRUNCATE utarus.users CASCADE');
        await client.query('ALTER TABLE utarus.usage_events ENABLE TRIGGER immutable_usage_events_truncate');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.end();
      }
    }
    afterAll(cleanup, 30000);
    return { runtime, databaseUrl, booksUrl, clearUsers };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Test database setup and cleanup failed');
    }
    throw error;
  }
}

export async function createInvestorFixture<T extends UserState>(state: T): Promise<void> {
  await createState(state);
}
