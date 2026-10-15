import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { HouseholdInvestorState } from '../src/state/household-state.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

const mocks = vi.hoisted(() => ({
  loadInvestor: vi.fn(), saveInvestor: vi.fn(), loadSessionState: vi.fn(),
  fetchFxRates: vi.fn(), resolvePortfolioMarket: vi.fn(),
  readBrokerAccountModel: vi.fn(),
}));

vi.mock('../src/state/investor-store.js', () => ({
  loadInvestor: mocks.loadInvestor, saveInvestor: mocks.saveInvestor,
}));
vi.mock('utarus', async importOriginal => ({
  ...await importOriginal<typeof import('utarus')>(),
  loadSessionState: mocks.loadSessionState,
}));
vi.mock('../src/market/index.js', () => ({
  fetchFxRates: mocks.fetchFxRates, resolvePortfolioMarket: mocks.resolvePortfolioMarket,
  equityQuoteSymbols: vi.fn(() => []), fetchPrices: vi.fn(), fetchHistoricalCloses: vi.fn(),
}));
vi.mock('../src/market/fetch-fx.js', () => ({ fetchFxRates: mocks.fetchFxRates }));
vi.mock('../src/state/snapshot.js', () => ({ loadSnapshots: () => [] }));
vi.mock('../src/brokers/accounts.js', () => ({
  readBrokerAccountModel: mocks.readBrokerAccountModel,
}));
vi.mock('../src/brokers/sync-history.js', () => ({ latestSuccessfulBrokerSyncRun: () => null }));

import { loadDashboardForSlug } from '../src/webapp/dashboard-data.js';
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
import { liveForDashboardReport } from '../src/report/live-for-report.js';

