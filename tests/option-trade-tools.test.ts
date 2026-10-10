import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import type { Holding } from '../src/market/types.js';
import { addBrokerSource, addBrokerAccount } from '../src/brokers/accounts.js';
import { createListOptionTradesTool, optionTradeEvidence, queryOptionTrades } from '../src/tools/option_trades.js';
import { createGetPortfolioTool, createPortfolioWriteTools } from '../src/tools/portfolio.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';

vi.mock('../src/tools/channel.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/tools/channel.js')>(),
  resolveInvestorFromChannel: vi.fn(),
}));

const holding: Holding = { instrument: 'option', channel: 'ibkr', units: 1, avg_price: 500,
  broker_ref: { native_id: '123' }, option: { underlying: 'TSLA', right: 'put', side: 'short',
    strike: 375, expiry: '2026-12-18', multiplier: 100, settlement: 'physical', mark: 200 } };
function fill(id: string, date: string, overrides: Partial<OptionExecution> = {}): OptionExecution {
  return { channel: 'ibkr', account_id: 'U1', execution_id: id, contract_id: '123',
    executed_at: `${date}T10:30:00`, underlying: 'TSLA', right: 'put', expiry: '2026-12-18',
    strike: '375', multiplier: '100', contracts: '1', side: 'sell', effect: 'open',
    currency: 'USD', gross_premium: '500', commission: '-1', ...overrides };
}
function investor(records?: OptionExecution[]): InvestorState {
  const s: InvestorState = { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [],
    portfolio: { tsla: holding }, ...(records === undefined ? {} : { option_executions: records }) };
  const source = addBrokerSource(s, 'ibkr', { token: 'never-print-secret' });
  const id = addBrokerAccount(s, { source_id: source, account_id: 'U1', label: 'IBKR', config: { activity_query_id: '111' } });
  (s.broker_connections![id] as { channel: string }).channel = 'ibkr';
  return s;
}

describe('chat option trade evidence', () => {
  it('excludes September 4 from the September 10–October 10 window and paginates all brokers', () => {
    const s = investor([fill('old', '2026-09-04'), fill('start', '2026-09-10'),
      fill('end', '2026-10-10', { channel: 'moomoo', commission: null }),
      fill('after', '2026-10-11'), fill('call', '2026-10-02', { right: 'call' }),
      fill('close', '2026-10-03', { effect: 'close', side: 'buy', gross_premium: '-100' })]);
    const filter = { underlying: 'tsla', right: 'put' as const, effect: 'open' as const,
      start_date: '2026-09-10', end_date: '2026-10-10', limit: 1 };
    const first = queryOptionTrades(s, s.portfolio!, filter);
    expect(first.total).toBe(2);
    expect(first.executions[0]).toMatchObject({ execution_id: 'end', net_premium: null });
    expect(first.next_offset).toBe(1);
    const second = queryOptionTrades(s, s.portfolio!, { ...filter, offset: first.next_offset! });
    expect(second.executions[0].execution_id).toBe('start');
    expect(second.next_offset).toBeNull();
  });

  it('matches the remaining opening after flat/reopen and rejects a different account or quantity gap', () => {
    const rows = [fill('1', '2026-09-04'), fill('2', '2026-09-05', { effect: 'close', side: 'buy', gross_premium: '-100' }),
      fill('3', '2026-10-02')];
    expect(optionTradeEvidence(investor(rows), { tsla: holding }).positions.tsla)
      .toMatchObject({ status: 'matched', openedFrom: '2026-10-02', openedTo: '2026-10-02' });
    expect(optionTradeEvidence(investor([fill('1', '2026-10-02', { account_id: 'U2' })]), { tsla: holding }).positions.tsla.status).toBe('unverified');
    expect(optionTradeEvidence(investor([fill('1', '2026-10-02', { contracts: '2' })]), { tsla: holding }).positions.tsla.status).toBe('unverified');
  });

  it('recognizes Tiger OCC underlyings without losing dates and labels Webull order time', () => {
    const s = investor([]);
    const source = addBrokerSource(s, 'webull', { app_key: 'key', app_secret: 'secret', region: 'us' });
    const id = addBrokerAccount(s, { source_id: source, account_id: 'W1', label: 'Webull', config: {} });
    (s.broker_connections![id] as { channel: string }).channel = 'webull';
    const h = { ...holding, channel: 'tiger', broker_ref: undefined,
      option: { ...holding.option!, underlying: 'TSLA  261218P00375000' } };
    s.option_executions = [fill('1', '2026-10-02', { channel: 'tiger', account_id: 'T1' })];
    const evidence = optionTradeEvidence(s, { tiger: h });
    expect(evidence.positions.tiger).toMatchObject({ status: 'matched', openedFrom: '2026-10-02' });
    expect(evidence.coverage.find(c => c.channel === 'webull')?.timestamp_basis).toMatch(/individual fill dates are unavailable/);
  });

  it('keeps missing versus empty history distinct, includes failures, and never returns credentials', () => {
    const s = investor();
    const c = Object.values(s.broker_connections!)[0];
    c.last_sync = { at: '2026-10-10T00:00:00Z', ok: false, error: 'Lifecycle conflict never-print-secret' };
    const result = queryOptionTrades(s, s.portfolio!, {});
    expect(result.available).toBe(false);
    expect(result.coverage[0].last_sync).toMatchObject({ ok: false, error: 'Lifecycle conflict [redacted]' });
    expect(result.positions.tsla.status).toBe('unverified');
    expect(JSON.stringify(result)).not.toContain('never-print-secret');
    expect(queryOptionTrades(investor([]), {}, {}).available).toBe(true);
  });

  it.each([{ start_date: '2026-02-30' }, { start_date: '2026-10-10', end_date: '2026-09-10' },
    { limit: 201 }, { offset: -1 }])('rejects invalid query %j', filter => {
    expect(() => queryOptionTrades(investor([]), {}, filter)).toThrow();
  });

  it('exposes opening evidence in portfolio tool text and details, and filtered trades in the read tool', async () => {
    const state = investor([fill('1', '2026-09-15')]);
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue({ state, revision: 1 });
    const result = await createGetPortfolioTool().execute('get', { user_id: 'u1' });
    expect(JSON.stringify(result.content)).toContain('2026-09-15');
    expect(result.details).toMatchObject({ option_trade_evidence: { positions: { tsla: { status: 'matched' } } } });
    const trades = await createListOptionTradesTool().execute('trades', { user_id: 'u1', underlying: 'TSLA', effect: 'open' });
    expect(trades.details).toMatchObject({ total: 1, executions: [{ executed_at: '2026-09-15T10:30:00' }] });
    expect(createPortfolioWriteTools().map(t => t.name)).not.toContain('list_option_trades');
  });
});
