import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';

await useTestDatabase({ books: true });
const householdId = randomUUID();
const slug = `portfolio-save-${householdId.slice(0, 8)}`;

describe('portfolio save keeps books current', () => {
  beforeAll(async () => {
    const { migrateBooks } = await import('../src/books/index.js');
    await migrateBooks();
    await createInvestorFixture({
      user: { id: householdId, slug, created_at: '2026-10-01', auth_token: randomUUID() },
      profile: { display_name: 'Portfolio Save', contact_email: 'portfolio-save@test.local' },
      log: [{ ts: '2026-10-01', action: 'created' }],
    });
  });

  it('journals direct position, cash, and deposit changes; records marks as audit events', async () => {
    const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.js');
    const { setPortfolio, setCashes, setDeposits } = await import('../src/state/portfolio-state.js');
    const { withHouseholdTx } = await import('../src/books/db.js');
    const balances = async () => withHouseholdTx(householdId, client => client.query<{
      kind: string; external_key: string; balance_minor: string; quantity: string;
    }>(`SELECT a.kind, a.external_key, b.balance_minor::text, b.quantity::text
       FROM accounts a JOIN account_balances b ON b.account_id = a.id
       WHERE a.household_id = $1::uuid AND a.kind IN ('position','deposit','cash')
         AND (b.balance_minor <> 0 OR b.quantity <> 0) ORDER BY a.kind`, [householdId]));
    const counts = async () => withHouseholdTx(householdId, client => client.query<{
      journals: string; audits: string;
    }>(`SELECT (SELECT count(*)::text FROM journal_entries WHERE household_id=$1::uuid) journals,
              (SELECT count(*)::text FROM audit_events WHERE household_id=$1::uuid
                AND tool_name='portfolio_save' AND journal_entry_id IS NULL) audits`, [householdId]));

    let snapshot = await loadInvestor(slug);
    setPortfolio(snapshot.state, { 'D05@ibkr': {
      units: 10, avg_price: 30, channel: 'ibkr', currency: 'SGD', instrument: 'equity',
    } });
    setCashes(snapshot.state, [{ amount: 1000, currency: 'SGD', channel: 'ibkr', updated_at: '2026-10-06' }]);
    setDeposits(snapshot.state, [{
      id: 'term-1', amount: 500, interest: 5, currency: 'SGD', channel: 'dbs',
      start_date: '2026-10-01', end_date: '2027-10-01', updated_at: '2026-10-06',
    }]);
    await saveInvestor(snapshot);
    expect((await balances()).rows.map(row => [row.kind, row.balance_minor, Number(row.quantity)]))
      .toEqual([['cash', '1000000000', 0], ['deposit', '500000000', 0],
        ['position', '300000000', 10]]);
    expect((await counts()).rows[0]).toEqual({ journals: '3', audits: '1' });

    snapshot = await loadInvestor(slug);
    snapshot.state.portfolio!['D05@ibkr']!.avg_price = 31;
    await saveInvestor(snapshot);
    expect((await balances()).rows.find(row => row.kind === 'position')?.balance_minor).toBe('310000000');
    expect((await counts()).rows[0]).toEqual({ journals: '5', audits: '2' });

    snapshot = await loadInvestor(slug);
    snapshot.state.portfolio!['D05@ibkr']!.category = 'bank';
    await saveInvestor(snapshot);
    expect((await counts()).rows[0]).toEqual({ journals: '5', audits: '3' });

    snapshot = await loadInvestor(slug);
    setPortfolio(snapshot.state, {});
    setDeposits(snapshot.state, []);
    await saveInvestor(snapshot);
    expect((await balances()).rows.map(row => row.kind)).toEqual(['cash']);
    expect((await counts()).rows[0]).toEqual({ journals: '7', audits: '4' });
  });
});
