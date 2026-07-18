import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-dash-webui-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { loadDashboardForSlug } = await import('../src/webapp/dashboard-data.js');
const { createInvageWebUi, invageWebUiStaticDir } = await import(
  '../src/webapp/invage-webui.js'
);
const { existsSync } = await import('fs');

describe('loadDashboardForSlug', () => {
  beforeAll(() => {
    const usersDir = join(dataRoot, 'users');
    mkdirSync(usersDir, { recursive: true });
    writeFileSync(
      join(usersDir, 'alice.yaml'),
      stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000011',
          slug: 'alice',
          created_at: '2026-06-27',
          telegram_user_ids: [],
          auth_token: '00000000-0000-4000-8000-000000000012',
        },
        profile: { display_name: 'Alice', contact_email: 'a@example.com' },
        log: [{ ts: '2026-06-27', action: 'created' }],
        portfolio: {
          AAPL: { avg_price: 100, units: 10 },
        },
      }),
      'utf-8',
    );
    writeFileSync(
      join(usersDir, 'bob.yaml'),
      stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000021',
          slug: 'bob',
          created_at: '2026-06-27',
          telegram_user_ids: [],
          auth_token: '00000000-0000-4000-8000-000000000022',
        },
        profile: { display_name: 'Bob', contact_email: 'b@example.com' },
        log: [{ ts: '2026-06-27', action: 'created' }],
      }),
      'utf-8',
    );
    writeFileSync(
      join(usersDir, 'carol.yaml'),
      stringify({
        user: {
          id: '00000000-0000-4000-8000-000000000031',
          slug: 'carol',
          created_at: '2026-06-27',
          telegram_user_ids: [],
          auth_token: '00000000-0000-4000-8000-000000000032',
        },
        profile: { display_name: 'Carol', contact_email: 'c@example.com' },
        log: [{ ts: '2026-06-27', action: 'created' }],
        portfolio: {
          MSFT: { avg_price: 200, units: 5 },
        },
      }),
      'utf-8',
    );

    const drive = join(dataRoot, 'drive', 'alice');
    mkdirSync(drive, { recursive: true });
    const snap = {
      date: '2026-07-01',
      totalValue: 900,
      totalCost: 1000,
      totalPL: -100,
      totalPLPct: -10,
      positions: [],
    };
    writeFileSync(join(drive, 'snapshot-2026-07-01.json'), JSON.stringify(snap), 'utf-8');
    writeFileSync(join(drive, 'snapshots.json'), JSON.stringify(['snapshot-2026-07-01.json']), 'utf-8');
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns empty payload when portfolio has no holdings', async () => {
    const payload = await loadDashboardForSlug('bob');
    expect(payload.empty).toBe(true);
    expect(payload.model).toBeNull();
    expect(payload.displayName).toBe('Bob');
    expect(payload.message).toMatch(/No holdings/i);
  });

  it('builds live model with price override and snapshot history', async () => {
    const benchmark = {
      ticker: 'SPY',
      baseDate: '2026-07-01',
      currentPrice: 550,
      closes: { '2026-07-01': 500 },
    };
    const payload = await loadDashboardForSlug('alice', { AAPL: 120 }, benchmark);
    expect(payload.empty).toBe(false);
    expect(payload.model).not.toBeNull();
    expect(payload.model!.live.totalValue).toBe(1200);
    expect(payload.model!.live.positions[0].ticker).toBe('AAPL');
    expect(payload.model!.history).toHaveLength(1);
    expect(payload.model!.history[0].positions).toEqual([]);
    expect(payload.model!.lastSnapshot?.date).toBe('2026-07-01');
    expect(payload.model!.periodChange).toBeNull();
    expect(payload.benchmark).toEqual(benchmark);
  });

  it('benchmark is null when there are no snapshots to anchor it', async () => {
    const payload = await loadDashboardForSlug('carol', { MSFT: 250 });
    expect(payload.empty).toBe(false);
    expect(payload.model!.live.totalValue).toBe(1250);
    expect(payload.model!.history).toHaveLength(0);
    expect(payload.benchmark).toBeNull();
  });

  it('empty portfolio carries no benchmark', async () => {
    const payload = await loadDashboardForSlug('bob');
    expect(payload.empty).toBe(true);
    expect(payload.benchmark).toBeNull();
  });

  it('fails when a price is missing', async () => {
    await expect(loadDashboardForSlug('alice', {})).rejects.toThrow(/Missing market price for AAPL/);
  });
});

describe('createInvageWebUi', () => {
  it('registers dashboard nav, iframe route, API, and static dir', () => {
    const webUi = createInvageWebUi();
    expect(webUi.agentKey).toBe('invage');
    expect(webUi.nav?.some((n) => n.path === '/dashboard')).toBe(true);
    const route = webUi.routes?.find((r) => r.path === '/dashboard');
    expect(route?.pageKind).toBe('iframe');
    expect(route?.iframeSrc).toContain('/domain-assets/invage/dashboard');
    expect(webUi.apiRouters?.length).toBe(1);
    expect(existsSync(join(invageWebUiStaticDir(), 'dashboard', 'index.html'))).toBe(true);
    expect(existsSync(join(invageWebUiStaticDir(), 'dashboard', 'app.js'))).toBe(true);
  });
});
