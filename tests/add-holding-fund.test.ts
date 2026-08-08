/**
 * Regression: add_holding instrument=fund for a brand-new key must not throw
 * "Cannot read properties of undefined" when preserving prior fund fields.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-add-fund-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { loadState, saveState } = await import('utarus');
const { createPortfolioTools } = await import('../src/tools/portfolio.js');
const { getPortfolio } = await import('../src/state/portfolio-state.js');

const SLUG = 'fundbooker';

beforeAll(() => {
  mkdirSync(join(dataRoot, 'users'), { recursive: true });
  writeFileSync(
    join(dataRoot, 'users', `${SLUG}.yaml`),
    stringify({
      user: {
        slug: SLUG,
        created_at: '2026-08-08',
        telegram_user_ids: [],
        slack_user_ids: [],
      },
      profile: { display_name: 'Fund Booker', contact_email: 'f@example.com' },
      portfolio: {},
      cash: [
        {
          amount: 5000,
          currency: 'USD',
          updated_at: '2026-08-08',
          channel: 'ocbc',
        },
        {
          amount: 1000,
          currency: 'SGD',
          updated_at: '2026-08-08',
          channel: 'dbs',
        },
      ],
      treasury: { reporting_currency: 'USD', updated_at: '2026-08-08' },
      log: [],
    }),
    'utf8',
  );
});

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('add_holding new fund lot', () => {
  it('books a brand-new manual fund without crashing (adjust_cash=false)', async () => {
    const add = createPortfolioTools().find((t) => t.name === 'add_holding');
    expect(add).toBeDefined();

    const prepared = add!.prepareArguments!({
      user_slug: SLUG,
      ticker: 'OCBCPM',
      avg_price: '9,983.81',
      units: 1,
      mark: '7,547.30',
      instrument: 'fund',
      fund_quote_source: 'manual',
      fund_name: 'Precious Metals (SGD)',
      channel: 'ocbc',
      adjust_cash: false,
    });

    const result = await add!.execute('t1', prepared);
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('');
    expect(text).not.toMatch(/Cannot read properties of undefined/i);
    expect(text).toMatch(/Added fund OCBCPM@ocbc/i);
    expect(text).toMatch(/adjust_cash=false|Cash ledger/i);

    const state = loadState(SLUG);
    const port = getPortfolio(state as never);
    expect(port['OCBCPM@ocbc']).toMatchObject({
      instrument: 'fund',
      avg_price: 9983.81,
      units: 1,
      channel: 'ocbc',
      fund: {
        quote_source: 'manual',
        mark: 7547.3,
        name: 'Precious Metals (SGD)',
      },
    });
  });

  it('fails clearly when fund_quote_source is missing', async () => {
    const add = createPortfolioTools().find((t) => t.name === 'add_holding')!;
    const result = await add.execute('t2', {
      user_slug: SLUG,
      ticker: 'OCBCRI',
      avg_price: 20086.66,
      units: 1,
      instrument: 'fund',
      channel: 'ocbc',
      adjust_cash: false,
    });
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('');
    expect(text).toMatch(/fund_quote_source/);
    expect(text).not.toMatch(/Cannot read properties of undefined/i);
  });

  it('does not debit multi-ccy cash when adjust_cash=false on new fund', async () => {
    const add = createPortfolioTools().find((t) => t.name === 'add_holding')!;
    const before = loadState(SLUG);
    const result = await add.execute('t3', {
      user_slug: SLUG,
      ticker: 'OCBCRI',
      avg_price: 20086.66,
      units: 1,
      mark: 20280.43,
      instrument: 'fund',
      fund_quote_source: 'manual',
      fund_name: 'Smart Invest (SGD)',
      channel: 'ocbc',
      adjust_cash: false,
    });
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('');
    expect(text).toMatch(/Added fund OCBCRI@ocbc/i);

    const after = loadState(SLUG);
    // cash YAML should be unchanged amounts
    expect(JSON.stringify(after.cash)).toBe(JSON.stringify(before.cash));
    saveState(after);
  });
});
