import { portfolioStateSaved, refreshPortfolioAfterSync, registerPortfolioRefresher } from '../src/state/projection-events.js';
import { readAgentConfig, saveAgentConfig } from 'utarus';
import { dashboardConfig } from '../src/webapp/dashboard-config.js';
import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { InvestorSnapshot } from '../src/state/investor-store.js';

const mocks = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), sync: vi.fn(), capture: vi.fn(), notify: vi.fn() }));
vi.mock('utarus', async original => ({ ...await original<typeof import('utarus')>(), loadSessionState: mocks.session, notifyUser: mocks.notify }));
vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: mocks.load, saveInvestor: vi.fn() }));
vi.mock('../src/brokers/accounts.js', async original => ({
  ...await original<typeof import('../src/brokers/accounts.js')>(), syncBrokerAccount: mocks.sync,
}));
vi.mock('../src/state/capture-snapshot.js', () => ({ capturePortfolioSnapshot: mocks.capture }));
import { createBrokerSyncJobs } from '../src/brokers/sync-all.js';
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
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    if (userId) Object.assign(req, { user: { userId } });
    next();
  });
  app.use(createBrokerConnectionsRouter());
  return app;
}
beforeEach(() => { vi.resetAllMocks(); mocks.capture.mockResolvedValue({ aggregation: { status: 'ready' } }); mocks.notify.mockResolvedValue({ notification: {}, delivery: [] }); });

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
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(completed.body.snapshotStatus).toBe('skipped');
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify.mock.calls[0][0]).toMatchObject({ userId: 'alice', status_hint: 'failure', body: expect.stringContaining('Interactive Brokers · B: failed') });
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

it('exposes session-scoped sync timestamps and account states without credentials', async () => {
  const snapshot = fixture();
  const accounts = Object.values(snapshot.state.broker_connections!);
  accounts[0].last_sync = {at:'2026-10-22T02:20:00Z',as_of:'2026-10-21',ok:true};
  accounts[1].last_sync = {at:'2026-10-22T03:00:00Z',ok:false,error:'secret-token'};
  mocks.session.mockImplementation(async req => req.user.userId === 'alice' ? snapshot : fixture('bob'));
  const server = app();
  expect((await request(server).get('/broker-sync/status')).status).toBe(401);
  const response = await request(server).get('/broker-sync/status').set('x-user','alice');
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body.running).toBe(false);
  expect(response.body.updatedAt).toBe('2026-10-22T03:00:00Z');
  expect(response.body.items.map((item: {status:string})=>item.status)).toEqual(['Synced','Failed','Never synced','Paused']);
  expect(response.body.items[0]).toMatchObject({label:'Interactive Brokers · A',updatedAt:'2026-10-22T02:20:00Z'});
  expect(JSON.stringify(response.body)).not.toMatch(/secret-token|activity_query_id|2026-10-21/);
  const other = await request(server).get('/broker-sync/status').set('x-user','bob');
  expect(other.body.updatedAt).toBeNull();
});

it('uses the daily batch eligibility, snapshots after all imports, and waits for final aggregates', async () => {
  const snapshot = fixture();
  // Enabled but not bound/discovered accounts are ineligible in the daily flow too.
  const unbound = addBrokerAccount(snapshot.state, { source_id: Object.keys(snapshot.state.broker_sources!)[0], account_id: 'UNBOUND', label: 'Unbound', config: { activity_query_id: '123' } });
  delete snapshot.state.broker_connections![unbound].account_id;
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mocks.load.mockResolvedValue(snapshot);
  mocks.sync.mockImplementation(async (_snapshot, id) => { events.push(id); return { aggregation: { status: 'failed' } }; });
  mocks.capture.mockImplementation(async (_state, date) => { events.push('snapshot:' + date); await gate; return { aggregation: { status: 'ready' } }; });
  const jobs = createBrokerSyncJobs({ now: () => new Date('2026-10-23T15:59:59Z') });
  const job = jobs.start(snapshot);
  expect(job.accounts.map(a => a.id)).not.toContain(unbound);
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
  expect(events).toEqual([...job.accounts.map(a => a.id), 'snapshot:2026-10-23']);
  expect(mocks.capture.mock.calls[0][2]).toEqual({ allowEmpty: true });
  expect(job.status).toBe('running');
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(jobs.start(snapshot).id).toBe(job.id);
  release();
  await vi.waitFor(() => expect(job.status).toBe('completed'));
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify.mock.calls[0][0].body).toContain('Snapshot saved for 2026-10-23');
  expect(job).toMatchObject({ snapshotStatus: 'saved', calculationStatus: 'ready', syncDate: '2026-10-23' });
  // Manual sync runs again even if the daily batch already completed today.
  snapshot.state.daily_broker_sync = { date: job.syncDate, synced_accounts: {}, completed_at: '2026-10-23T06:00:00Z' };
  expect(jobs.start(snapshot).id).not.toBe(job.id);
  await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(2));
});

