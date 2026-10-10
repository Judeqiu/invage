import { describe, expect, it, vi } from 'vitest';
import { createPortfolioAnalyzerTool } from '../src/tools/portfolio_analyzer.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import { resolvePortfolioMarket } from '../src/market/index.js';
import { fetchFxRates } from '../src/market/fetch-fx.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

vi.mock('../src/tools/channel.js', async original => ({
  ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
vi.mock('../src/market/index.js', async original => ({
  ...await original<typeof import('../src/market/index.js')>(), resolvePortfolioMarket: vi.fn(),
}));
vi.mock('../src/market/fetch-fx.js', () => ({ fetchFxRates: vi.fn() }));

describe('portfolio analyzer reporting currency', () => {
  it('converts option liabilities and mixed broker cash with one FX valuation', async () => {
    const option = { instrument: 'option' as const, channel: 'ibkr', units: 2, avg_price: 30,
      option: { underlying: 'TSLA', right: 'put' as const, side: 'short' as const, strike: 375,
        expiry: '2026-12-18', multiplier: 10, settlement: 'physical' as const, mark: 20 } };
    const state: InvestorState = { user: { id: '11111111-2222-4333-8444-555555555555', created_at: '2026-01-01' },
      profile: { display_name: 'Test', contact_email: '' }, log: [],
      portfolio: { us: { ...option, currency: 'USD' }, sg: { ...option, currency: 'SGD' } },
      cash: [{ amount: 100, currency: 'USD', channel: 'ibkr', updated_at: '2026-10-10' },
        { amount: 100, currency: 'SGD', channel: 'tiger', updated_at: '2026-10-10' }] };
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    vi.mocked(resolvePortfolioMarket).mockResolvedValue({ portfolio: state.portfolio!, equityPrices: {}, optionMarks: {} });
    vi.mocked(fetchFxRates).mockResolvedValue({ SGD: 0.75 });
    const result = await createPortfolioAnalyzerTool().execute('analysis', { user_id: state.user.id });
    expect(result.details).toMatchObject({ reportingCurrency: 'USD', positionsValue: -70,
      cash: { amount: 175, currency: 'USD' }, totalNav: 105, fxRates: { SGD: 0.75 } });
    expect(fetchFxRates).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Aggregate currency: USD') })]));
  });
});
