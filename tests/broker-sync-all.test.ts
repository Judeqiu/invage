import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { InvestorSnapshot } from '../src/state/investor-store.js';

const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), sync: vi.fn() }));
vi.mock('utarus', async original => ({ ...await original<typeof import('utarus')>(), loadSessionState: mocks.session }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: mocks.load, saveInvestor: vi.fn() }));
vi.mock('../src/brokers/accounts.js', async original => ({
  ...await original<typeof import('../src/brokers/accounts.js')>(), syncBrokerAccount: mocks.sync,
}));
import { createBrokerConnectionsRouter } from '../src/webapp/broker-api.js';
import { addBrokerAccount, addBrokerSource, patchBrokerAccount } from '../src/brokers/accounts.js';

function fixture(userId = 'alice'): InvestorSnapshot {
  const snapshot = { state: { user: { id: userId, slug: userId, created_at: '2026-01-01' },
    profile: { display_name: userId, contact_email: 'a@example.com' }, log: [] }, revision: 1 } as InvestorSnapshot;
  const source = addBrokerSource(snapshot.state, 'ibkr', { token: 'secret-token' });
  for (const id of ['A', 'B', 'C', 'paused']) {
    const connection = addBrokerAccount(snapshot.state, { source_id: source, account_id: id, label: id, config: { activity_query_id: '123' } });
    if (id === 'paused') patchBrokerAccount(snapshot.state, connection, { enabled: false });
  }
  return snapshot;
}
function app() {
  const app = express();
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    if (userId) Object.assign(req, { user: { userId } });
    next();
  });
  app.use(createBrokerConnectionsRouter());
  return app;
}
beforeEach(() => vi.resetAllMocks());

it('starts asynchronously, deduplicates active jobs, isolates users, and continues after a failed account', async () => {
  const snapshot = fixture();
  mocks.session.mockImplementation(async req => req.user.userId === 'alice' ? snapshot : fixture('bob'));
  let revision = 1;
  mocks.load.mockImplementation(async () => ({ ...snapshot, revision: revision++ }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.sync.mockImplementationOnce(() => gate).mockRejectedValueOnce(new Error('private detail')).mockResolvedValue({ applied: {} });
  const server = app();
  const started = await request(server).post('/broker-sync').set('x-user', 'alice');
  expect(started.status).toBe(202);
  expect(started.headers['cache-control']).toBe('private, no-store');
  expect(started.body.accounts.map((a: { label: string }) => a.label)).toEqual(['A', 'B', 'C']);
  expect(started.body.status).toBe('running');
  expect((await request(server).post('/broker-sync').set('x-user', 'alice')).body.id).toBe(started.body.id);
  expect((await request(server).get('/broker-sync').set('x-user', 'bob')).body).toBeNull();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  release();
  await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(3));
  const completed = await request(server).get('/broker-sync').set('x-user', 'alice');
  expect(completed.body.status).toBe('completed');
  expect(completed.body.accounts.map((a: { status: string }) => a.status)).toEqual(['succeeded', 'failed', 'succeeded']);
  expect(mocks.sync.mock.calls.map(call => call[0].revision)).toEqual([1, 2, 3]);
  expect(JSON.stringify(completed.body)).not.toMatch(/secret-token|private detail/);
  expect((await request(server).post('/broker-sync').set('x-user', 'alice')).body.id).not.toBe(started.body.id);
});

it('rejects unauthenticated requests and completes an empty batch', async () => {
  const server = app();
  for (const method of ['get', 'post'] as const) expect((await request(server)[method]('/broker-sync')).status).toBe(401);
  const snapshot = fixture();
  snapshot.state.broker_connections = {};
  mocks.session.mockResolvedValue(snapshot);
  const response = await request(server).post('/broker-sync').set('x-user', 'alice');
  expect(response.body).toMatchObject({ status: 'completed', accounts: [] });
  expect(mocks.sync).not.toHaveBeenCalled();
});
