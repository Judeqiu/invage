/** Copy the former per-user books database into qiu's immutable org archive. */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg, { type PoolClient } from 'pg';
import { createDatabasePool, readDatabaseConfig } from 'utarus/database';

const TABLES = [
  ['households', 'id', 'id'],
  ['accounts', 'id', 'household_id'],
  ['journal_entries', 'id', 'household_id'],
  ['journal_lines', 'id', 'household_id'],
  ['account_balances', 'account_id', 'household_id'],
  ['deposit_meta', 'account_id', 'household_id'],
  ['position_meta', 'account_id', 'household_id'],
  ['audit_events', 'id', 'household_id'],
] as const;

type TableName = (typeof TABLES)[number][0];
type SourceRecord = { record_id: string; payload: string };
type HouseholdCopy = {
  sourceUserId: string;
  sourceSlug: string;
  rows: Map<TableName, SourceRecord[]>;
  counts: Record<TableName, number>;
  sha256: string;
};

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function readHousehold(source: PoolClient, userId: string, slug: string): Promise<HouseholdCopy> {
  await source.query("SELECT set_config('app.household_id',$1,true)", [userId]);
  const rows = new Map<TableName, SourceRecord[]>();
  const counts = Object.fromEntries(TABLES.map(([table]) => [table, 0])) as Record<TableName, number>;
  const hash = createHash('sha256');
  for (const [table, idColumn, ownerColumn] of TABLES) {
    // Identifiers come only from the static TABLES list above.
    const result = await source.query<SourceRecord>(
      `SELECT t.${idColumn}::text AS record_id,to_jsonb(t)::text AS payload
       FROM public.${table} t WHERE t.${ownerColumn}=$1 ORDER BY t.${idColumn}`,
      [userId],
    );
    rows.set(table, result.rows);
    counts[table] = result.rowCount ?? 0;
    for (const row of result.rows) hash.update(`${table}\0${row.record_id}\0${row.payload}\n`);
  }
  return { sourceUserId: userId, sourceSlug: slug, rows, counts, sha256: hash.digest('hex') };
}

export interface LegacyBooksImportReport {
  orgSlug: string;
  memberCount: number;
  counts: Record<TableName, number>;
  mode: 'dry-run' | 'applied' | 'already-applied';
}

export async function importLegacyBooks(
  orgSlug: string, apply = false, env: NodeJS.ProcessEnv = process.env,
): Promise<LegacyBooksImportReport> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(orgSlug)) throw new Error('Explicit organization slug required');
  if (!env.INVAGE_BOOKS_DATABASE_URL || !env.UTARUS_DATABASE_URL) {
    throw new Error('Both source books and target Utarus database URLs are required');
  }
  const sourceUrl = new URL(env.INVAGE_BOOKS_DATABASE_URL);
  const targetUrl = new URL(env.UTARUS_DATABASE_URL);
  if (sourceUrl.toString() === targetUrl.toString() || sourceUrl.pathname === targetUrl.pathname) {
    throw new Error('Source books and target finance databases must differ');
  }
  const sourcePool = new pg.Pool({ connectionString: env.INVAGE_BOOKS_DATABASE_URL, max: 1 });
  const targetPool = createDatabasePool(readDatabaseConfig(env), error => { throw error; });
  let source: PoolClient | undefined;
  let target: PoolClient | undefined;
  try {
    target = await targetPool.connect();
    const org = await target.query<{ id: string }>('SELECT id FROM utarus.orgs WHERE slug=$1', [orgSlug]);
    if (org.rowCount !== 1) throw new Error('Organization not found');
    const orgId = org.rows[0].id;
    const members = await target.query<{ id: string; slug: string }>(
      `SELECT users.id,users.slug FROM utarus.org_memberships membership
       JOIN utarus.users users ON users.id=membership.user_id
       WHERE membership.org_id=$1 AND users.deleted_at IS NULL ORDER BY users.slug`, [orgId],
    );
    if (!members.rowCount) throw new Error('Organization has no active members');
    const outsiderRows = await target.query<{ id: string; slug: string }>(
      `SELECT users.id,users.slug FROM utarus.users users
       WHERE NOT EXISTS (SELECT 1 FROM utarus.org_memberships membership
         WHERE membership.user_id=users.id AND membership.org_id=$1) ORDER BY users.slug`, [orgId],
    );
    source = await sourcePool.connect();
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const outsider of outsiderRows.rows) {
      const copy = await readHousehold(source, outsider.id, outsider.slug);
      if (TABLES.some(([table]) => table !== 'households' && copy.counts[table] > 0)) {
        throw new Error(`Books ledger outside ${orgSlug} contains financial rows: ${outsider.slug}`);
      }
    }
    const copies: HouseholdCopy[] = [];
    for (const member of members.rows) copies.push(await readHousehold(source, member.id, member.slug));
    const counts = Object.fromEntries(TABLES.map(([table]) => [table,
      copies.reduce((total, copy) => total + copy.counts[table], 0)])) as Record<TableName, number>;
    const report = { orgSlug, memberCount: members.rows.length, counts };
    if (!apply) return { ...report, mode: 'dry-run' };
    await target.query('BEGIN');
    await target.query('SELECT id FROM utarus.orgs WHERE id=$1 FOR SHARE', [orgId]);
    await target.query("SELECT set_config('app.finance_org_id',$1,true)", [orgId]);
    const finance = await target.query('SELECT org_id FROM finance.organizations WHERE org_id=$1', [orgId]);
    if (!finance.rowCount) throw new Error('Organization finance schema and personal import must run first');
    let inserted = 0;
    for (const copy of copies) {
      const prior = await target.query<{ source_sha256: string }>(
        `SELECT source_sha256 FROM finance.legacy_books_imports
         WHERE org_id=$1 AND source_household_id=$2 FOR UPDATE`, [orgId, copy.sourceUserId],
      );
      if (prior.rowCount) {
        if (prior.rows[0].source_sha256 !== copy.sha256) {
          throw new Error(`Previously imported books rows changed for ${copy.sourceSlug}`);
        }
        continue;
      }
      for (const [table] of TABLES) {
        for (const row of copy.rows.get(table) ?? []) {
          await target.query(
            `INSERT INTO finance.legacy_books_records
             (org_id,source_household_id,record_type,record_id,payload,source_sha256)
             VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
            [orgId, copy.sourceUserId, table, row.record_id, row.payload, digest(row.payload)],
          );
          inserted += 1;
        }
      }
      await target.query(
        `INSERT INTO finance.legacy_books_imports
         (org_id,source_household_id,source_sha256,counts) VALUES($1,$2,$3,$4)`,
        [orgId, copy.sourceUserId, copy.sha256, copy.counts],
      );
    }
    for (const [table] of TABLES) {
      const actual = await target.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM finance.legacy_books_records
         WHERE org_id=$1 AND record_type=$2`, [orgId, table],
      );
      if (Number(actual.rows[0].n) !== counts[table]) {
        throw new Error(`Books row count mismatch for ${table}`);
      }
    }
    await target.query('COMMIT');
    return { ...report, mode: inserted ? 'applied' : 'already-applied' };
  } catch (error) {
    if (target) await target.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    if (source) { await source.query('ROLLBACK').catch(() => undefined); source.release(); }
    target?.release();
    await Promise.allSettled([sourcePool.end(), targetPool.end()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [slug, mode] = process.argv.slice(2);
  if (mode !== undefined && mode !== '--apply') throw new Error('Only --apply is accepted after the organization slug');
  importLegacyBooks(slug ?? '', mode === '--apply').then(report => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
