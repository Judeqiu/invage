import { afterEach, expect, it, vi } from 'vitest';
import { runWithWebRunContext, type WebRunContext } from 'utarus';
const mocks = vi.hoisted(() => ({ get: vi.fn(), enabled: vi.fn() }));
vi.mock('../src/risk/service.js', () => ({ riskRepository: { get: mocks.get } }));
vi.mock('../src/risk/context.js', () => ({ riskEnabled: mocks.enabled, riskConfigured: () => true }));
import { ENGINE_VERSION } from '../src/risk/types.js';
import { createOptionRiskResultTool } from '../src/tools/option_risk_result.js';
const context = { userId: 'trusted-owner', origin: 'user' } as WebRunContext;
async function read() { return createOptionRiskResultTool().execute('call', { result_id: '00000000-0000-4000-8000-000000000001' }, undefined, undefined as any); }
afterEach(() => vi.resetAllMocks());
it('refuses missing trusted context and incognito without looking up a result', async () => {
  expect((await read()).details).toBeNull();
  expect((await runWithWebRunContext({ ...context, incognito: true }, read)).details).toBeNull();
  expect(mocks.get).not.toHaveBeenCalled();
});
it('binds result reads to trusted owner rather than a supplied user identity', async () => {
  mocks.enabled.mockReturnValue(true);
  mocks.get.mockResolvedValue({ result: { id: 'result', generatedAt: '2026-01-01', model: { version: ENGINE_VERSION } } });
  const result = await runWithWebRunContext(context,read);
  expect(mocks.get).toHaveBeenCalledWith('trusted-owner','00000000-0000-4000-8000-000000000001');
  expect(result.details).toMatchObject({ stale: true });
});
it('rechecks effective configuration before reading saved financial results', async () => {
  mocks.enabled.mockReturnValue(false);
  expect((await runWithWebRunContext(context,read)).details).toBeNull();
  expect(mocks.get).not.toHaveBeenCalled();
});
