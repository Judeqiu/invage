/** Offline, explicit UUID enrollment. Run dry-run first with both private env files. */
import pg from 'pg';
import { openDatabaseRuntime } from 'utarus/database';
import { SharedAccountStore } from '../../node_modules/utarus/dist/accounts/shared-store.js';
import { readFileSync } from 'node:fs';
const mappingPath = process.argv[process.argv.indexOf('--mapping') + 1];
const apply = process.argv.includes('--apply');
if (!process.argv.includes('--mapping') || !mappingPath || !process.env.UTARUS_SHARED_DATABASE_URL ||
    !process.env.UTARUS_SHARED_AUTHORITY_ID || !process.env.UTARUS_SHARED_AGENT_ID) {
  throw new Error('Supply --mapping FILE and the agent/authority private environment');
}
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
const source = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
const pool = new pg.Pool({ connectionString: process.env.UTARUS_SHARED_DATABASE_URL });
const agentId = process.env.UTARUS_SHARED_AGENT_ID;
try {
  const store = new SharedAccountStore(pool, process.env.UTARUS_SHARED_AUTHORITY_ID, null);
  const plans = [];
  for (const [alias, userId] of Object.entries(mapping)) {
    const { state } = await source.users.readById(userId);
    if ((await source.users.findByLegacyAlias(alias))?.state.user.id !== userId || state.user.deleted_at !== undefined) throw new Error(`Mapping conflict for ${alias}`);
    if (!state.user.password_hash || !state.profile.contact_email) throw new Error(`Missing credentials for ${alias}`);
    if (await source.billing.read(userId)) throw new Error(`Billing ownership needs review for ${alias}`);
    const usage = (await source.usage.read(userId)).state;
    const email = state.profile.contact_email.toLowerCase();
    const existing = await pool.query('SELECT account_id,password_hash FROM shared_accounts WHERE email_normalized=$1', [email]);
    if (existing.rows.length && existing.rows[0].password_hash !== state.user.password_hash) throw new Error(`Credential conflict for ${alias}`);
    const links = await pool.query('SELECT account_id FROM shared_enrollments WHERE agent_id=$1 AND local_user_id=$2', [agentId, userId]);
    if (links.rows.length && links.rows[0].account_id !== existing.rows[0]?.account_id) throw new Error(`Enrollment conflict for ${alias}`);
    plans.push({ alias, userId, state, usage, existing: existing.rows[0], enrolled: links.rows.length > 0 });
  }
  for (const plan of plans) {
    const { alias, userId, state, usage, existing, enrolled } = plan;
    console.log(JSON.stringify({ alias, userId, period: usage.period, openingCredits: usage.period_credits, enrolled, apply }));
    if (!apply) continue;
    const accountId = existing?.account_id ?? await store.createAccount({ email: state.profile.contact_email, username: alias,
      passwordHash: state.user.password_hash, displayName: state.profile.display_name,
      language: state.profile.language, location: state.profile.location, emailVerified: true });
    if (!enrolled) await store.enrollWithCode({ agentId, code: await store.issueLinkCode(accountId, agentId), localUserId: userId });
    const profile = await pool.query('SELECT revision FROM shared_profiles WHERE account_id=$1 AND namespace=$2', [accountId, agentId]);
    if (!profile.rows.length) {
      const { display_name, contact_email, language, location, ...value } = state.profile;
      await store.writeProfile({ agentId, accountId, namespace: agentId, value, schemaVersion: 1, expectedRevision: null });
    }
    // Billing is disabled at this deployment; preserve unlimited local access and historical usage.
    await store.setAllowance(accountId, usage.period, null);
    if (usage.period_credits > 0) await store.applyAdjustment({ adjustmentId: `migration:${agentId}:${userId}:${usage.period}`,
      accountId, period: usage.period, deltaSpent: usage.period_credits, actor: 'velovest-v4.0.2-migration', reason: 'Reviewed local opening usage' });
    const allowance = await store.readAllowance(agentId, accountId, usage.period);
    if (allowance.cap !== null || allowance.spent !== usage.period_credits) throw new Error(`Opening usage mismatch for ${alias}`);
    const current = new Date().toISOString().slice(0, 7);
    if (usage.period !== current) await store.setAllowance(accountId, current, null);
  }
} finally { await Promise.all([source.close(), pool.end()]); }
