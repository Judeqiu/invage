import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGetPortfolioTool } from '../src/tools/portfolio.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import { fetchFxRates } from '../src/market/fetch-fx.js';
import type { HouseholdInvestorState } from '../src/state/household-state.js';

vi.mock('../src/tools/channel.js', async original => ({
  ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
vi.mock('../src/market/fetch-fx.js', () => ({ fetchFxRates: vi.fn() }));

function investor(): HouseholdInvestorState {
  return { user: { id: 'test-user', created_at: '2026-10-21' },
    profile: { display_name: 'Test', contact_email: '' }, log: [],
    portfolio: { RKLB: { currency: 'USD', units: 10, avg_price: 50 } },
    cash: [{ amount: 100, currency: 'USD', channel: 'ibkr', updated_at: '2026-10-21' },
      { amount: 200, currency: 'SGD', channel: 'tiger', updated_at: '2026-10-21' }] };
}
const read = () => createGetPortfolioTool().execute('read', { user_id: 'test-user' });
const text = (result: Awaited<ReturnType<typeof read>>) => JSON.stringify(result.content);

describe('portfolio read currency and partial availability', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses the dashboard USD default for mixed cash without mutating treasury, with one FX valuation', async () => {
    const state = investor();
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    vi.mocked(fetchFxRates).mockResolvedValue({ SGD: 0.75 });
    const result = await read();
    expect(result.details).toMatchObject({ portfolio: state.portfolio, cashes: state.cash,
      cash: { amount: 250, currency: 'USD' }, reporting_currency: 'USD',
      fx_applied: true, fx_rates: { SGD: 0.75 }, cash_total_error: null });
    expect(text(result)).toContain('Total cash: 250.00 USD');
    expect(text(result)).toContain('Reporting currency: USD');
    expect(text(result)).toContain('Assignment funding must use the relevant account');
    expect(fetchFxRates).toHaveBeenCalledExactlyOnceWith(['SGD', 'USD'], 'USD');
    expect(state.treasury).toBeUndefined();
  });

  it('honors a saved reporting currency', async () => {
    const state = investor();
    state.treasury = { reporting_currency: 'SGD', updated_at: '2026-10-21' };
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    vi.mocked(fetchFxRates).mockResolvedValue({ USD: 1.3 });
    const result = await read();
    expect(result.details).toMatchObject({ cash: { amount: 330, currency: 'SGD' }, reporting_currency: 'SGD' });
    expect(text(result)).toContain('Total cash: 330.00 SGD');
  });

  it('preserves holdings, trade evidence and native balances when cash FX fails', async () => {
    const state = investor();
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    vi.mocked(fetchFxRates).mockRejectedValue(new Error('FX provider unavailable'));
    const result = await read();
    expect(result.details).toMatchObject({ portfolio: state.portfolio, cashes: state.cash,
      cash: null, cash_total_error: 'FX provider unavailable', option_trade_evidence: { positions: {} } });
    expect(text(result)).toContain('RKLB');
    expect(text(result)).toContain('200.00 SGD');
    expect(text(result)).toContain('Cash total unavailable: FX provider unavailable');
    expect(text(result)).not.toContain('Short-put assignment cover:');
  });

  it('keeps converted cash when a foreign deposit cannot be valued', async () => {
    const state = investor();
    state.cash = [state.cash![0]];
    state.deposits = [{ id: 'fd', amount: 100, currency: 'SGD', interest: 2,
      start_date: '2026-01-01', end_date: '2027-01-01', updated_at: '2026-10-21' }];
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    vi.mocked(fetchFxRates).mockRejectedValue(new Error('SGD FX unavailable'));
    const result = await read();
    expect(result.details).toMatchObject({ cash: { amount: 100, currency: 'USD' },
      cash_total_error: null, deposits: state.deposits, deposit_total: null, deposit_total_error: 'SGD FX unavailable' });
    expect(text(result)).toContain('Deposit total unavailable: SGD FX unavailable');
    expect(text(result)).toContain('100.00 SGD');
  });
});
