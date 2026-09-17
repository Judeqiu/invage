import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importInvitesInTransaction } from '../../scripts/migration/legacy-invites.mjs';

const codec = { blindIndex: () => 'digest', encrypt: () => 'encrypted' };
const slackInvite = {
  code: 'INV-TEST1234', created_by: 0, created_by_slack: 'UCREATOR',
  created_at: '2026-07-01', used_by_slack: 'URECIPIENT',
  used_at: '2026-07-02', slug: 'existing-user',
};

test('beta42 Slack redemption keeps absent Telegram identity as SQL NULL', async () => {
  let inserted;
  const client = { async query(sql, values) {
    if (sql.startsWith('SELECT')) return { rowCount: 1, rows: [{ id: 'stable-user-id' }] };
    inserted = values;
    return { rowCount: 1, rows: [] };
  } };
  const original = structuredClone(slackInvite);
  await importInvitesInTransaction(client, codec, [slackInvite]);
  assert.equal(inserted[7], null);
  assert.equal(inserted[8], 'URECIPIENT');
  assert.equal(inserted[10], 'stable-user-id');
  assert.deepEqual(slackInvite, original);
});

test('used invitation without recipient or mapped owner fails', async () => {
  const client = { async query() { return { rowCount: 0, rows: [] }; } };
  const { used_by_slack, ...withoutRecipient } = slackInvite;
  await assert.rejects(importInvitesInTransaction(client, codec, [withoutRecipient]), /Historical invitation import failed/);
  await assert.rejects(importInvitesInTransaction(client, codec, [slackInvite]), /Historical invitation import failed/);
});
