import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { HouseholdInvestorState } from '../src/state/household-state.js';

const mocks = vi.hoisted(() => ({
  loadInvestor: vi.fn(), saveInvestor: vi.fn(), loadSessionState: vi.fn(),
  fetchFxRates: vi.fn(), resolvePortfolioMarket: vi.fn(),
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
  readBrokerAccountModel: () => ({ sources: {}, connections: {} }),
}));

import { loadDashboardForSlug } from '../src/webapp/dashboard-data.js';
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
import { liveForDashboardReport } from '../src/report/live-for-report.js';

describe('default portfolio reporting currency', () => {
  let state: HouseholdInvestorState;

  beforeEach(() => {
    vi.clearAllMocks();
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
