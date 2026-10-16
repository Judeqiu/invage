import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analysisContext, normalizeRiskInputs, parseRiskRequest, riskEnabled } from '../src/risk/context.js';
import { readDashboardConfig } from '../src/webapp/dashboard-config.js';
import { validateWorkerOutput } from '../src/risk/service.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import type { RiskMarketSnapshot, RiskRequest } from '../src/risk/types.js';

const file = join(process.env.UTARUS_DATA_ROOT!, 'config/agent-config/invage-dashboard.json');
const snapshot = { revision: 2, state: { user: { id: '00000000-0000-4000-8000-000000000001' },
  portfolio: { 'AAPL-C@ibkr': { instrument: 'option', units: 2, avg_price: 300, channel: 'ibkr', currency: 'USD',
    option: { underlying: 'AAPL', side: 'short', right: 'call', strike: 100, expiry: '2027-01-15', multiplier: 100, settlement: 'physical', mark: 400 } },
  'AAPL@ibkr': { units: 100, avg_price: 80, channel: 'ibkr', currency: 'USD' } } } } as unknown as InvestorSnapshot;
function request(): RiskRequest {
  return { analysisContextId: analysisContext(snapshot)!, accountScope: { kind: 'selected', accountIds: ['ibkr'] }, horizonTradingDays: 5,
    scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh: false };
}
function market(): RiskMarketSnapshot {
  return { id: 'snapshot-1', metadataVersion: 'verified-v1', portfolioRevision: 2, capturedAt: new Date().toISOString(), contracts: [ {
    id: 'AAPL-C@ibkr', underlying: 'AAPL', right: 'call', strike: 100, multiplier: 100, currency: 'USD', exerciseStyle: 'american',
    expiryAt: '2027-01-15T16:00:00-05:00', expiryTimezone: 'America/New_York', deliverable: 'standard-shares', spot: 100, premiumPerContract: 400,
    impliedVolatility: .2, rate: .04, dividends: [], quoteAsOf: new Date().toISOString(), spotAsOf: new Date().toISOString(), source: 'fixture',
    rateReference: 'curve-1', dividendReference: 'confirmed-no-dividends' } ] };
}
afterEach(() => { vi.unstubAllEnvs(); rmSync(file, { force: true }); });
it('defaults off, rereads saved configuration and enables only the consultant profile', () => {
  expect(readDashboardConfig().showOptionRiskModelView).toBe(false);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ show_option_risk_model_view: true }));
  vi.stubEnv('INVAGE_PRODUCT_PROFILE','full'); expect(riskEnabled()).toBe(false);
  vi.stubEnv('INVAGE_PRODUCT_PROFILE','consultant'); expect(riskEnabled()).toBe(true);
  writeFileSync(file, JSON.stringify({ show_option_risk_model_view: false })); expect(riskEnabled()).toBe(false);
});
it('validates bounded request enums, exact fields and account scope', () => {
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  expect(parseRiskRequest(request())).toEqual(request());
  for (const patch of [{ horizonTradingDays: 200 }, { valuation: 123 }, { mode: 'forecast' }, { refresh: 'true' }, { accountScope: { kind: 'all', accountIds: ['ibkr'] } }]) {
    expect(() => parseRiskRequest({ ...request(), ...patch })).toThrow('Invalid analysis request');
  }
});
it('rejects stale revision/account context and keeps missing inputs as exclusions', () => {
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  expect(() => normalizeRiskInputs({ ...snapshot, revision: 3 }, request(), market())).toThrow('Portfolio context changed');
  expect(() => normalizeRiskInputs(snapshot, { ...request(), accountScope: { kind: 'selected', accountIds: ['other'] } }, market())).toThrow('Unknown account scope');
  const missing = normalizeRiskInputs(snapshot, request(), null);
  expect(missing.coverage).toMatchObject({ totalContracts: 1, totalQuantity: 2, supportedContracts: 0 });
  expect(missing.coverage.exclusions[0].reason).toContain('unavailable');
});
it('normalizes risk-only units without mutating books or manufacturing cash', () => {
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  const before = JSON.stringify(snapshot), result = normalizeRiskInputs(snapshot, request(), market());
  expect(result.contracts[0]).toMatchObject({ quantity: 2, shares: 100, premiumPerContract: 400, side: 'short' });
  expect(result.accounts[0].cash).toBeNull();
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('excludes mismatched, invalid and missing dividend metadata', () => {
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  for (const patch of [{ multiplier: 10 }, { quoteAsOf: 'invalid' }, { dividendYield: -.01 }, { dividendYield: NaN }, { dividendReference: '' }, { rate: NaN }]) {
    const m = market(); Object.assign(m.contracts[0], patch);
    expect(normalizeRiskInputs(snapshot, request(), m).coverage.supportedContracts).toBe(0);
  }
});
it('rejects malformed/non-finite worker output', () => {
  expect(() => validateWorkerOutput({ status: 'ready', metrics: { stressLoss: Infinity } })).toThrow();
  expect(() => validateWorkerOutput(null)).toThrow();
});
it.skipIf(!process.env.INVAGE_OPTION_RISK_PYTHON)('runs the real bounded portfolio worker and validates its result envelope', async () => {
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  const { runRiskWorker } = await import('../src/risk/service.js');
  const normalized = normalizeRiskInputs(snapshot, request(), market());
  const result = await runRiskWorker(normalized);
  expect(result.status).toBe('ready');
  expect(result.model.measure).toBe('conditional');
  expect(result.coverage.supportedQuantity).toBe(2);
  expect(result.metrics.expectedShortfall.value).toBeNull();
  expect(result.funding[0].delivery[0]).toMatchObject({ underlying: 'AAPL', requiredShares: 200, availableShares: 100 });
});

it('uses older, unsynchronized quotes without age cutoffs while retaining source times',()=>{
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  const m=market();m.capturedAt='2026-01-01T00:00:00Z';m.contracts[0].quoteAsOf='2026-01-01T00:00:00Z';
  const result=normalizeRiskInputs(snapshot,request(),m);
  expect(result.coverage.supportedContracts).toBe(1);
  expect(result.contracts[0].quoteAsOf).toBe('2026-01-01T00:00:00Z');
  expect(result.valuationDate).toBeDefined();
});

it('uses a stable New York valuation date independent of quote age',()=>{
  vi.stubEnv('INVAGE_OPTION_RISK_CONTEXT_SECRET','test-only');
  const a=normalizeRiskInputs(snapshot,request(),market(),Date.parse('2026-10-16T02:00:00Z'));
  const b=normalizeRiskInputs(snapshot,request(),market(),Date.parse('2026-10-16T02:30:00Z'));
  expect(a.valuationDate).toBe('2026-10-15');expect(b.valuationDate).toBe(a.valuationDate);
});
