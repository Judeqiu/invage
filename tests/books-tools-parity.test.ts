import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { loadInvestor, saveInvestor } from '../src/state/investor-store.js';
/**
 * Parity: journal-based books tools match pure state-machine end balances.
 * Cash is never absolute-set — only opening + adjustments + transfer + deposit journals.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const testDatabase = await useTestDatabase({ books: true });

const dataRoot = join(tmpdir(), `invage-books-parity-${process.pid}`);
mkdirSync(join(dataRoot, 'users'), { recursive: true });
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;


const HOUSEHOLD = 'cccccccc-dddd-4eee-8fff-000000000001';
const SLUG = 'parity-user';
const TG = 900001;

async function writeUser(extra: Record<string, unknown> = {}): Promise<void> {
  await testDatabase.clearUsers();
  await createInvestorFixture({
      user: {
        id: HOUSEHOLD,
        slug: SLUG,
        created_at: '2026-08-01',
        telegram_user_ids: [TG],
        auth_token: randomUUID(),
      },
      profile: { display_name: 'Parity', contact_email: 'p@test.local' },
      log: [{ ts: '2026-08-01', action: 'created' }],
      ...extra,
    });
}

async function wipeHousehold(_id: string): Promise<void> {
  const { closePool, migrateBooks } = await import('../src/books/index.js');
  await closePool();
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: testDatabase.booksUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await migrateBooks();
}

function toolByName(tools: Array<{ name: string }>, name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t as {
    name: string;
    execute: (id: string, args: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text?: string }>;
      details?: Record<string, unknown>;
    }>;
  };
}

describe('books tools parity vs domain state machine', () => {

  beforeEach(async () => {
    await wipeHousehold(HOUSEHOLD);
    await writeUser();
  });

  afterAll(async () => {
    const { closePool } = await import('../src/books/index.js');
    await closePool();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('opening + transfer + deposit lifecycle matches state-machine amounts', async () => {
    // Baseline: pure portfolio-state mutators (no absolute tool)
    await writeUser();

    const {
      getCashes,
      getDeposits,
      setCash,
      transferCash,
      matureDeposit,
      upsertDeposit,
      applyCashDelta,
      setCashes,
    } = await import('../src/state/portfolio-state.js');

    let stateSnapshot = await loadInvestor(SLUG);
    let state = stateSnapshot.state;
    setCash(state, {
      amount: 10000,
      currency: 'USD',
      updated_at: '2026-08-09',
      channel: 'dbs',
    });
    setCash(state, {
      amount: 1000,
      currency: 'USD',
      updated_at: '2026-08-09',
      channel: 'ibkr',
    });
    transferCash(state, {
      fromChannel: 'dbs',
      toChannel: 'ibkr',
      amount: 2500,
      currency: 'USD',
      updatedAt: '2026-08-09',
    });
    upsertDeposit(state, {
      id: 'fd-parity',
      amount: 3000,
      interest: 50,
      currency: 'USD',
      channel: 'dbs',
      start_date: '2026-01-01',
      end_date: '2026-07-01',
      updated_at: '2026-08-09',
    });
    const debit = applyCashDelta(getCashes(state), -3000, '2026-08-09', true, 'dbs', 'USD');
    setCashes(state, debit.cashes);
    matureDeposit(state, {
      id: 'fd-parity',
      updatedAt: '2026-08-09',
      adjustCash: true,
    });
    await saveInvestor(stateSnapshot);
    const domainCashes = getCashes(state)
      .map((c) => ({
        channel: c.channel ?? '',
        currency: c.currency,
        amount: c.amount,
      }))
      .sort((a, b) => `${a.channel}@${a.currency}`.localeCompare(`${b.channel}@${b.currency}`));

    // Books journals via tools
    await wipeHousehold(HOUSEHOLD);
    await writeUser();
    process.env.INVAGE_BOOKS_DATABASE_URL = testDatabase.booksUrl;
    const { closePool } = await import('../src/books/index.js');
    await closePool();

    const { createPortfolioTools } = await import('../src/tools/portfolio.js');
    const tools = createPortfolioTools();
    expect(tools.map((t) => t.name)).not.toContain('set_cash');
    const open = toolByName(tools, 'post_opening_balance');
    const xfer = toolByName(tools, 'transfer_cash');
    const addDep = toolByName(tools, 'add_deposit');
    const mat = toolByName(tools, 'mature_deposit');

    await open.execute('1', {
      telegram_user_id: TG,
      amount: 10000,
      currency: 'USD',
      channel: 'dbs',
      memo: 'opening dbs free cash from statement',
    });
    await open.execute('2', {
      telegram_user_id: TG,
      amount: 1000,
      currency: 'USD',
      channel: 'ibkr',
      memo: 'opening ibkr free cash from statement',
    });
    await xfer.execute('3', {
      telegram_user_id: TG,
      from_channel: 'dbs',
      to_channel: 'ibkr',
      amount: 2500,
      currency: 'USD',
    });
    await addDep.execute('4', {
      telegram_user_id: TG,
      amount: 3000,
      interest: 50,
      currency: 'USD',
      channel: 'dbs',
      start_date: '2026-01-01',
      end_date: '2026-07-01',
      id: 'fd-parity',
    });
    await mat.execute('5', {
      telegram_user_id: TG,
      id: 'fd-parity',
    });

    const booksStateSnapshot = await loadInvestor(SLUG);
    const booksState = booksStateSnapshot.state;
    const booksCashes = getCashes(booksState)
      .map((c) => ({
        channel: c.channel ?? '',
        currency: c.currency,
        amount: c.amount,
      }))
      .sort((a, b) => `${a.channel}@${a.currency}`.localeCompare(`${b.channel}@${b.currency}`));

    expect(booksCashes).toEqual(domainCashes);
    expect(getDeposits(booksState)).toEqual([]);
    expect(booksCashes.find((c) => c.channel === 'dbs')?.amount).toBe(7500);
    expect(booksCashes.find((c) => c.channel === 'ibkr')?.amount).toBe(3500);
  });

  it('auto-seeds domain cash then transfer journals like before', async () => {
    process.env.INVAGE_BOOKS_DATABASE_URL = testDatabase.booksUrl;
    const { closePool } = await import('../src/books/index.js');
    await closePool();

    await writeUser({
      cash: [
        { amount: 5000, currency: 'USD', updated_at: '2026-08-08', channel: 'dbs' },
        { amount: 100, currency: 'USD', updated_at: '2026-08-08', channel: 'ibkr' },
      ],
    });

    const { createPortfolioTools } = await import('../src/tools/portfolio.js');
    const tools = createPortfolioTools();
    const xfer = toolByName(tools, 'transfer_cash');
    const res = await xfer.execute('t', {
      telegram_user_id: TG,
      from_channel: 'dbs',
      to_channel: 'ibkr',
      amount: 1000,
      currency: 'USD',
    });
    const text = res.content.map((c) => c.text ?? '').join('');
    expect(text).not.toMatch(/Insufficient/i);


    const { getCashes } = await import('../src/state/portfolio-state.js');
    const cashes = getCashes(
      (await loadInvestor(SLUG)).state as import('../src/state/portfolio-state.js').InvestorState,
    );
    expect(cashes.find((c) => c.channel === 'dbs')?.amount).toBe(4000);
    expect(cashes.find((c) => c.channel === 'ibkr')?.amount).toBe(1100);
  });

  it('post_adjustment refuses absolute overwrite semantics (delta only)', async () => {
    process.env.INVAGE_BOOKS_DATABASE_URL = testDatabase.booksUrl;
    const { closePool } = await import('../src/books/index.js');
    await closePool();
    await writeUser();
    const { createPortfolioTools } = await import('../src/tools/portfolio.js');
    const tools = createPortfolioTools();
    const open = toolByName(tools, 'post_opening_balance');
    const adj = toolByName(tools, 'post_adjustment');
    await open.execute('1', {
      telegram_user_id: TG,
      amount: 1000,
      currency: 'USD',
      channel: 'dbs',
      memo: 'opening for adj test',
    });
    // Second "open" on same sleeve must fail
    const bad = await open.execute('2', {
      telegram_user_id: TG,
      amount: 5000,
      currency: 'USD',
      channel: 'dbs',
      memo: 'should fail already open',
    });
    expect(bad.content.map((c) => c.text).join('')).toMatch(/already has balance|post_adjustment/i);

    const okAdj = await adj.execute('3', {
      telegram_user_id: TG,
      amount: 250,
      currency: 'USD',
      channel: 'dbs',
      memo: 'bank interest Aug 2026 statement',
      contra: 'income',
    });
    expect(okAdj.content.map((c) => c.text).join('')).toMatch(/income|1250|250/);

    const { getCashes } = await import('../src/state/portfolio-state.js');
    expect(
      getCashes((await loadInvestor(SLUG)).state as import('../src/state/portfolio-state.js').InvestorState).find(
        (c) => c.channel === 'dbs',
      )?.amount,
    ).toBe(1250);
  });

  it('add_holding journals cash drawdown after opening', async () => {
    process.env.INVAGE_BOOKS_DATABASE_URL = testDatabase.booksUrl;
    const { closePool } = await import('../src/books/index.js');
    await closePool();
    await writeUser();

    const { createPortfolioTools } = await import('../src/tools/portfolio.js');
    const tools = createPortfolioTools();
    const open = toolByName(tools, 'post_opening_balance');
    const add = toolByName(tools, 'add_holding');
    const get = toolByName(tools, 'get_portfolio');

    await open.execute('1', {
      telegram_user_id: TG,
      amount: 20000,
      currency: 'USD',
      channel: 'ibkr',
      memo: 'opening ibkr for buy test',
    });
    await add.execute('2', {
      telegram_user_id: TG,
      ticker: 'AAPL',
      avg_price: 200,
      units: 10,
      channel: 'ibkr',
    });
    const got = await get.execute('3', { telegram_user_id: TG });
    const details = got.details as {
      cashes?: Array<{ channel?: string; amount: number }>;
      portfolio?: Record<string, { units: number }>;
    };
    expect(details.portfolio?.['AAPL@ibkr']?.units ?? details.portfolio?.AAPL?.units).toBe(10);
    expect(details.cashes?.find((c) => c.channel === 'ibkr')?.amount).toBe(18000);
  });
});
