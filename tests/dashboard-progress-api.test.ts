import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'node:http';
const { load, investor } = vi.hoisted(() => ({ load: vi.fn(), investor: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: investor }));
vi.mock('../src/webapp/dashboard-data.js', () => ({ loadDashboardForSlug: load }));
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
const owner = '00000000-0000-4000-8000-000000000011';
const payload = { empty: true, model: null, displayName: 'Test' };
function app(auth = true) {
  const app = express();
  if (auth) app.use((req, _res, next) => { Object.assign(req, { user: { userId: owner } }); next(); });
  app.use((req, _res, next) => { Object.assign(req, { cookies: { bindrive_session: req.headers['x-test-session'] } }); next(); });
  app.use(createDashboardApiRouter());
  return app;
}
afterEach(() => vi.resetAllMocks());
it('keeps the JSON API compatible and rejects unauthenticated progress requests', async () => {
  load.mockResolvedValue(payload);
  const unauthorized = await request(app(false)).get('/dashboard?progress=1');
  expect(unauthorized.status).toBe(401);
  expect(load).not.toHaveBeenCalled();
  const response = await request(app()).get('/dashboard');
  expect(response.body).toMatchObject({ ...payload, dashboardConfig: { optionView: 'open' } });
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(load).toHaveBeenCalledWith(owner, undefined, undefined, undefined);
});
it('delivers actual progress before the result is available, scoped to the authenticated user', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  load.mockImplementation(async (id, _prices, _benchmark, progress) => {
    expect(id).toBe(owner);
    progress({ stage: 'market', completedStages: 1, totalStages: 6, positions: 30, tradeRecords: 1577 });
    await gate;
    return payload;
  });
  const server = createServer(app());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard?progress=1`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain('"type":"progress"');
    expect(text).toContain('1577');
    expect(text).not.toContain('"type":"result"');
    release();
    let rest = '';
    while (true) { const next = await reader.read(); if (next.done) break; rest += new TextDecoder().decode(next.value); }
    expect(rest).toContain('"type":"result"');
    expect(rest).toContain('"optionView":"open"');
  } finally { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('ends a failed stream with an error rather than a success event or private internal details', async () => {
  load.mockImplementation(async (_id, _prices, _benchmark, progress) => {
    progress({ stage: 'records', completedStages: 0, totalStages: 6 });
    throw new Error('private internal failure');
  });
  const response = await request(app()).get('/dashboard?progress=1').buffer(true);
  expect(response.text).toContain('"type":"error"');
  expect(response.text).not.toContain('"type":"result"');
  expect(response.text).not.toContain('private internal failure');
});

it('reuses only the same login and user snapshot and invalidates after recorded changes', async () => {
  const server = app();
  investor.mockResolvedValue({ revision: 1 });
  load.mockResolvedValue(payload);
  const get = (path: string, session = 'login-one') => request(server).get(path).set('x-test-session', session);
  expect((await get('/dashboard-cache')).body).toBeNull();
  await get('/dashboard');
  expect((await get('/dashboard-cache')).body).toMatchObject(payload);
  await get('/dashboard');
  expect(load).toHaveBeenCalledTimes(1);
  expect((await get('/dashboard-cache', 'login-two')).body).toBeNull();
  await get('/dashboard', 'login-two');
  expect(load).toHaveBeenCalledTimes(2);
  investor.mockResolvedValue({ revision: 2 });
  expect((await get('/dashboard-cache')).body).toBeNull();
  await get('/dashboard');
  expect(load).toHaveBeenCalledTimes(3);
  load.mockImplementation(async (_slug, _prices, _benchmark, progress) => {
    progress({ stage: 'records', completedStages: 0, totalStages: 6 });
    return { ...payload, displayName: 'Refreshed' };
  });
  await get('/dashboard?progress=1');
  expect(load).toHaveBeenCalledTimes(4);
  expect((await get('/dashboard-cache')).body.displayName).toBe('Refreshed');
  expect((await request(app(false)).get('/dashboard-cache')).status).toBe(401);
});

it('expires the login snapshot when the dashboard calendar day changes', async () => {
  const now = vi.spyOn(Date, 'now');
  // Override the entry timestamp without changing the system clock used by Supertest.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(23, 59, 59, 999);
  now.mockReturnValue(yesterday.getTime());
  investor.mockResolvedValue({ revision: 1 });
  load.mockResolvedValue(payload);
  const server = app();
  try {
    await request(server).get('/dashboard').set('x-test-session', 'day-boundary');
    now.mockRestore();
    expect((await request(server).get('/dashboard-cache').set('x-test-session', 'day-boundary')).body).toBeNull();
  } finally { now.mockRestore(); }
});
