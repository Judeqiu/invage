/**
 * Books of record integration tests against local Postgres.
 * Requires: Postgres running + INVAGE_BOOKS_DATABASE_URL (set below if unset).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';
import { randomUUID } from 'crypto';

const dataRoot = join(tmpdir(), `invage-books-test-${process.pid}`);
mkdirSync(join(dataRoot, 'users'), { recursive: true });
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;
// Non-superuser so FORCE RLS applies (superuser always bypasses RLS).
process.env.INVAGE_BOOKS_DATABASE_URL =
  process.env.INVAGE_BOOKS_DATABASE_URL ??
  'postgresql://invage_app:invage_dev_only@localhost:5432/invage_books';

const {
  migrateBooks,
  closePool,
  getPool,
  withHouseholdTx,
  booksPostOpeningBalance,
  booksPostAdjustment,
  booksTransferCash,
  booksAddDeposit,
  booksMatureDeposit,
  booksImportState,
  booksListJournals,
  booksPostHoldingOpen,
  rebuildCashFromJournal,
  listCashBalances,
  listDeposits,
  postEntry,
  ensureAccount,
  ensureHousehold,
  ensureImportEquity,
  toMinor,
  fromMinor,
} = await import('../src/books/index.js').then(async (books) => {
  const accounts = await import('../src/books/accounts.js');
  return { ...books, ...accounts };
});

const { loadState, saveState } = await import('utarus');
const { getCashes, getDeposits, setCash, setCashes, setPortfolio } = await import(
  '../src/state/portfolio-state.js'
);

const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SLUG = 'books-test';

/** Admin wipe (superuser) — invage_app cannot skip append-only triggers. */
async function wipeHousehold(id: string): Promise<void> {
  const pg = await import('pg');
  const admin = new pg.default.Client({
    connectionString:
      process.env.INVAGE_BOOKS_ADMIN_URL ??
      'postgresql://zhengqingqiu@localhost:5432/invage_books',
  });
  await admin.connect();
  try {
    // Avoid ALTER TRIGGER race with parallel suites; replica role skips user triggers.
    await admin.query('BEGIN');
    await admin.query(`SELECT set_config('session_replication_role', 'replica', true)`);
    await admin.query('DELETE FROM audit_events WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM journal_lines WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM journal_entries WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM deposit_meta WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM position_meta WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM account_balances WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM accounts WHERE household_id = $1::uuid', [id]);
    await admin.query('DELETE FROM households WHERE id = $1::uuid', [id]);
    await admin.query('COMMIT');
  } catch (e) {
    try {
      await admin.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await admin.end();
  }
}

function writeUserYaml(): void {
  writeFileSync(
    join(dataRoot, 'users', `${SLUG}.yaml`),
    stringify({
      user: {
        id: HOUSEHOLD_ID,
        slug: SLUG,
        created_at: '2026-08-01',
        telegram_user_ids: [424242],
        auth_token: randomUUID(),
      },
      profile: { display_name: 'Books Test', contact_email: 'books@test.local' },
      log: [{ ts: '2026-08-01', action: 'created' }],
    }),
    'utf-8',
  );
}

describe('books ledger', () => {
  beforeAll(async () => {
    writeUserYaml();
    // Schema/role grants as superuser
    const prev = process.env.INVAGE_BOOKS_DATABASE_URL;
    process.env.INVAGE_BOOKS_DATABASE_URL =
      process.env.INVAGE_BOOKS_ADMIN_URL ??
      'postgresql://zhengqingqiu@localhost:5432/invage_books';
    await closePool();
    await migrateBooks();
    await closePool();
    process.env.INVAGE_BOOKS_DATABASE_URL = prev;
    await closePool();
  });

  beforeEach(async () => {
    await wipeHousehold(HOUSEHOLD_ID);
    writeUserYaml();
  });

  afterAll(async () => {
    await wipeHousehold(HOUSEHOLD_ID).catch(() => undefined);
    await closePool();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('set_cash + transfer conserves currency and rebuilds from journal', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;

    await booksPostOpeningBalance(state, {
      amount: 10000,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 't-set-dbs',
    });
    await booksPostOpeningBalance(state, {
      amount: 5000,
      currency: 'SGD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 't-set-dbs-sgd',
    });
    await booksPostOpeningBalance(state, {
      amount: 1000,
      currency: 'USD',
      channel: 'ibkr',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 't-set-ibkr',
    });

    await booksTransferCash(state, {
      fromChannel: 'dbs',
      toChannel: 'ibkr',
      amount: 2500,
      currency: 'USD',
      valueDate: '2026-08-09',
      requestId: 't-xfer',
    });

    saveState(state);
    const cashes = getCashes(state);
    const dbsUsd = cashes.find((c) => c.channel === 'dbs' && c.currency === 'USD');
    const ibkrUsd = cashes.find((c) => c.channel === 'ibkr' && c.currency === 'USD');
    const dbsSgd = cashes.find((c) => c.channel === 'dbs' && c.currency === 'SGD');
    expect(dbsUsd?.amount).toBe(7500);
    expect(ibkrUsd?.amount).toBe(3500);
    expect(dbsSgd?.amount).toBe(5000);

    const totalUsd = cashes
      .filter((c) => c.currency === 'USD')
      .reduce((s, c) => s + c.amount, 0);
    expect(totalUsd).toBe(11000);

    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      const rebuilt = await rebuildCashFromJournal(client, HOUSEHOLD_ID);
      expect(fromMinor(rebuilt.get('dbs@USD') ?? 0n)).toBe(7500);
      expect(fromMinor(rebuilt.get('ibkr@USD') ?? 0n)).toBe(3500);
      expect(fromMinor(rebuilt.get('dbs@SGD') ?? 0n)).toBe(5000);

      const proj = await listCashBalances(client, HOUSEHOLD_ID);
      for (const p of proj) {
        const key = `${p.channel ?? ''}@${p.currency}`;
        const ch = p.channel ?? '';
        expect(fromMinor(rebuilt.get(`${ch}@${p.currency}`) ?? 0n)).toBe(p.amount);
      }
    });
  });

  it('rejects unbalanced post and insufficient cash transfer', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 100,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 't-small',
    });

    await expect(
      booksTransferCash(state, {
        fromChannel: 'dbs',
        toChannel: 'ibkr',
        amount: 500,
        currency: 'USD',
        valueDate: '2026-08-09',
        requestId: 't-fail-xfer',
      }),
    ).rejects.toThrow(/Insufficient cash|negative/i);

    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      await ensureHousehold(client, HOUSEHOLD_ID, SLUG);
      const a = await ensureAccount(client, {
        householdId: HOUSEHOLD_ID,
        kind: 'cash',
        currency: 'USD',
        channel: 'x',
      });
      const b = await ensureImportEquity(client, HOUSEHOLD_ID, 'USD');
      await expect(
        postEntry(client, {
          householdId: HOUSEHOLD_ID,
          valueDate: '2026-08-09',
          entryType: 'bad',
          createdBy: SLUG,
          requestId: 'unbalanced-1',
          lines: [
            { accountId: a.id, amountMinor: toMinor(10), currency: 'USD' },
            { accountId: b.id, amountMinor: toMinor(1), currency: 'USD' },
          ],
        }),
      ).rejects.toThrow(/unbalanced/i);
    });
  });

  it('append-only: UPDATE journal_entries fails', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 1,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 't-append',
    });
    // Must SET app.household_id so RLS returns rows and the append-only trigger fires.
    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      await expect(
        client.query(
          `UPDATE journal_entries SET memo = 'hacked' WHERE household_id = $1::uuid`,
          [HOUSEHOLD_ID],
        ),
      ).rejects.toThrow(/append-only/i);
    });
  });

  it('idempotent request_id does not double-post', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 2000,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 'open-1',
    });
    await booksPostAdjustment(state, {
      amount: 100,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'idempotent interest',
      contra: 'income',
      requestId: 'idem-1',
    });
    await booksPostAdjustment(state, {
      amount: 100,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'idempotent interest',
      contra: 'income',
      requestId: 'idem-1',
    });
    const cashes = getCashes(state);
    expect(cashes.find((c) => c.channel === 'dbs')?.amount).toBe(2100);
    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      const n = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM journal_entries
         WHERE household_id = $1::uuid AND request_id = 'idem-1'`,
        [HOUSEHOLD_ID],
      );
      expect(Number(n.rows[0]!.c)).toBe(1);
    });
  });

  it('deposit open + mature_deposit double-entry (incident-class path)', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 60000,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 'dep-cash',
    });
    await booksAddDeposit(state, {
      id: 'fd-dbs-test',
      amount: 10000,
      interest: 100,
      currency: 'USD',
      channel: 'dbs',
      startDate: '2026-01-01',
      endDate: '2026-07-01',
      valueDate: '2026-08-09',
      adjustCash: true,
      requestId: 'dep-open',
    });
    expect(getCashes(state).find((c) => c.channel === 'dbs')?.amount).toBe(50000);
    expect(getDeposits(state).find((d) => d.id === 'fd-dbs-test')?.amount).toBe(10000);

    await booksMatureDeposit(state, {
      id: 'fd-dbs-test',
      valueDate: '2026-08-09',
      adjustCash: true,
      requestId: 'dep-mat',
    });
    expect(getCashes(state).find((c) => c.channel === 'dbs')?.amount).toBe(60000);
    expect(getDeposits(state).find((d) => d.id === 'fd-dbs-test')).toBeUndefined();

    // transfer matured funds to broker without inventing money
    await booksTransferCash(state, {
      fromChannel: 'dbs',
      toChannel: 'ibkr',
      amount: 10000,
      currency: 'USD',
      valueDate: '2026-08-09',
      requestId: 'dep-wire',
    });
    const cashes = getCashes(state);
    expect(cashes.find((c) => c.channel === 'dbs')?.amount).toBe(50000);
    expect(cashes.find((c) => c.channel === 'ibkr')?.amount).toBe(10000);
    const usdTotal = cashes
      .filter((c) => c.currency === 'USD')
      .reduce((s, c) => s + c.amount, 0);
    expect(usdTotal).toBe(60000);
  });

  it('imports multi-currency fixture losslessly', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    setCashes(state, [
      { amount: 30515.65, currency: 'SGD', updated_at: '2026-08-08', channel: 'dbs' },
      { amount: 10000, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
      { amount: 395633.73, currency: 'USD', updated_at: '2026-08-08', channel: 'ibkr' },
    ]);
    state.deposits = [
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
    ];
    setPortfolio(state, {
      'AAPL@ibkr': {
        avg_price: 200,
        units: 50,
        category: 'SL Technology S1',
        channel: 'ibkr',
      },
    });
    saveState(state);

    const result = await booksImportState(state, { force: true });
    expect(result.cashSlots).toBe(3);
    expect(result.deposits).toBe(1);
    expect(result.positions).toBe(1);

    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      const cashes = await listCashBalances(client, HOUSEHOLD_ID);
      expect(cashes).toHaveLength(3);
      expect(cashes.find((c) => c.channel === 'dbs' && c.currency === 'SGD')?.amount).toBe(
        30515.65,
      );
      expect(cashes.find((c) => c.channel === 'ibkr' && c.currency === 'USD')?.amount).toBe(
        395633.73,
      );
      const deps = await listDeposits(client, HOUSEHOLD_ID);
      expect(deps).toHaveLength(1);
      expect(deps[0]!.amount).toBe(50000);

      const rebuilt = await rebuildCashFromJournal(client, HOUSEHOLD_ID);
      for (const c of cashes) {
        const ch = c.channel ?? '';
        expect(fromMinor(rebuilt.get(`${ch}@${c.currency}`) ?? 0n)).toBe(c.amount);
      }
    });

    const journals = await booksListJournals(state, 50);
    expect(journals.length).toBeGreaterThanOrEqual(4);
  });

  it('holding open debits cash and stays balanced', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 20000,
      currency: 'USD',
      channel: 'ibkr',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 'h-cash',
    });
    await booksPostHoldingOpen(state, {
      mapKey: 'AAPL@ibkr',
      holding: {
        avg_price: 200,
        units: 10,
        channel: 'ibkr',
      },
      purchaseUnits: 10,
      purchaseAvg: 200,
      valueDate: '2026-08-09',
      adjustCash: true,
      requestId: 'h-buy',
    });
    expect(getCashes(state).find((c) => c.channel === 'ibkr')?.amount).toBe(18000);
    await withHouseholdTx(HOUSEHOLD_ID, async (client) => {
      const rebuilt = await rebuildCashFromJournal(client, HOUSEHOLD_ID);
      expect(fromMinor(rebuilt.get('ibkr@USD') ?? 0n)).toBe(18000);
    });
  });

  it('RLS blocks other household when GUC set', async () => {
    const state = loadState(SLUG) as import('../src/state/portfolio-state.js').InvestorState;
    await booksPostOpeningBalance(state, {
      amount: 42,
      currency: 'USD',
      channel: 'dbs',
      valueDate: '2026-08-09',
      memo: 'test opening',
      requestId: 'rls-1',
    });

    const otherId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    await wipeHousehold(otherId).catch(() => undefined);
    await withHouseholdTx(otherId, async (client) => {
      await ensureHousehold(client, otherId, 'other');
      const seen = await client.query(
        `SELECT COUNT(*)::int AS c FROM accounts WHERE household_id = $1::uuid`,
        [HOUSEHOLD_ID],
      );
      // With RLS, querying other household's rows while GUC=otherId returns 0
      expect(seen.rows[0].c).toBe(0);
    });
  });
});
