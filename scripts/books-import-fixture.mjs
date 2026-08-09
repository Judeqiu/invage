/**
 * Import multi-currency fixture (+ optional jude.yaml) into invage_books for local smoke.
 *
 * Usage:
 *   INVAGE_BOOKS_DATABASE_URL=postgresql://… npx tsx scripts/books-import-fixture.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const url = process.env.INVAGE_BOOKS_DATABASE_URL;
if (!url) {
  console.error('INVAGE_BOOKS_DATABASE_URL required');
  process.exit(1);
}

const dataRoot = join(tmpdir(), `invage-books-import-${Date.now()}`);
mkdirSync(join(dataRoot, 'users'), { recursive: true });
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const householdId = '0fa1b1df-bfb4-4e53-aa96-e16602bd5d2a';
const fixture = {
  user: {
    id: householdId,
    slug: 'jude-fixture',
    created_at: '2026-06-27',
    telegram_user_ids: [7873786773],
    auth_token: randomUUID(),
  },
  profile: { display_name: 'Jude Fixture', contact_email: 'fixture@example.com' },
  log: [{ ts: '2026-06-27', action: 'created' }],
  cash: [
    { amount: 30515.65, currency: 'SGD', updated_at: '2026-08-08', channel: 'dbs' },
    { amount: 10000.0, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
    { amount: 395633.73, currency: 'USD', updated_at: '2026-08-08', channel: 'ibkr' },
  ],
  deposits: [
    {
      id: 'fd-dbs-20260101',
      channel: 'dbs',
      amount: 50000,
      interest: 875,
      currency: 'USD',
      start_date: '2026-01-01',
      end_date: '2026-07-01',
      label: '6M TD',
      updated_at: '2026-08-08',
    },
  ],
  portfolio: {
    'AAPL@ibkr': {
      avg_price: 200,
      units: 50,
      category: 'SL Technology S1',
      channel: 'ibkr',
    },
    'SPY@ibkr': {
      instrument: 'fund',
      avg_price: 480,
      units: 20,
      channel: 'ibkr',
      fund: { quote_source: 'yahoo' },
    },
  },
};

writeFileSync(join(dataRoot, 'users', 'jude-fixture.yaml'), JSON.stringify(fixture)); // wrong format

// write YAML properly
import { stringify } from 'yaml';
writeFileSync(join(dataRoot, 'users', 'jude-fixture.yaml'), stringify(fixture), 'utf-8');

const { migrateBooks, booksImportState, closePool, withHouseholdTx, rebuildCashFromJournal, listCashBalances } =
  await import('../src/books/index.ts');
const { loadState } = await import('utarus');

await migrateBooks();

// wipe prior journals for this household if re-run
const { getPool } = await import('../src/books/db.ts');
const pool = getPool();
await pool.query('DELETE FROM audit_events WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM journal_lines WHERE household_id = $1::uuid', [householdId]);
// journal_entries has append-only trigger — need to disable for test wipe
await pool.query('ALTER TABLE journal_entries DISABLE TRIGGER journal_entries_no_update');
await pool.query('ALTER TABLE journal_lines DISABLE TRIGGER journal_lines_no_update');
await pool.query('DELETE FROM journal_entries WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM deposit_meta WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM position_meta WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM account_balances WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM accounts WHERE household_id = $1::uuid', [householdId]);
await pool.query('DELETE FROM households WHERE id = $1::uuid', [householdId]);
await pool.query('ALTER TABLE journal_entries ENABLE TRIGGER journal_entries_no_update');
await pool.query('ALTER TABLE journal_lines ENABLE TRIGGER journal_lines_no_update');

const state = loadState('jude-fixture');
const result = await booksImportState(state, { force: true });
console.log('import result', result);

const cashes = await withHouseholdTx(householdId, async (client) => {
  const rebuilt = await rebuildCashFromJournal(client, householdId);
  const proj = await listCashBalances(client, householdId);
  return { rebuilt: Object.fromEntries([...rebuilt].map(([k, v]) => [k, Number(v) / 1e6])), proj };
});
console.log('cash projections', cashes);
await closePool();
console.log('ok');
