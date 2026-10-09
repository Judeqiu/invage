/** Read-only application smoke plus optional zero-cost reserve/settle/release probe. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabaseRuntime } from 'utarus/database';
import { SharedAccountClient } from 'utarus/shared-accounts';
const mapPath = process.argv[process.argv.indexOf('--mapping') + 1];
if (!process.argv.includes('--mapping')) throw new Error('Supply --mapping FILE');
const mapping = JSON.parse(readFileSync(mapPath, 'utf8'));
const base = process.env.VELOVEST_SMOKE_ORIGIN;
if (!base) throw new Error('VELOVEST_SMOKE_ORIGIN is required');
const local = process.argv.includes('--local');
if (local && process.argv.includes('--exercise-ledger')) throw new Error('Local smoke cannot exercise the shared ledger');
const client = local ? undefined : new SharedAccountClient({ endpoint: process.env.UTARUS_SHARED_ENDPOINT,
  authorityId: process.env.UTARUS_SHARED_AUTHORITY_ID, agentId: process.env.UTARUS_SHARED_AGENT_ID,
  credential: process.env.UTARUS_SHARED_AGENT_CREDENTIAL });
await client?.ready();
const db = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
let routes = 0, chats = 0, files = 0;
try {
  for (const [alias, userId] of Object.entries(mapping)) {
    const { state } = await db.users.readById(userId);
    const usage = (await db.usage.read(userId)).state;
    if (client) {
    const { accountId } = await client.resolveByUserId(userId);
    await client.checkAccess(accountId);
    const common = await client.readCommonProfile(accountId);
    assert.equal(common.email.toLowerCase(), state.profile.contact_email.toLowerCase());
    assert.equal(common.displayName, state.profile.display_name);
    assert.equal(await client.login(alias, `wrong-${randomUUID()}`), null);
    const allowance = await client.readAllowance(accountId, usage.period);
    assert.equal(allowance.cap, null); assert.equal(allowance.spent, usage.period_credits);
    }
    const headers = { Authorization: `Bearer ${state.user.auth_token}` };
    for (const path of ['/api/files', '/api/chat/conversations', '/api/domain/invage/broker-accounts',
      '/api/domain/invage/portfolio-settings', '/api/domain/invage/trades', '/api/domain/invage/option-history', '/api/domain/invage/book']) {
      const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 200, `${alias}: ${path} returned ${response.status}`);
      const body = await response.json();
      if (path === '/api/files') files += body.files.length;
      if (path === '/api/chat/conversations') {
        chats += body.conversations.length;
        for (const item of body.conversations) {
          const id = item.id ?? item.conversationId;
          if (!id) throw new Error('Missing conversation ID');
          const stored = JSON.parse(readFileSync(join(process.env.UTARUS_DATA_ROOT, 'chats', userId, id + '.json'), 'utf8'));
          assert.equal(stored.userId, userId);
        }
      }
      routes++;
    }
    const other = Object.values(mapping).find(id => id !== userId);
    const denied = await fetch(base + `/api/domain/invage/trades?slug=${other}`, { headers, signal: AbortSignal.timeout(10000) });
    assert.notEqual(denied.status, 200, 'Cross-user data selection must fail');
    if (client && process.argv.includes('--exercise-ledger')) {
      const { accountId } = await client.resolveByUserId(userId);
      const before = await client.readAllowance(accountId, usage.period);
      const reserved = await client.reserve(accountId, usage.period, `smoke:${randomUUID()}`, 1, 60);
      await client.settle(reserved.reservationId, 0); await client.settle(reserved.reservationId, 0);
      const released = await client.reserve(accountId, usage.period, `smoke:${randomUUID()}`, 1, 60);
      await client.release(released.reservationId);
      const after = await client.readAllowance(accountId, usage.period);
      assert.equal(after.spent, before.spent); assert.equal(after.reserved, before.reserved);
    }
  }
  assert.equal((await fetch(base + '/login')).status, 200);
  console.log(JSON.stringify({ status: 'passed', users: Object.keys(mapping).length, routes, chats, files,
    accountsMode: local ? 'local' : 'shared-client', preservedOpeningUsage: !local, crossUserDenied: true }));
} finally { await db.close(); }
