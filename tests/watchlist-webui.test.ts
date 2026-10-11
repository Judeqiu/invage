import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDatabase = await useTestDatabase();

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-watch-webui-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { loadWatchlistForSlug } = await import('../src/webapp/watchlist-data.js');
const { createInvageWebUi, invageWebUiStaticDir } = await import(
  '../src/webapp/invage-webui.js'
);

beforeAll(async () => {
  const usersDir = join(dataRoot, 'users');
  mkdirSync(usersDir, { recursive: true });
  await createInvestorFixture({
      user: {
        id: '00000000-0000-4000-8000-000000000051',
        slug: 'dana',
        created_at: '2026-08-16',
        telegram_user_ids: [],
        auth_token: '00000000-0000-4000-8000-000000000052',
      },
      profile: { display_name: 'Dana', contact_email: 'd@example.com' },
      log: [{ ts: '2026-08-16', action: 'created' }],
      playbook: {
        watchlists: {
          markets: ['US', 'HK'],
          sectors: ['Technology'],
          themes: ['AI'],
          products: [
            {
              symbol: 'MSFT',
              instrument: 'equity',
              added_at: '2026-08-15',
            },
            {
              symbol: 'AAPL',
              instrument: 'equity',
              added_at: '2026-08-16',
              note: 'pullback',
            },
          ],
        },
      },
    });
  await createInvestorFixture({
      user: {
        id: '00000000-0000-4000-8000-000000000061',
        slug: 'erin',
        created_at: '2026-08-16',
        telegram_user_ids: [],
        auth_token: '00000000-0000-4000-8000-000000000062',
      },
      profile: { display_name: 'Erin', contact_email: 'e@example.com' },
      log: [{ ts: '2026-08-16', action: 'created' }],
    });
});

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('loadWatchlistForSlug', () => {
  it('returns universe chips and priced rows from override, sorted by symbol', async () => {
    const payload = await loadWatchlistForSlug('dana', {
      AAPL: { price: 190, change: 2, changePct: 1.06, currency: 'USD' },
      MSFT: { quoteError: 'Yahoo quote unavailable for MSFT' },
    });
    expect(payload.displayName).toBe('Dana');
    expect(payload.watchlists).toEqual({
      markets: ['US', 'HK'],
      sectors: ['Technology'],
      themes: ['AI'],
    });
    expect(payload.products.map((p) => p.symbol)).toEqual(['AAPL', 'MSFT']);
    expect(payload.products[0]).toMatchObject({
      symbol: 'AAPL',
      price: 190,
      change: 2,
      changePct: 1.06,
      currency: 'USD',
      note: 'pullback',
    });
    expect(payload.products[0].quoteError).toBeUndefined();
    expect(payload.products[1].price).toBeNull();
    expect(payload.products[1].quoteError).toMatch(/unavailable/i);
  });

  it('returns default universe and empty products when playbook is unset', async () => {
    const payload = await loadWatchlistForSlug('erin', {});
    expect(payload.displayName).toBe('Erin');
    expect(payload.watchlists.markets).toEqual(['US']);
    expect(payload.products).toEqual([]);
  });

  it('throws when the user file is missing', async () => {
    await expect(loadWatchlistForSlug('nobody')).rejects.toThrow();
  });
});

describe('createInvageWebUi watch list', () => {
  it('registers watch list nav, iframe route, and static page', async () => {
    const webUi = createInvageWebUi();
    expect(webUi.nav?.some((n) => n.path === '/watchlist' && n.label === 'Watch List')).toBe(
      true,
    );
    const route = webUi.routes?.find((r) => r.path === '/watchlist');
    expect(route?.pageKind).toBe('iframe');
    expect(route?.iframeSrc).toContain('/domain-assets/invage/watchlist');
    expect(existsSync(join(invageWebUiStaticDir(), 'watchlist', 'index.html'))).toBe(true);
    expect(existsSync(join(invageWebUiStaticDir(), 'watchlist', 'app.js'))).toBe(true);
  });
});
