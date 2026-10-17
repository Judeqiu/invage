import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runWithWebRunContext, type WebRunContext } from 'utarus';
import type { RiskAnalysis } from '../src/risk/types.js';
import { ENGINE_VERSION } from '../src/risk/types.js';
import { buildOptionRiskReport } from '../src/report/option-risk-template.js';
const mocks = vi.hoisted(() => ({ get: vi.fn(), enqueue: vi.fn(), start: vi.fn(), publish: vi.fn(), resolve: vi.fn(), enabled: vi.fn(), configured: vi.fn(), normalize: vi.fn() }));
vi.mock('utarus', async original => ({ ...await original<typeof import('utarus')>(), publishReportHtml: mocks.publish }));
vi.mock('../src/tools/channel.js', () => ({ channelIdParams: {}, resolveInvestorFromChannel: mocks.resolve }));
vi.mock('../src/risk/service.js', () => ({ riskRepository: { get: mocks.get, enqueue: mocks.enqueue }, startRiskQueue: mocks.start }));
vi.mock('../src/risk/context.js', () => ({ riskEnabled: mocks.enabled, riskConfigured: mocks.configured, analysisContext: () => 'context',
  parseRiskRequest: (r: unknown) => r, readRiskMarketSnapshot: async () => null, normalizeRiskInputs: mocks.normalize }));
