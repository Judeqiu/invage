/** One-time, guarded conversion of the existing WalletStreet personal database. */
import { randomUUID } from 'node:crypto';
import { createDatabasePool, readDatabaseConfig, createSecretCodec, assertDatabaseReady, withTransaction, openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

const expected = ['admin-slack-u0bgs6lc5c2', 'cy', 'david', 'marina'];
const admin = 'admin-slack-u0bgs6lc5c2';
const apply = process.argv.length === 3 && process.argv[2] === '--apply';
if (!apply && process.argv.length !== 2) throw new Error('Usage: node --env-file=.env scripts/migration/enable-qiu-org.mjs [--apply]');
if (!process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID || !process.env.UTARUS_DATABASE_ENCRYPTION_KEY) throw new Error('Database encryption key is required');
const codec = createSecretCodec({ keyId: process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID, keyBase64: process.env.UTARUS_DATABASE_ENCRYPTION_KEY });
const pool = createDatabasePool(readDatabaseConfig(process.env), error => { throw error; });
let orgId;
try {
  const metadata = await pool.query('SELECT mode FROM utarus.runtime_metadata WHERE singleton=true');
  if (metadata.rowCount !== 1 || !['personal', 'org'].includes(metadata.rows[0].mode)) throw new Error('Unexpected runtime metadata');
  await assertDatabaseReady(pool, metadata.rows[0].mode, codec);
  const inventory = await pool.query('SELECT id,slug FROM utarus.users WHERE deleted_at IS NULL ORDER BY slug');
  if (JSON.stringify(inventory.rows.map(row => row.slug)) !== JSON.stringify(expected)) throw new Error('Active user inventory differs from reviewed migration set');
  const orgs = await pool.query('SELECT id,slug FROM utarus.orgs');
  const members = await pool.query('SELECT user_id,org_id,role FROM utarus.org_memberships');
  if (metadata.rows[0].mode === 'org') {
    const expectedRoles = new Map(inventory.rows.map(user => [user.id, user.slug === admin ? 'admin' : 'member']));
    if (orgs.rowCount !== 1 || orgs.rows[0].slug !== 'qiu' || members.rowCount !== expected.length ||
        members.rows.some(row => row.org_id !== orgs.rows[0].id || expectedRoles.get(row.user_id) !== row.role)) {
      throw new Error('Existing org state differs from the requested qiu migration');
    }
    orgId = orgs.rows[0].id;
  } else {
    if (orgs.rowCount !== 0 || members.rowCount !== 0) throw new Error('Personal database already has organization data');
    if (!apply) {
      console.log(JSON.stringify({ ready: true, action: 'convert-personal-to-org', organization: 'qiu', users: expected, admin }));
    } else {
      orgId = randomUUID();
      await withTransaction(pool, async client => {
        await client.query('LOCK TABLE utarus.runtime_metadata, utarus.users, utarus.orgs, utarus.org_memberships IN SHARE ROW EXCLUSIVE MODE');
        const current = await client.query('SELECT mode FROM utarus.runtime_metadata WHERE singleton=true FOR UPDATE');
        const users = await client.query('SELECT id,slug FROM utarus.users WHERE deleted_at IS NULL ORDER BY slug FOR UPDATE');
        if (current.rows[0]?.mode !== 'personal' || JSON.stringify(users.rows.map(row => row.slug)) !== JSON.stringify(expected)) throw new Error('Database changed since preflight');
        if ((await client.query('SELECT 1 FROM utarus.orgs LIMIT 1')).rowCount || (await client.query('SELECT 1 FROM utarus.org_memberships LIMIT 1')).rowCount) throw new Error('Organization state changed since preflight');
        await client.query("UPDATE utarus.runtime_metadata SET mode='org' WHERE singleton=true");
        await client.query('INSERT INTO utarus.orgs(id,slug,display_name,created_at,created_by) VALUES($1,$2,$3,now(),$4)', [orgId, 'qiu', 'qiu', 'WalletStreet migration']);
        for (const user of users.rows) {
          const role = user.slug === admin ? 'admin' : 'member';
          await client.query('INSERT INTO utarus.org_memberships(org_id,user_id,role,joined_at) VALUES($1,$2,$3,now())', [orgId, user.id, role]);
          await client.query('UPDATE utarus.users SET revision=revision+1 WHERE id=$1', [user.id]);
          await client.query('UPDATE utarus.user_profiles SET revision=revision+1 WHERE user_id=$1', [user.id]);
          await client.query('UPDATE utarus.user_extension_state SET revision=revision+1 WHERE user_id=$1', [user.id]);
          await client.query(`INSERT INTO utarus.user_state_log(user_id,sequence,entry)
            SELECT $1,COALESCE(MAX(sequence)+1,0),$2::jsonb FROM utarus.user_state_log WHERE user_id=$1`,
            [user.id, JSON.stringify({ ts: new Date().toISOString().slice(0, 10), action: 'org_joined', actor: 'WalletStreet migration', org_id: orgId, role })]);
        }
      });
      await assertDatabaseReady(pool, 'org', codec);
    }
  }
} finally { await pool.end(); }

if (apply) {
  const runtime = await openDatabaseRuntime({ env: process.env, mode: 'org', onError: error => { throw error; } });
  const release = bindDatabaseRuntime(runtime);
  try {
    const { ensureOrgDefaultChannel } = await import('../../node_modules/utarus/dist/webapp/chat/org-chat.js');
    const channel = await ensureOrgDefaultChannel(orgId);
    console.log(JSON.stringify({ status: 'succeeded', organization: 'qiu', orgId, members: expected.length, admin, defaultRoom: channel.id }));
  } finally { release(); await runtime.close(); }
}
