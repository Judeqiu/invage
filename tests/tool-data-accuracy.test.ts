import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { HouseholdInvestorState } from '../src/state/household-state.js';
import type { Holding } from '../src/market/types.js';
import { yf } from '../src/market/yf-client.js';
import { snapshotFromYahooQuote, pickCurrentPrice } from '../src/market/fetch-prices.js';
import { fetchYahooContractMark } from '../src/market/fetch-option-marks.js';
import { formatContractInsight, loadOptionsChain, buildContractInsight, putCallOpenInterestRatio } from '../src/market/options-insight.js';
import { createQuoteTool } from '../src/tools/quote.js';
import { createOptionsInsightTool } from '../src/tools/options_insight.js';
import { createGetPortfolioTool } from '../src/tools/portfolio.js';
import { createHouseholdReadTools, portfolioCostBasis } from '../src/tools/household.js';
import { createOpportunityCostTool } from '../src/tools/opportunity_cost.js';
import { createReadBrokerRawTool } from '../src/tools/broker_ingest.js';
import { createSendReportTool } from '../src/tools/send_report.js';
import { reportFilename } from '../src/tools/report-filename.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import { readBrokerRawFile } from '../src/brokers/parser-store.js';

vi.mock('../src/market/yf-client.js', () => ({ yf: { quote: vi.fn(), options: vi.fn() } }));
vi.mock('../src/tools/channel.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
vi.mock('../src/brokers/parser-store.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/brokers/parser-store.js')>(), readBrokerRawFile: vi.fn(),
}));

const option: Holding = { instrument: 'option', channel: 'tiger', currency: 'USD', units: 2, avg_price: 30,
  option: { underlying: 'TSLA  261218P00375000', right: 'put', side: 'short', strike: 375,
    expiry: '2026-12-18', multiplier: 10, settlement: 'physical', mark: 20 } };
function investor(portfolio: Record<string, Holding> = {}): InvestorState {
  return { user: { id: '11111111-2222-4333-8444-555555555555', created_at: '2026-01-01' },
    profile: { display_name: 'Test', contact_email: 'test@example.com' }, log: [], portfolio };
}
const row = { strike: 375, expiration: '2026-12-18', lastPrice: 2, bid: 1, ask: 3,
  contractSymbol: 'TSLA261218P00375000', openInterest: 10, impliedVolatility: 0.3 };
function quote() { return { symbol: 'TSLA', regularMarketPrice: 380.123456, regularMarketPreviousClose: 375,
  regularMarketTime: new Date('2026-10-09T20:00:00Z'), marketState: 'CLOSED', currency: 'USD' }; }
function chain() { return { expirationDates: ['2026-12-18'], options: [
  { expirationDate: '2026-12-18', calls: [row], puts: [row] },
 ] }; }
function text(r: { content: Array<{ type: string; text?: string }> }) { return r.content.map(c => c.text ?? '').join('\n'); }