import { createOptionRiskReportTool } from '../src/tools/option_risk_report.js';
const id = '00000000-0000-4000-8000-000000000001';
const context = { userId: 'trusted-owner', origin: 'user' } as WebRunContext;
export function reportFixture(): RiskAnalysis {
  return { id, status: 'partial', analysisContextId: 'context', portfolioRevision: '12', generatedAt: '2026-10-16T12:00:00Z', marketAsOf: '2026-10-16T11:00:00Z', marketSnapshotId: 'market', metadataVersion: '1',
    model: { id: 'quantlib', version: ENGINE_VERSION, measure: 'conditional' }, scope: { accountIds: ['ibkr'], currencies: ['USD', 'HKD'], horizonTradingDays: 5 },
    capabilities: { stress: true, greeks: true, forecast: false, actions: false },
    coverage: { totalContracts: 2, supportedContracts: 1, totalQuantity: 3, supportedQuantity: 2, exclusions: [{ id: '<script>bad</script>', quantity: 1, reason: 'Missing contract metadata' }] },
    metrics: { stressLoss: { value: null, unit: 'mixed', reason: 'Currencies are separate' }, dollarDelta: { value: 120, unit: 'USD' }, expectedShortfall: { value: null, unit: 'USD', reason: 'Forecast unavailable' } },
    scenarios: [{ id: 'down', spotShock: -.1, volatilityPointShock: 5, optionPnl: null, combinedPnl: null, byCurrency: [{ currency: 'USD', optionPnl: -250, combinedPnl: -1000 }, { currency: 'HKD', optionPnl: -500, combinedPnl: -600 }] }],
    contributors: [{ id: 'AAPL-put', accountId: 'ibkr', currency: 'USD', dollarDelta: 120, vega: 5, theta: -2 }],
    funding: [{ accountId: 'ibkr', currency: 'USD', grossPutFunding: 10000, callShares: 0, delivery: [], availableShares: 0, cash: null, cashAsOf: null, fundingGap: null }],
    payoffBounds: [{ accountId: 'ibkr', currency: 'USD', underlying: 'AAPL', expiryAt: '2027-01-15', minPnl: -9900, maxPnl: 100, unlimitedLoss: false, unlimitedGain: false }],
    forecast: { status: 'unavailable', reason: 'Insufficient history', model: { id: 'physical', version: '1', measure: 'physical' }, seed: 1, paths: 0,
      validation: { status: 'insufficient', reason: 'Missing paired IV history' } as any,
      coverage: { totalPositions: 2, supportedPositions: 0, exclusions: [{ id: 'AAPL-put', reason: 'Missing IV observations' }] }, metrics: [], assumptions: ['No fabricated probability'] },
    actions: [], assumptions: ['Conditional shocks have no probabilities'], diagnostics: null };
}
async function call(params: Record<string, unknown> = { result_id: id }, ctx = context) {
  return runWithWebRunContext(ctx, () => createOptionRiskReportTool().execute('call', params, undefined, undefined as any));
}
beforeEach(() => {
  mocks.enabled.mockReturnValue(true); mocks.configured.mockReturnValue(true);
  mocks.resolve.mockResolvedValue({ state: { user: { id: 'trusted-owner' }, profile: { display_name: 'Investor' } }, revision: 12 });
  mocks.get.mockResolvedValue({ id, status: 'complete', result: reportFixture() });
  mocks.publish.mockResolvedValue({ filename: `risk-scenarios-${id}.html`, sessionUrl: 'https://example.test/api/files/risk.html/view', viewUrl: 'https://example.test/api/files/risk.html/view?t=token', expiresInMs: 60000 });
  mocks.normalize.mockReturnValue({ coverage: { totalContracts: 2 } });
});
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it('renders escaped snapshots, separate currencies, missing forecasts and unknown cash', () => {
  const html = buildOptionRiskReport(reportFixture(), '<img onerror=alert(1)>');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  for (const text of ['USD -250', 'HKD -500', 'Insufficient history', 'Missing paired IV history', 'Missing IV observations', 'Funding gap', 'Unavailable', 'more than 15 minutes old', 'Conditional shocks have no forecast probabilities']) expect(html).toContain(text);
});
it('publishes the trusted owner result through the framework and returns the sidebar session URL', async () => {
  const result = await call();
  expect(mocks.resolve).toHaveBeenCalledWith({ user_id: 'trusted-owner' });
  expect(mocks.get).toHaveBeenCalledWith('trusted-owner', id);
  expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'trusted-owner', filename: `risk-scenarios-${id}.html` }));
  expect(result.details).toMatchObject({ status: 'published', result_id: id, sessionUrl: 'https://example.test/api/files/risk.html/view' });
  expect(result.content[0]).toMatchObject({ text: expect.stringContaining('https://example.test/api/files/risk.html/view') });
});
it('blocks incognito, owner mismatch, disabled configuration and foreign/missing results', async () => {
  expect((await call({}, { ...context, incognito: true })).details).toBeNull();
  expect((await call({ user_id: 'other', result_id: id })).details).toBeNull();
  mocks.enabled.mockReturnValue(false); expect((await call()).details).toBeNull();
  mocks.enabled.mockReturnValue(true); mocks.configured.mockReturnValue(false); expect((await call()).details).toBeNull();
  mocks.configured.mockReturnValue(true); mocks.get.mockResolvedValue(null); expect((await call()).details).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('refuses unsupported versions, failed jobs and conflicting saved-result scope', async () => {
  mocks.get.mockResolvedValue({ id, status: 'complete', result: { ...reportFixture(), model: { version: 'old' } } });
  expect((await call()).details).toBeNull();
  mocks.get.mockResolvedValue({ id, status: 'failed', error: 'Worker failed' });
  expect((await call()).content[0]).toMatchObject({ text: 'Worker failed' });
  expect((await call({ result_id: id, horizon_trading_days: 21 })).details).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('enqueues fresh account-scoped calculations with the same market collection pipeline', async () => {
  mocks.enqueue.mockResolvedValue({ id, status: 'complete', result: reportFixture() });
  await call({ account_ids: ['ibkr'], horizon_trading_days: 21 });
  expect(mocks.enqueue).toHaveBeenCalledWith('trusted-owner', expect.objectContaining({ accountScope: { kind: 'selected', accountIds: ['ibkr'] }, horizonTradingDays: 21 }), expect.objectContaining({ collectMarketData: true }));
  expect(mocks.publish).toHaveBeenCalledOnce();
});
it('returns a resumable pending job without claiming a report exists, then publishes on completion', async () => {
  vi.useFakeTimers();
  mocks.enqueue.mockResolvedValue({ id, status: 'queued' });
  mocks.get.mockResolvedValue({ id, status: 'running' });
  const pending = call({});
  await vi.advanceTimersByTimeAsync(11_000);
  expect((await pending).details).toEqual({ status: 'running', result_id: id });
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue({ id, status: 'complete', result: reportFixture() });
  expect((await call()).details).toMatchObject({ status: 'published' });
});
it('warns when exporting an analysis from an older portfolio revision', () => {
  expect(buildOptionRiskReport(reportFixture(), 'Investor', '13')).toContain('Portfolio has changed since this analysis');
});
it('renders qualified forecasts and indicative action costs with quote age and unknown depth', () => {
  const r = reportFixture();
  const forecast = { currency: 'USD', var: 200, expectedShortfall: 300, probabilityOfProfit: .6, expectedPnl: 20,
    confidenceLevel: .95, horizonTradingDays: 5 as const, samplingInterval: { lower: 250, upper: 350, confidence: .95, method: 'bootstrap' } };
  r.forecast = { ...r.forecast, status: 'ready', reason: '', metrics: [forecast] };
  r.actions = [{ id: 'hedge', kind: 'hedge', status: 'ready', label: 'Buy protection', accountId: 'ibkr', contractId: 'AAPL-put', currency: 'USD', reason: 'Indicative only',
    initialCashFlow: -50, estimatedInitialFees: 2, stressLoss: 100, funding: 'sufficient', liquidity: 'unknown',
    quote: { bid: 40, ask: 50, bidSize: null, askSize: null, quoteAsOf: null, fetchedAt: '2026-10-16T11:00:00Z', source: '<broker>' },
    costModel: { basis: 'estimate', currency: 'USD', feePerContract: 1, minimumOrderFee: 2, slippageBps: 5, reference: 'Estimated fees' },
    scenarios: [{ id: 'down', pnl: -100 }], forecast }];
  const html = buildOptionRiskReport(r, 'Investor');
  for (const text of ['USD 300', '60%', 'Buy protection', 'USD -50', 'Displayed size: unknown / unknown', 'Quote as of: Unavailable', '&lt;broker&gt;', 'slippage 5 bps', 'USD -100']) expect(html).toContain(text);
});