describe('default portfolio reporting currency', () => {
  let state: HouseholdInvestorState;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBrokerAccountModel.mockReturnValue({ sources: {}, connections: {} });
    state = {
      user: { id: '00000000-0000-4000-8000-000000000099', slug: 'judetest1',
        created_at: '2026-10-09', telegram_user_ids: [], auth_token: 'test-token' },
      profile: { display_name: 'Test', contact_email: 'test@example.com' }, log: [],
      portfolio: { AAPL: { avg_price: 100, units: 2, currency: 'USD', channel: 'ibkr' } },
      cash: [
        { amount: 1000, currency: 'USD', channel: 'ibkr', updated_at: '2026-10-09' },
        { amount: 2000, currency: 'SGD', channel: 'ibkr', updated_at: '2026-10-09' },
      ],
    } as HouseholdInvestorState;
    const snapshot = { state, revision: 1 };
    mocks.loadInvestor.mockResolvedValue(snapshot);
    mocks.loadSessionState.mockResolvedValue(snapshot);
    mocks.resolvePortfolioMarket.mockResolvedValue({ portfolio: state.portfolio,
      equityPrices: { AAPL: 110 }, optionMarks: {} });
    mocks.fetchFxRates.mockImplementation(async (_currencies, reportingCurrency) =>
      reportingCurrency === 'USD' ? { SGD: 0.75 } : { USD: 1.3 });
  });

  function settingsApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { userId: state.user.id } });
      next();
    });
    app.use(createDashboardApiRouter());
    return app;
  }

  it('converts mixed broker cash into USD without a saved preference', async () => {
    const payload = await loadDashboardForSlug('judetest1', undefined, null);
    expect(mocks.fetchFxRates).toHaveBeenCalledWith(['SGD'], 'USD');
    expect(payload.model?.live).toMatchObject({ reportingCurrency: 'USD',
      navComplete: true, cashAmount: 2500, totalValue: 2720 });
    expect(state.treasury).toBeUndefined();
  });

  it('reuses trade results while fetching fresh market prices and FX, and recalculates corrected trades', async () => {
    const investor = state as InvestorState;
    const opening = { channel: 'ibkr', account_id: 'A', execution_id: 'open', contract_id: 'AMD-put-100', executed_at: '2026-08-01T10:00:00',
      underlying: 'AMD', right: 'put' as const, expiry: '2026-09-18', strike: '100', multiplier: '100',
      contracts: '1', currency: 'USD', side: 'sell' as const, effect: 'open' as const, gross_premium: '200', commission: '-1' };
    investor.option_executions = [opening, { ...opening, execution_id: 'close', executed_at: '2026-08-10T10:00:00',
      side: 'buy', effect: 'close', gross_premium: '-50' }];
    const initial = await loadDashboardForSlug(state.user.id, undefined, null);
    expect(initial.optionAnalytics?.profits[0].net).toBe(148);
    expect(initial.model?.live.totalValue).toBe(2720);
    mocks.resolvePortfolioMarket.mockResolvedValue({ portfolio: state.portfolio, equityPrices: { AAPL: 120 }, optionMarks: {} });
    mocks.fetchFxRates.mockResolvedValue({ SGD: 0.8 });
    const refreshed = await loadDashboardForSlug(state.user.id, undefined, null);
    expect(refreshed.optionAnalytics).toEqual(initial.optionAnalytics);
    expect(refreshed.model?.live.totalValue).toBe(2840);
    expect(mocks.resolvePortfolioMarket).toHaveBeenCalledTimes(2);
    expect(mocks.fetchFxRates).toHaveBeenCalledTimes(2);
    investor.option_executions[1].gross_premium = '-100';
    const corrected = await loadDashboardForSlug(state.user.id, undefined, null);
    expect(corrected.optionAnalytics?.profits[0].net).toBe(98);
  });

  it('returns separate fund account totals and an explicit itemized NAV coverage note', async () => {
    const metrics = { as_of: '2026-10-15', currency: 'USD', fund_assets: 1198.16 };
    mocks.readBrokerAccountModel.mockReturnValue({ sources: {}, connections: {
      test: { broker_id: 'moomoo', channel: 'moomoo-test', metrics },
    } });
    const payload = await loadDashboardForSlug('judetest1', undefined, null);
    expect(payload.connectionMetrics?.['moomoo-test']).toEqual(metrics);
    expect(payload.warnings).toContainEqual(expect.objectContaining({
      code: 'broker_fund_details_unavailable', key: 'moomoo-test',
      message: expect.stringContaining('excluded from itemized NAV and P/L'),
    }));
    expect(payload.model?.live.totalValue).toBe(2720);
    expect(payload.model?.live.positions).toHaveLength(1);
    expect(payload.model?.live.channels).toContain('moomoo-test');
  });

  it('does not hide an account with only a recorded fund total as an empty portfolio', async () => {
    state.portfolio = {};
    delete state.cash;
    state.broker_connections = { moomoo: { enabled: true, credentials: {},
      metrics: { as_of: '2026-10-15', currency: 'USD', fund_assets: 1198.16 } } };
    mocks.readBrokerAccountModel.mockReturnValue({ sources: {}, connections: {
      moomoo: { broker_id: 'moomoo', channel: 'moomoo', metrics: state.broker_connections.moomoo.metrics },
    } });
    const payload = await loadDashboardForSlug('judetest1', undefined, null);
    expect(payload.empty).toBe(false);
    expect(payload.connectionMetrics?.moomoo.fund_assets).toBe(1198.16);
    expect(payload.model?.live.positions).toEqual([]);
    expect(payload.warnings?.some(w => w.code === 'broker_fund_details_unavailable')).toBe(true);
  });

  it('honors a saved reporting currency for holdings and cash', async () => {
    state.treasury = { reporting_currency: 'SGD', updated_at: '2026-10-09' };
    const payload = await loadDashboardForSlug('judetest1', undefined, null);
    expect(mocks.fetchFxRates).toHaveBeenCalledWith(['USD'], 'SGD');
    expect(payload.model?.live).toMatchObject({ reportingCurrency: 'SGD',
      navComplete: true, cashAmount: 3300, totalValue: 3586 });
  });

  it('keeps NAV unavailable when real FX is missing, retaining the USD default', async () => {
    mocks.fetchFxRates.mockRejectedValue(new Error('FX unavailable'));
    const payload = await loadDashboardForSlug('judetest1', undefined, null);
    expect(payload.model?.live).toMatchObject({ reportingCurrency: 'USD', navComplete: false });
    expect(payload.warnings?.some(warning => warning.code === 'fx_fetch_failed')).toBe(true);
  });

  it('returns USD to preset Settings and returns an explicitly saved currency', async () => {
    const app = settingsApp();
    expect((await request(app).get('/portfolio-settings').expect(200)).body)
      .toEqual({ reporting_currency: 'USD' });
    state.treasury = { reporting_currency: 'SGD', updated_at: '2026-10-09' };
    expect((await request(app).get('/portfolio-settings').expect(200)).body)
      .toEqual({ reporting_currency: 'SGD' });
  });

  it('allows saving the default explicitly and changing it afterward', async () => {
    const app = settingsApp();
    await request(app).put('/portfolio-settings').send({ reporting_currency: 'USD' }).expect(200);
    expect(mocks.saveInvestor).toHaveBeenCalledOnce();
    expect(state.treasury?.reporting_currency).toBe('USD');
    await request(app).put('/portfolio-settings').send({ reporting_currency: 'SGD' }).expect(200);
    expect(state.treasury?.reporting_currency).toBe('SGD');
  });

  it('uses the same USD default in saved dashboard reports', async () => {
    const live = await liveForDashboardReport(state, state.portfolio!, { AAPL: 110 }, {});
    expect(live).toMatchObject({ reportingCurrency: 'USD', navComplete: true, totalValue: 2720 });
  });
});
