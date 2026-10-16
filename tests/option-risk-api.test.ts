import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), configured: vi.fn(), repository: { enqueue: vi.fn(), get: vi.fn(), latest: vi.fn() }, normalize: vi.fn() }));
vi.mock('utarus', async original => ({ ...await original<typeof import('utarus')>(), loadSessionState: mocks.session }));
vi.mock('../src/risk/service.js', () => ({ riskRepository: mocks.repository, startRiskQueue: () => () => {} }));
vi.mock('../src/risk/context.js', async original => ({ ...await original<typeof import('../src/risk/context.js')>(), riskEnabled: mocks.enabled, riskConfigured: mocks.configured, normalizeRiskInputs: mocks.normalize, readRiskMarketSnapshot: async () => null }));
import { createOptionRiskRouter } from '../src/webapp/option-risk-api.js';
import { analysisContext } from '../src/risk/context.js';
const owner = '00000000-0000-4000-8000-000000000001';
const snapshot = { revision: 1, state: { user: { id: owner } } };
function body() { return { analysisContextId: analysisContext(snapshot as any), accountScope: { kind: 'all', accountIds: [] }, horizonTradingDays: 5, scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh: false }; }
function app() { const a = express(); a.use(express.json()); a.use(createOptionRiskRouter()); return a; }
beforeEach(() => { vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test'); mocks.session.mockResolvedValue(snapshot); mocks.enabled.mockReturnValue(true); mocks.configured.mockReturnValue(true); mocks.normalize.mockReturnValue({}); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it('capabilities are cheap, authenticated and uncached', async () => {
  const a = app(), r = await request(a).get('/capabilities');
  expect(r.status).toBe(200); expect(r.headers['cache-control']).toBe('private, no-store');
  expect(mocks.repository.enqueue).not.toHaveBeenCalled(); expect(mocks.normalize).not.toHaveBeenCalled();
  mocks.session.mockRejectedValue(new Error()); expect((await request(a).get('/capabilities')).status).toBe(401);
});
it('checks feature availability on every job/result read and submission', async () => {
  const a=app(); mocks.enabled.mockReturnValue(false);
  for (const path of ['/jobs/id','/results/id','/latest']) expect((await request(a).get(path)).status).toBe(404);
  expect((await request(a).post('/jobs').send(body())).status).toBe(404);
  expect(mocks.repository.get).not.toHaveBeenCalled();
});
it('requires same-origin JSON and returns queued work promptly', async () => {
  const a=app();
  expect((await request(a).post('/jobs').send(body())).status).toBe(403);
  expect((await request(a).post('/jobs').set('Host','app.test').set('Origin','https://evil.test').send(body())).status).toBe(403);
  mocks.repository.enqueue.mockResolvedValue({ id: 'job', status: 'queued' });
  const r=await request(a).post('/jobs').set('Host','app.test').set('Origin','https://app.test').send(body());
  expect(r.status).toBe(202); expect(mocks.repository.enqueue.mock.calls[0][0]).toBe(owner);
});
it('uses only authenticated owner identity for guessed IDs and rejects stale context', async () => {
  const a=app(); mocks.repository.get.mockResolvedValue(null);
  expect((await request(a).get('/results/00000000-0000-4000-8000-000000000002?userId=other')).status).toBe(404);
  expect(mocks.repository.get).toHaveBeenCalledWith(owner,'00000000-0000-4000-8000-000000000002');
  const r=await request(a).get('/latest').query({ analysisContextId: 'a'.repeat(64), kind: 'all', accountIds: '[]', horizonTradingDays: '5' });
  expect(r.status).toBe(409);
});
it('archive retrieval never launches current analysis', async () => {
  mocks.repository.latest.mockResolvedValue({ status: 'complete', result: { generatedAt: '2026-10-16T10:00:00Z' } });
  const r=await request(app()).get('/latest').query({ analysisContextId: body().analysisContextId, kind: 'all', accountIds: '[]', horizonTradingDays: '5', date: '2026-10-01' });
  expect(r.status).toBe(200); expect(r.body.job).toBeNull(); expect(mocks.repository.enqueue).not.toHaveBeenCalled();
});
