import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from './helpers/database.js';
import { booksPostOpeningBalance, getPool, migrateBooks } from '../src/books/index.js';
import { loadBooksDataset, booksDatasets } from '../src/data-query/books.js';
import { runQuery } from '../src/data-query/engine.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';

await useTestDatabase({ books: true });
const alice = '11111111-2222-4333-8444-555555555555';
const bob = '22222222-2222-4333-8444-555555555555';
function snapshot(id: string): InvestorSnapshot {
  return { revision: 1, state: { user: { id, created_at: '2026-01-01' }, profile: { display_name: 'Test', contact_email: '' }, log: [] } };
}
async function query(raw: { from: string; [key: string]: unknown }) {
  return runQuery(snapshot(alice), raw, { [raw.from]: await loadBooksDataset(raw.from, alice) });
}
beforeAll(async () => {
  await migrateBooks();
  await booksPostOpeningBalance(snapshot(alice).state, { amount: 12.345678, currency: 'USD', channel: 'ibkr', valueDate: '2026-10-10', memo: 'Alice opening', requestId: 'alice-opening' });
  await booksPostOpeningBalance(snapshot(bob).state, { amount: 500, currency: 'USD', channel: 'ibkr', valueDate: '2026-10-10', memo: 'Bob private', requestId: 'bob-opening' });
});

describe('generic financial accounting queries against PostgreSQL', () => {
  it('reads all accounting tables with explicit household filtering, even for a superuser connection', async () => {
    for (const from of Object.keys(booksDatasets)) {
      const result = await query({ from });
      expect(result.available).toBe(true);
      expect(JSON.stringify(result.rows)).not.toContain(bob);
      expect(JSON.stringify(result.rows)).not.toContain('Bob private');
      expect(result.source_version).toMatch(/^[a-f0-9]{64}$/);
    }
    expect((await query({ from: 'books_journal_entries' })).rows).toHaveLength(1);
    expect((await query({ from: 'books_journal_entries' })).rows[0].value_date).toBe('2026-10-10');
    expect((await query({ from: 'books_journal_lines', group_by: ['currency'], aggregates: [{ op: 'sum', field: 'amount_minor', as: 'balanced' }] })).rows)
      .toEqual([{ currency: 'USD', balanced: '0' }]);
    expect((await query({ from: 'books_account_balances' })).rows).toContainEqual(expect.objectContaining({ balance_minor: '12345678' }));
  });

  it('supports filtered queries across complete journal metadata and refuses stale pages', async () => {
    const raw = { from: 'books_accounts', limit: 1 };
    const first = await query(raw);
    expect(first.next_offset).toBe(1);
    expect((await query({ ...raw, offset: 1, expected_revision: 1, expected_source_version: first.source_version })).rows).toHaveLength(1);
    await getPool().query('UPDATE accounts SET label=$1 WHERE household_id=$2', ['Changed', alice]);
    await expect(query({ ...raw, offset: 1, expected_revision: 1, expected_source_version: first.source_version })).rejects.toThrow(/Source data changed/);
    await expect(loadBooksDataset('books_accounts; DROP TABLE accounts', alice)).rejects.toThrow(/Unknown accounting/);
    expect((await query({ from: 'books_journal_entries', where: { field: 'request_id', op: 'eq', value: 'alice-opening' } })).rows).toHaveLength(1);
  });
});
