import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from './helpers/database.js';

await useTestDatabase({ books: true });
const alice = randomUUID();
const bob = randomUUID();

describe('Book page reads journal database', () => {
  beforeAll(async () => {
    const { migrateBooks } = await import('../src/books/index.js');
    const { withHouseholdTx } = await import('../src/books/db.js');
    const { postOpeningBalance } = await import('../src/books/ops.js');
    const { postHoldingOpen } = await import('../src/books/position-ops.js');
    await migrateBooks();
    await withHouseholdTx(alice, async client => {
      const ctx = { householdId: alice, slug: 'book-alice', actor: 'book-alice' };
      await postOpeningBalance(client, ctx, {
        amount: 1000, currency: 'USD', channel: 'ibkr', valueDate: '2026-10-01',
        memo: 'IBKR cash from statement', requestId: 'book-a-cash',
      });
      await postHoldingOpen(client, ctx, {
        mapKey: 'D05@ibkr',
        holding: { units: 2, avg_price: 30, currency: 'SGD', channel: 'ibkr' },
        purchaseUnits: 2, purchaseAvg: 30, currency: 'SGD', valueDate: '2026-10-02',
        requestId: 'book-a-position', adjustCash: false,
      });
    });
    await withHouseholdTx(bob, async client => {
      await postOpeningBalance(client,
        { householdId: bob, slug: 'book-bob', actor: 'book-bob' }, {
          amount: 999, currency: 'USD', channel: 'dbs', valueDate: '2026-10-03',
          memo: 'Bob cash from statement', requestId: 'book-b-cash',
        });
    });
  });

  it('shows exact account balances and paginated balanced entries for only this investor', async () => {
    const { loadBookPage } = await import('../src/webapp/book-data.js');
    const first = await loadBookPage(alice, { offset: 0, limit: 1 });
    expect(first.summary.journal_count).toBe(2);
    expect(first.accounts.find(row => row.kind === 'position')?.balance_minor).toBe('60000000');
    expect(first.accounts.find(row => row.kind === 'cash')?.balance_minor).toBe('1000000000');
    expect(first.journal.total).toBe(2);
    expect(first.journal.entries).toHaveLength(1);
    expect(first.journal.entries[0]?.lines).toHaveLength(2);
    expect(first.journal.entries[0]?.lines.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n)).toBe(0n);
    expect(JSON.stringify(first)).not.toContain('book-b-cash');

    const second = await loadBookPage(alice, { offset: 1, limit: 1 });
    expect(second.journal.entries).toHaveLength(1);
    expect(second.journal.entries[0]?.id).not.toBe(first.journal.entries[0]?.id);
  });

  it('filters by journal line channel and currency without mixing tenants', async () => {
    const { loadBookPage } = await import('../src/webapp/book-data.js');
    const sgd = await loadBookPage(alice, { offset: 0, limit: 25, channel: 'ibkr', currency: 'SGD' });
    expect(sgd.journal.total).toBe(1);
    expect(sgd.journal.entries[0]?.entry_type).toBe('trade_import');
    expect(sgd.journal.entries[0]?.lines.map(row => row.currency)).toEqual(['SGD', 'SGD']);
    const none = await loadBookPage(alice, { offset: 0, limit: 25, channel: 'dbs' });
    expect(none.journal.total).toBe(0);
    const unassigned = await loadBookPage(alice, { offset: 0, limit: 25, channel: '' });
    expect(unassigned.journal.total).toBe(0);
    expect(sgd.options.channels).toEqual(['ibkr']);
  });
});
