import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabasePool, readDatabaseConfig } from 'utarus/database';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = [join(here, 'schema.sql'), join(here, '../../src/finance/schema.sql')]
  .find(path => existsSync(path));
const sourceFilesPath = [join(here, 'source-files.sql'), join(here, '../../src/finance/source-files.sql')]
  .find(path => existsSync(path));

export async function migrateOrgFinance(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!schemaPath || !sourceFilesPath) throw new Error('Finance migration SQL is unavailable');
  const pool = createDatabasePool(readDatabaseConfig(env), error => { throw error; });
  const sql = readFileSync(schemaPath, 'utf8');
  const sha256 = createHash('sha256').update(sql).digest('hex');
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const mode = await client.query<{ mode: string }>(
      'SELECT mode FROM utarus.runtime_metadata WHERE singleton=true',
    );
    if (mode.rows[0]?.mode !== 'org') throw new Error('Organization-mode Utarus database required');
    await client.query('CREATE SCHEMA IF NOT EXISTS finance');
    await client.query(`CREATE TABLE IF NOT EXISTS finance.schema_migrations (
      version integer PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const prior = await client.query<{ sha256: string }>(
      'SELECT sha256 FROM finance.schema_migrations WHERE version=1 FOR UPDATE',
    );
    if (prior.rows[0] && prior.rows[0].sha256 !== sha256) {
      throw new Error('Finance schema version 1 checksum differs from applied version');
    }
    if (!prior.rows[0]) {
      const existing = await client.query(
        `SELECT 1 FROM pg_tables WHERE schemaname='finance' AND tablename <> 'schema_migrations' LIMIT 1`,
      );
      if (existing.rowCount) throw new Error('Untracked finance schema exists; refusing migration');
      await client.query(sql);
      await client.query('INSERT INTO finance.schema_migrations(version,sha256) VALUES(1,$1)', [sha256]);
    }
    const sourceSql = readFileSync(sourceFilesPath, 'utf8');
    const sourceSha256 = createHash('sha256').update(sourceSql).digest('hex');
    const sourcePrior = await client.query<{ sha256: string }>(
      'SELECT sha256 FROM finance.schema_migrations WHERE version=2 FOR UPDATE',
    );
    if (sourcePrior.rows[0] && sourcePrior.rows[0].sha256 !== sourceSha256) {
      throw new Error('Finance schema version 2 checksum differs from applied version');
    }
    if (!sourcePrior.rows[0]) {
      const existingSourceFiles = await client.query(
        "SELECT 1 FROM pg_tables WHERE schemaname='finance' AND tablename='source_files'",
      );
      if (existingSourceFiles.rowCount) throw new Error('Untracked finance source files table exists');
      await client.query(sourceSql);
      await client.query('INSERT INTO finance.schema_migrations(version,sha256) VALUES(2,$1)', [sourceSha256]);
    }
    const appRole = env.WALLETSTREET_FINANCE_APP_ROLE;
    if (appRole) {
      if (!/^[a-z_][a-z0-9_]*$/.test(appRole)) throw new Error('Invalid finance app role');
      await client.query(`GRANT USAGE ON SCHEMA finance TO "${appRole}"`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finance TO "${appRole}"`);
      await client.query(`REVOKE ALL ON TABLE finance.schema_migrations FROM "${appRole}"`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrateOrgFinance().then(() => {
    process.stdout.write('Organization finance schema ready\n');
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
