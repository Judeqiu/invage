/** Archive every existing broker source file for the selected finance org. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabasePool, createSecretCodec, readDatabaseConfig } from 'utarus/database';
import { withFinanceScope } from './repository.js';
import { readBrokerSource, scanBrokerSources, syncUserSourceFiles } from './source-files.js';

export async function importBrokerSourceFiles(
  orgSlug: string, apply = false, env: NodeJS.ProcessEnv = process.env,
): Promise<{ orgSlug: string; files: number; bytes: number; mode: 'dry-run' | 'applied' | 'already-applied' }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(orgSlug)) throw new Error('Explicit organization slug required');
  const pool = createDatabasePool(readDatabaseConfig(env), error => { throw error; });
  try {
    const org = await pool.query<{ id: string }>('SELECT id FROM utarus.orgs WHERE slug=$1', [orgSlug]);
    if (org.rowCount !== 1) throw new Error('Organization not found');
    const orgId = org.rows[0].id;
    const members = await pool.query<{ id: string; slug: string; role: string }>(
      `SELECT users.id,users.slug,membership.role FROM utarus.org_memberships membership
       JOIN utarus.users users ON users.id=membership.user_id
       WHERE membership.org_id=$1 AND users.deleted_at IS NULL ORDER BY users.slug`, [orgId],
    );
    const admin = members.rows.find(member => member.role === 'admin');
    if (!admin) throw new Error('Organization admin required');
    const outsiders = await pool.query<{ slug: string }>(
      `SELECT users.slug FROM utarus.users users WHERE users.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM utarus.org_memberships membership
         WHERE membership.user_id=users.id AND membership.org_id=$1)`, [orgId],
    );
    for (const outsider of outsiders.rows) {
      if (scanBrokerSources(outsider.slug).length) {
        throw new Error(`Broker source files outside ${orgSlug}: ${outsider.slug}`);
      }
    }
    let files = 0;
    let bytes = 0;
    for (const member of members.rows) {
      for (const file of scanBrokerSources(member.slug)) {
        const read = readBrokerSource(member.slug, file);
        files += 1;
        bytes += read.bytes.length;
      }
    }
    if (!apply) return { orgSlug, files, bytes, mode: 'dry-run' };
    const codec = createSecretCodec({
      keyId: env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
      keyBase64: env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '',
    });
    const inserted = await withFinanceScope(pool, admin.id, orgId, 'manage', async ({ client }) => {
      const migrations = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM finance.legacy_migrations WHERE org_id=$1', [orgId],
      );
      if (Number(migrations.rows[0].n) !== members.rowCount) {
        throw new Error('Personal finance import must cover every active member first');
      }
      let added = 0;
      for (const member of members.rows) {
        const result = await syncUserSourceFiles(client, orgId, member.id, member.slug, codec);
        added += result.inserted;
      }
      return added;
    });
    return { orgSlug, files, bytes, mode: inserted ? 'applied' : 'already-applied' };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [orgSlug, option] = process.argv.slice(2);
  importBrokerSourceFiles(orgSlug, option === '--apply').then(report => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