describe('tool data accuracy regressions', () => {
  it('keeps report filenames inside the authenticated user folder', () => {
    expect(reportFilename('report-2026-10-10.html')).toBe('report-2026-10-10.html');
    for (const name of ['../other/report.html', '/tmp/report.html', '..\\other\\report.html', 'snapshots.json', 'a\0.html']) {
      expect(() => reportFilename(name)).toThrow(/single .html filename/);
    }
  });
  it('uses the authenticated web user for auto-report mode without sending email', async () => {
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state: investor(), revision: 1 });
    const result = await createSendReportTool().execute('report', { user_id: 'context-user', to: 'test@example.com' });
    expect(resolveInvestorFromChannel).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'context-user' }));
    expect(text(result)).toContain('No portfolio saved');
  });
  beforeEach(() => {
    vi.mocked(yf.quote).mockResolvedValue(quote() as never);
    vi.mocked(yf.options).mockResolvedValue(chain() as never);
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state: investor(), revision: 1 });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('preserves source precision, rejects infinity, and labels missing quote currency', () => {
    expect(snapshotFromYahooQuote('TSLA', quote()).price).toBe(380.123456);
    expect(snapshotFromYahooQuote('TSLA', { regularMarketPrice: 5 }).currency).toBe('UNKNOWN');
    expect(() => pickCurrentPrice({ regularMarketPrice: Infinity })).toThrow(/No usable price/);
  });

  it('does not call a previous-close fallback a live price and does not hide a failed holdings read', async () => {
    vi.mocked(yf.quote).mockResolvedValue({ symbol: 'TSLA', regularMarketPreviousClose: 375, currency: 'USD' } as never);
    vi.mocked(resolveInvestorFromChannel).mockRejectedValue(new Error('Account unavailable'));
    const result = await createQuoteTool().execute('q', { tickers: 'TSLA', user_id: 'context-user' });
    expect(text(result)).not.toContain('Price (LIVE)');
    expect(text(result)).toContain('previous-close fallback is not a live');
    expect(result.details).toMatchObject({ quotes: { TSLA: { priceKind: 'previous_close_fallback', currency: 'USD' } }, portfolio_error: 'Account unavailable' });
  });

  it('refuses holding P/L across unknown or mismatched currencies', async () => {
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state: investor({ TSLA: { currency: 'SGD', units: 1, avg_price: 100 } }), revision: 1 });
    const result = await createQuoteTool().execute('q', { tickers: 'TSLA', user_id: 'context-user' });
    expect(text(result)).toContain('P/L unavailable');
    expect(result.details).toMatchObject({ quotes: { TSLA: { holdingPl: undefined } } });
  });

  it('matches OCC-coded Tiger lots and uses each holding multiplier for P/L', async () => {
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state: investor({ tiger: option }), revision: 1 });
    const result = await createOptionsInsightTool().execute('o', { user_id: 'context-user', underlying: 'TSLA',
      expiry: '2026-12-18', strike: 375, right: 'put', side: 'short', multiplier: 100, include_books: true });
    expect(text(result)).toContain('BOOKS lot tiger');
    expect(text(result)).toContain('selected chain mark 20');
    expect(text(result)).toContain('MTM P/L vs cost 20 USD');
    expect(text(result)).toContain('2026-10-09T20:00:00.000Z');
    expect((result.details as { quote: unknown }).quote).toMatchObject({ marketState: 'CLOSED' });
  });

  it('returns actual near-strike rows in structured chain output', async () => {
    const result = await createOptionsInsightTool().execute('o', { underlying: 'TSLA', expiry: '2026-12-18' });
    expect(result.details).toMatchObject({ snapshot: { calls: [row], puts: [row], atmPutIv: 0.3, putCallOiRatio: 1 } });
  });

  it('fetches canonical option underlyings and rejects a wrong expiry series', async () => {
    await fetchYahooContractMark(option.option!);
    expect(yf.options).toHaveBeenCalledWith('TSLA', { date: '2026-12-18' });
    vi.mocked(yf.options).mockResolvedValue({ expirationDates: ['2026-12-18'], options: [
      { expirationDate: '2026-11-20', calls: [{ ...row, expiration: undefined }], puts: [{ ...row, expiration: undefined }] },
    ] } as never);
    await expect(fetchYahooContractMark(option.option!)).rejects.toThrow(/different option expiry/);
    await expect(loadOptionsChain('TSLA', '2026-12-18')).rejects.toThrow(/matching option series/);
  });

  it('does not invent open interest or mislabel long-call upside', () => {
    expect(putCallOpenInterestRatio([{ openInterest: 10 }], [{}])).toBeNull();
    expect(putCallOpenInterestRatio([{ openInterest: 10 }], [{ openInterest: 0 }])).toBe(0);
    const insight = buildContractInsight({ underlying: 'TSLA', right: 'call', side: 'long', units: 1,
      multiplier: 100, spot: 380, currency: 'USD', asOfYmd: '2026-10-10', expiry: '2026-12-18', row, calls: [row], puts: [row] });
    expect(formatContractInsight(insight)).toContain('max gain: unlimited (long call)');
    expect(formatContractInsight(insight)).not.toContain('naked short call');
  });

  it('refuses an expiry-free chain instead of assigning the requested date to it', async () => {
    vi.mocked(yf.options).mockResolvedValue({ expirationDates: ['2026-12-18'], options: [
      { calls: [{ ...row, expiration: undefined }], puts: [{ ...row, expiration: undefined }] },
    ] } as never);
    await expect(loadOptionsChain('TSLA', '2026-12-18')).rejects.toThrow(/expiry cannot be verified/);
  });

  it('does not add native currencies in get_portfolio or compare them with cash', async () => {
    const state = investor({ a: { units: 1, avg_price: 100, currency: 'USD' }, b: { units: 1, avg_price: 100, currency: 'HKD' } });
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    const result = await createGetPortfolioTool().execute('p', { user_id: 'context-user' });
    expect(text(result)).toContain('combined cost unavailable');
    expect(text(result)).not.toContain('cost basis $200');
  });

  it('converts signed book costs and retains short-option liabilities', () => {
    const state = investor({ us: { currency: 'USD', units: 2, avg_price: 100 }, short: option }) as HouseholdInvestorState;
    state.treasury = { reporting_currency: 'SGD', updated_at: '2026-10-10' };
    state.projection_assumptions = { portfolio_return_annual_pct: 5, inflation_annual_pct: 2, fx: { USD: 1.3 }, updated_at: '2026-10-10' };
    expect(portfolioCostBasis(state)).toBe(182); // (200 - 60) × 1.3
    delete state.portfolio!.us.currency;
    expect(() => portfolioCostBasis(state)).toThrow(/Holding currency/);
  });

  it('keeps household reads useful but suppresses net worth when portfolio currency is unknown', async () => {
    const state = investor({ us: { units: 1, avg_price: 100 } }) as HouseholdInvestorState;
    state.treasury = { reporting_currency: 'SGD', updated_at: '2026-10-10' };
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    const result = await createHouseholdReadTools().find(t => t.name === 'get_household')!.execute('h', { user_id: 'context-user' });
    expect(text(result)).toContain('Portfolio cost basis unavailable');
    expect(text(result)).toContain('Net worth: not computed');
    expect(result.details).not.toBeNull();
  });

  it('rejects a holding-funded opportunity-cost calculation in a different currency', async () => {
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state: investor({ US: { currency: 'USD', units: 1, avg_price: 100 } }), revision: 1 });
    const result = await createOpportunityCostTool().execute('cost', { user_id: 'context-user', holding_key: 'US', years: 1, currency: 'SGD', yield_pct: 3 });
    expect(text(result)).toContain('cannot be matched');
    expect(result.details).toBeNull();
  });

  it('puts raw evidence in model-visible content and explicitly paginates it', async () => {
    vi.mocked(readBrokerRawFile).mockReturnValue({ path: 'raw.xml', text: 'abcdefghij' } as never);
    const tool = createReadBrokerRawTool();
    const first = await tool.execute('raw', { user_id: 'context-user', connector_id: 'ibkr', max_chars: 4 });
    expect(text(first)).toContain('abcd');
    expect(first.details).toMatchObject({ text: 'abcd', next_offset: 4, total_chars: 10 });
    const last = await tool.execute('raw', { user_id: 'context-user', connector_id: 'ibkr', offset: 8, max_chars: 4 });
    expect(last.details).toMatchObject({ text: 'ij', next_offset: null });
  });
});
