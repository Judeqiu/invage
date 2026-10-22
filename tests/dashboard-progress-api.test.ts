import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { persistPortfolioFixture } from './helpers/portfolio-projection.js';
const mocks = vi.hoisted(() => ({ calculate: vi.fn(), investor: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: mocks.investor }));
vi.mock('../src/webapp/dashboard-data.js', () => ({ loadDashboardForSlug: mocks.calculate }));
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
const owner = '00000000-0000-4000-8000-000000000011';
let root: string, state: InvestorState;
function app(auth = true, userId = owner) {
  const app = express();
  if (auth) app.use((req, _res, next) => { Object.assign(req, { user: { userId } }); next(); });
  app.use(createDashboardApiRouter());
  return app;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'portfolio-api-'));
  process.env.UTARUS_DATA_ROOT = root;
  state = { user: { id: owner, slug: 'test', created_at: '2026-01-01' },
    profile: { display_name: 'Test', contact_email: 'test@example.com' }, log: [] };
  mocks.investor.mockImplementation(async userId => ({ state: userId === owner ? structuredClone(state) : { ...state, user: { ...state.user, id: userId } }, revision: 1 }));
});
afterEach(() => { vi.clearAllMocks(); rmSync(root, { recursive: true, force: true }); });

it('serves only persisted generations, including explicit refresh and streaming requests', async () => {
  await persistPortfolioFixture(state);
  const server = app();
  for (const path of ['/dashboard', '/dashboard?refresh=1', '/dashboard-cache', '/portfolio-indices']) {
    const response = await request(server).get(path);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
  }
  const stream = await request(server).get('/dashboard?progress=1&refresh=1');
  expect(stream.headers['content-type']).toContain('text/event-stream');
  expect(stream.text).toContain('"type":"result"');
  expect(stream.text).not.toContain('"type":"progress"');
  expect(mocks.calculate).not.toHaveBeenCalled();
});

it('returns unavailable for missing or stale projections without calculating during a request', async () => {
  expect((await request(app()).get('/dashboard')).status).toBe(503);
  expect((await request(app()).get('/dashboard-cache')).body).toBeNull();
  await persistPortfolioFixture(state);
  state.cash = { amount: 50, currency: 'USD', updated_at: '2026-10-23' };
  expect((await request(app()).get('/dashboard?refresh=1')).status).toBe(503);
  const stream = await request(app()).get('/dashboard?progress=1');
  expect(stream.text).toContain('"type":"error"');
  expect(stream.text).not.toContain('"type":"result"');
  expect(mocks.calculate).not.toHaveBeenCalled();
});

it('survives router restarts without a TTL and never crosses tenant boundaries', async () => {
  await persistPortfolioFixture(state);
  const dateNow = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 86400000);
  try {
    expect((await request(app()).get('/dashboard')).status).toBe(200);
    expect((await request(app(true, 'another-user')).get('/dashboard')).status).toBe(503);
    for (const path of ['/dashboard', '/dashboard-cache', '/portfolio-indices', '/trades-v2', '/trades', '/option-history', '/option-relationships']) {
      expect((await request(app(false)).get(path)).status).toBe(401);
    }
  } finally { dateNow.mockRestore(); }
});

it('applies management display settings without rebuilding financial results', async () => {
  await persistPortfolioFixture(state);
  const directory = join(root, 'config/agent-config');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'invage-dashboard.json'), JSON.stringify({ show_realized_pnl: false }));
  const response = await request(app()).get('/dashboard');
  expect(response.body.dashboardConfig.showRealizedPnl).toBe(false);
  expect(response.body.generatedAt).toBe('2026-10-23T06:00:00Z');
  expect(mocks.calculate).not.toHaveBeenCalled();
});