it('dates snapshots in Singapore and reports finalization failure without leaking private errors', async () => {
  const snapshot = fixture();
  mocks.load.mockResolvedValue(snapshot);
  mocks.sync.mockResolvedValue({ aggregation: { status: 'ready' } });
  mocks.capture.mockRejectedValue(new Error('private token details'));
  const jobs = createBrokerSyncJobs({ now: () => new Date('2026-10-23T16:00:00Z') });
  const job = jobs.start(snapshot);
  await vi.waitFor(() => expect(job.status).toBe('completed'));
  expect(job).toMatchObject({ syncDate: '2026-10-24', snapshotStatus: 'failed' });
  expect(job.accounts.every(a => a.status === 'succeeded')).toBe(true);
  expect(mocks.notify).toHaveBeenCalledOnce();
  expect(mocks.notify.mock.calls[0][0]).toMatchObject({ status_hint: 'failure', body: expect.stringContaining('snapshot and aggregates') });
  expect(job.error).toContain('snapshot and aggregates');
  expect(JSON.stringify(job)).not.toMatch(/private token details|secret-token/);
});

it('withholds the snapshot when a new account is linked during manual sync', async () => {
  const snapshot = fixture();
  mocks.load.mockResolvedValue(snapshot);
  mocks.sync.mockImplementationOnce(async () => {
    addBrokerAccount(snapshot.state, { source_id: Object.keys(snapshot.state.broker_sources!)[0], account_id: 'NEW', label: 'New', config: { activity_query_id: '123' } });
    return { aggregation: { status: 'ready' } };
  }).mockResolvedValue({ aggregation: { status: 'ready' } });
  const jobs = createBrokerSyncJobs();
  const job = jobs.start(snapshot);
  await vi.waitFor(() => expect(job.status).toBe('completed'));
  expect(mocks.capture).not.toHaveBeenCalled();
  expect(job).toMatchObject({ snapshotStatus: 'skipped', error: expect.stringContaining('accounts changed') });
});

it('rejects legacy schedule creation through the API and omits retired schedule controls from account data', async () => {
  const snapshot = fixture('00000000-0000-4000-8000-000000000071');
  const id = Object.keys(snapshot.state.broker_connections!)[0];
  (snapshot.state.broker_connections![id] as import('../src/state/portfolio-state.js').BrokerAccountConnection).sync_schedule = {
    frequency: 'hourly', next_run_at: '2026-01-01T00:00:00Z' };
  mocks.session.mockResolvedValue(snapshot);
  const server = app();
  for (const sync_frequency of ['hourly', 'daily', 'weekly']) {
    const response = await request(server).patch('/broker-accounts/' + id).set('x-user', 'alice').send({ sync_frequency });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('disabled');
  }
  const accounts = await request(server).get('/broker-accounts').set('x-user', 'alice');
  expect(accounts.status).toBe(200);
  expect(accounts.body.automatic_sync).toMatchObject({ enabled: true, time: '14:00', timezone: 'Asia/Singapore' });
  expect(accounts.body.connections.find(account => account.id === id)).not.toHaveProperty('sync_schedule');
  const saved = await request(server).patch('/broker-accounts/' + id).set('x-user', 'alice').send({ label: 'Updated' });
  expect(saved.status).toBe(200);
  expect(snapshot.state.broker_connections![id]).not.toHaveProperty('sync_schedule');
});

it('exposes the saved automatic-sync settings and keeps manual batches available when disabled', async () => {
  const original = readAgentConfig(dashboardConfig);
  try {
    saveAgentConfig(dashboardConfig, { ...original, automatic_broker_sync_enabled: false,
      automatic_broker_sync_hour: '17', automatic_broker_sync_minute: '35' });
    const snapshot = fixture('00000000-0000-4000-8000-000000000072');
    mocks.session.mockResolvedValue(snapshot);
    mocks.load.mockResolvedValue(snapshot);
    mocks.sync.mockResolvedValue({ aggregation: { status: 'ready' } });
    const server = app();
    const accounts = await request(server).get('/broker-accounts').set('x-user', 'alice');
    expect(accounts.status).toBe(200);
    expect(accounts.body.automatic_sync).toMatchObject({ enabled: false, time: '17:35', timezone: 'Asia/Singapore' });
    const started = await request(server).post('/broker-sync').set('x-user', 'alice');
    expect(started.status).toBe(202);
    await vi.waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    const completed = await request(server).get('/broker-sync').set('x-user', 'alice');
    expect(completed.body).toMatchObject({ status: 'completed', snapshotStatus: 'saved', calculationStatus: 'ready' });
    expect(mocks.sync).toHaveBeenCalledTimes(3);
  } finally { saveAgentConfig(dashboardConfig, original); }
});

it('imports all brokers before final calculations and waits before sending the single notification', async () => {
  const snapshot = fixture();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const calculate = vi.fn(async () => { await gate; });
  const unregister = registerPortfolioRefresher(calculate);
  mocks.load.mockResolvedValue(snapshot);
  mocks.sync.mockImplementation(async () => {
    portfolioStateSaved(snapshot);
    return { aggregation: await refreshPortfolioAfterSync(snapshot.state.user.id) };
  });
  try {
    const job = createBrokerSyncJobs().start(snapshot);
    await vi.waitFor(() => expect(calculate).toHaveBeenCalledOnce());
    expect(mocks.sync).toHaveBeenCalledTimes(3);
    expect(job.status).toBe('running');
    expect(mocks.notify).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(job.status).toBe('completed'));
    expect(job.calculationStatus).toBe('ready');
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.calls[0][0].body).toContain('Portfolio aggregates updated.');
  } finally { finish(); unregister(); }
});
