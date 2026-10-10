import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQuery } from '../src/data-query/engine.js';
import { createDataQueryTools } from '../src/tools/data_query.js';
import { bindDomainToolsToUser } from '../src/tools/bound-identity.js';
import { resolveInvestorFromChannel } from '../src/tools/channel.js';
import * as factories from '../src/tools/index.js';
import { addBrokerSource, addBrokerAccount } from '../src/brokers/accounts.js';
import { buildFrameworkAgentList } from '../src/agents/framework-agents.js';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';

vi.mock('../src/tools/channel.js', async original => ({
  ...await original<typeof import('../src/tools/channel.js')>(), resolveInvestorFromChannel: vi.fn(),
}));
function execution(id: string, patch: Partial<OptionExecution> = {}): OptionExecution {
  return { channel: 'ibkr', account_id: 'U1', execution_id: id, contract_id: 'c1', executed_at: '2026-09-15T10:00:00',
    underlying: 'TSLA', right: 'put', expiry: '2026-12-18', strike: '375', multiplier: '100', contracts: '1',
    side: 'sell', effect: 'open', currency: 'USD', gross_premium: '0.10', commission: '0', ...patch };
}
function snapshot(): InvestorSnapshot {
  return { revision: 42, state: { user: { id: '11111111-2222-4333-8444-555555555555', created_at: '2026-01-01' },
    profile: { display_name: 'Test', contact_email: '' }, log: [],
    option_executions: [execution('1', { gross_premium: '9007199254740993.01', commission: null }),
      execution('2', { executed_at: '2026-09-16T12:00:00', gross_premium: '0.02' }),
      execution('3', { executed_at: '2026-09-04T12:00:00', currency: 'HKD', channel: 'tiger', account_id: 'T1', gross_premium: '10.05' })],
    portfolio: {}, cash: [{ channel: 'ibkr', currency: 'USD', amount: 0.1, updated_at: '2026-10-10' },
      { channel: 'tiger', currency: 'USD', amount: 0.2, updated_at: '2026-10-10' }],
  } };
}
const queryTool = () => createDataQueryTools().find(t => t.name === 'query_data')!;
const text = (r: { content: Array<{ type: string; text?: string }> }) => r.content.map(c => c.text ?? '').join('');

describe('discoverable read-only data queries', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(resolveInvestorFromChannel).mockResolvedValue(snapshot()); });

  it('queries reconciled current opening ranges without treating expired dates or another account as opens', () => {
    const s = snapshot();
    const source = addBrokerSource(s.state, 'ibkr', { token: 'secret' });
    const account = addBrokerAccount(s.state, { source_id: source, account_id: 'U1', label: 'IBKR', config: { activity_query_id: '123' } });
    (s.state.broker_connections![account] as { channel: string }).channel = 'ibkr';
    s.state.portfolio = { lot: { instrument: 'option', channel: 'ibkr', currency: 'USD', units: 2, avg_price: 500,
      broker_ref: { native_id: 'c1' }, option: { underlying: 'TSLA', right: 'put', side: 'short', strike: 375,
        expiry: '2026-12-18', multiplier: 100, settlement: 'physical', mark: 200 } } };
    expect(runQuery(s, { from: 'positions', select: ['key', 'opened_from', 'opened_to', 'expiry', 'opening_status'] }).rows)
      .toEqual([{ key: 'lot', opened_from: '2026-09-15', opened_to: '2026-09-16', expiry: '2026-12-18', opening_status: 'matched' }]);
    s.state.option_executions = s.state.option_executions!.map(e => ({ ...e, account_id: 'WRONG' }));
    expect(runQuery(s, { from: 'positions', select: ['opening_status', 'opened_from'] }).rows)
      .toEqual([{ opening_status: 'unverified', opened_from: null }]);
  });

  it('queries every documented dataset using its dictionary fields', () => {
    const s = snapshot();
    for (const from of ['positions', 'option_executions', 'option_events', 'broker_accounts', 'cash_balances', 'deposits', 'properties', 'liabilities', 'cash_flows']) {
      expect(runQuery(s, { from }).from).toBe(from);
    }
  });

  it('constructs custom nested trade filters and sorts by an unselected field', () => {
    const result = runQuery(snapshot(), { from: 'option_executions', select: ['execution_id', 'trade_date'],
      where: { all: [{ field: 'trade_date', op: 'gte', value: '2026-09-10' }, { any: [
        { field: 'underlying', op: 'eq', value: 'TSLA' }, { field: 'underlying', op: 'eq', value: 'AAPL' },
      ] }, { not: { field: 'effect', op: 'eq', value: 'close' } }] },
      order_by: [{ field: 'executed_at', direction: 'desc' }] });
    expect(result.rows).toEqual([{ execution_id: '2', trade_date: '2026-09-16' }, { execution_id: '1', trade_date: '2026-09-15' }]);
    expect(result).toMatchObject({ revision: 42, matched_source_rows: 2, source_rows: 3, next_offset: null });
  });

  it('aggregates the full filtered dataset before limiting pages, without losing decimal precision', () => {
    const query = { from: 'option_executions', group_by: ['currency'], aggregates: [
      { op: 'sum', field: 'gross_premium', as: 'gross' }, { op: 'count', as: 'records' },
      { op: 'sum', field: 'net_premium', as: 'net' },
    ], order_by: [{ field: 'currency', direction: 'desc' }], limit: 1 };
    const first = runQuery(snapshot(), query);
    expect(first.rows).toEqual([{ currency: 'USD', gross: '9007199254740993.03', records: 2, net: null }]);
    expect(first).toMatchObject({ total_rows: 2, next_offset: 1, aggregation_missing_values: { net: 1 } });
    const second = runQuery(snapshot(), { ...query, offset: first.next_offset, expected_revision: first.revision });
    expect(second.rows).toEqual([{ currency: 'HKD', gross: '10.05', records: 1, net: '10.05' }]);
  });

  it('sorts exact decimals numerically, including negative values', () => {
    const s = snapshot(); s.state.option_executions = [execution('a', { gross_premium: '10' }), execution('b', { gross_premium: '2' }),
      execution('c', { gross_premium: '-20', side: 'buy' }), execution('d', { gross_premium: '-3', side: 'buy' })];
    expect(runQuery(s, { from: 'option_executions', select: ['gross_premium'], order_by: [{ field: 'gross_premium' }] }).rows)
      .toEqual([{ gross_premium: '-20' }, { gross_premium: '-3' }, { gross_premium: '2' }, { gross_premium: '10' }]);
  });

  it('sums stored numeric cash as exact decimal text', () => {
    expect(runQuery(snapshot(), { from: 'cash_balances', group_by: ['currency'], aggregates: [{ op: 'sum', field: 'amount', as: 'cash_total' }] }).rows)
      .toEqual([{ currency: 'USD', cash_total: '0.3' }]);
  });

  it('keeps missing datasets unknown and distinguishes explicitly empty stored collections', () => {
    const s = snapshot(); delete s.state.option_executions;
    const query = { from: 'option_executions', aggregates: [{ op: 'count', as: 'records' }] };
    expect(runQuery(s, query)).toMatchObject({ available: false, rows: [], source_rows: null, total_rows: null });
    s.state.option_executions = [];
    expect(runQuery(s, query)).toMatchObject({ available: true, rows: [{ records: 0 }], source_rows: 0, total_rows: 1 });
  });

  it('preserves unknowns through NOT and supports explicit null predicates', () => {
    const s = snapshot();
    expect(runQuery(s, { from: 'option_executions', where: { not: { field: 'commission', op: 'eq', value: '0' } } }).rows).toEqual([]);
    expect(runQuery(s, { from: 'option_executions', select: ['execution_id'], where: { field: 'commission', op: 'is_null' } }).rows).toEqual([{ execution_id: '1' }]);
    expect(runQuery(s, { from: 'option_executions', aggregates: [{ op: 'count', field: 'commission', as: 'reported_fees' }] }).rows).toEqual([{ reported_fees: 2 }]);
  });

  it('requires revision-pinned pagination and refuses changed revisions', () => {
    const s = snapshot();
    expect(() => runQuery(s, { from: 'option_executions', offset: 1 })).toThrow(/requires expected_revision/);
    expect(() => runQuery(s, { from: 'option_executions', offset: 1, expected_revision: 41 })).toThrow(/revision changed/);
    expect(() => runQuery(s, { from: 'option_executions', expected_revision: 41 })).toThrow(/revision changed/);
  });

  it('refuses mixed-currency totals and sums of incompatible units or rates', () => {
    for (const query of [
      { from: 'option_executions', aggregates: [{ op: 'sum', field: 'gross_premium', as: 'total' }] },
      { from: 'option_executions', aggregates: [{ op: 'max', field: 'gross_premium', as: 'highest' }] },
      { from: 'positions', aggregates: [{ op: 'sum', field: 'units', as: 'units_total' }] },
      { from: 'option_executions', aggregates: [{ op: 'sum', field: 'strike', as: 'strike_total' }] },
    ]) expect(() => runQuery(snapshot(), query)).toThrow(/requires group_by|not safely summable/);
  });

  it('provides min/max and ordering on aggregate aliases', () => {
    const result = runQuery(snapshot(), { from: 'option_executions', group_by: ['currency'], aggregates: [
      { op: 'min', field: 'trade_date', as: 'first' }, { op: 'max', field: 'trade_date', as: 'last' },
    ], order_by: [{ field: 'last', direction: 'desc' }] });
    expect(result.rows).toEqual([{ currency: 'USD', first: '2026-09-15', last: '2026-09-16' }, { currency: 'HKD', first: '2026-09-04', last: '2026-09-04' }]);
  });

  it('validates fields, types, dates, and operations even when no records exist', () => {
    const s = snapshot(); s.state.option_executions = [];
    for (const query of [
      { from: '__proto__' }, { from: 'users' }, { from: 'option_executions', sql: 'DROP TABLE users' },
      { from: 'option_executions', select: ['credentials'] },
      { from: 'option_executions', where: { field: 'trade_date', op: 'gte', value: '2026-02-30' } },
      { from: 'option_executions', where: { field: 'strike', op: 'gte', value: 375 } },
      { from: 'option_executions', where: { field: 'commission', op: 'eq', value: null } },
      { from: 'option_executions', where: { field: 'trade_date', op: 'execute', value: '2026-10-10' } },
      { from: 'option_executions', aggregates: [{ op: 'count', as: '__proto__' }] },
    ]) expect(() => runQuery(s, query)).toThrow();
  });

  it('bounds filters, rows, inputs, and output without silent truncation', () => {
    let filter: unknown = { field: 'effect', op: 'eq', value: 'open' };
    for (let i = 0; i < 10; i++) filter = { not: filter };
    expect(() => runQuery(snapshot(), { from: 'option_executions', where: filter })).toThrow(/complexity/);
    expect(() => runQuery(snapshot(), { from: 'option_executions', limit: 201 })).toThrow(/limit must/);
    expect(() => runQuery(snapshot(), { from: 'option_executions', where: { field: 'underlying', op: 'eq', value: 'x'.repeat(21000) } })).toThrow(/input limit/);
    const s = snapshot(); s.state.option_executions = Array.from({ length: 200 }, (_, i) => execution(String(i), { account_id: 'U' + '1'.repeat(500) }));
    expect(() => runQuery(s, { from: 'option_executions', limit: 200 })).toThrow(/Output exceeds/);
    expect(runQuery(s, { from: 'option_executions', select: ['execution_id'], limit: 200 }).rows).toHaveLength(200);
  });

  it('returns a dictionary with field semantics, availability, operators and example queries', async () => {
    const result = await createDataQueryTools()[0].execute('dictionary', { user_id: snapshot().state.user.id });
    expect(result.details).toMatchObject({ revision: 42, datasets: {
      option_executions: { available: true, fields: { trade_date: { type: 'date' }, net_premium: { sum_group_by: ['currency'] } } },
      option_events: { available: false }, positions: { fields: { avg_price: { description: expect.stringContaining('CONTRACT') } } },
    } });
    expect(text(result)).toContain('timezone');
    expect(text(result)).not.toContain('auth_token');
  });

  it('never exposes broker credentials/config or unrelated user state', async () => {
    const s = snapshot(); s.state.broker_connections = { ibkr: { enabled: true, credentials: { token: 'SECRET_TOKEN', activity_query_id: '123' } } };
    vi.mocked(resolveInvestorFromChannel).mockResolvedValue(s);
    const result = await queryTool().execute('accounts', { query: { from: 'broker_accounts' } });
    expect(text(result)).not.toContain('SECRET_TOKEN');
    expect(result.details).not.toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('credentials'); expect(serialized).not.toContain('activity_query_id');
  });

  it('binds both query and dictionary to the actual authenticated user', async () => {
    const tools = bindDomainToolsToUser(createDataQueryTools(), 'actual-user');
    await tools[0].execute('dictionary', { user_id: 'victim', telegram_user_id: 123 });
    await tools[1].execute('query', { user_id: 'victim', slack_user_id: 'victim-slack', query: { from: 'cash_balances' } });
    expect(resolveInvestorFromChannel).toHaveBeenNthCalledWith(1, expect.objectContaining({ user_id: 'actual-user', telegram_user_id: undefined }));
    expect(resolveInvestorFromChannel).toHaveBeenNthCalledWith(2, expect.objectContaining({ user_id: 'actual-user', slack_user_id: undefined }));
  });

  it('is read-only and leaves the loaded state intact', async () => {
    const s = snapshot(); const before = JSON.stringify(s);
    runQuery(s, { from: 'option_executions', order_by: [{ field: 'gross_premium' }] });
    expect(JSON.stringify(s)).toBe(before);
    const result = await queryTool().execute('invalid', { query: { from: 'option_executions', update: {} } });
    expect(result.details).toBeNull(); expect(text(result)).toContain('Unknown query key');
  });

  it('makes discovery and querying available to every registered domain role', () => {
    for (const [name, factory] of Object.entries(factories)) {
      if (!/^create.*Tools$/.test(name)) continue;
      const names = factory().map(t => t.name);
      expect(names).toContain('get_data_dictionary'); expect(names).toContain('query_data');
      expect(new Set(names).size).toBe(names.length);
    }
    expect(buildFrameworkAgentList('full').every(a => a.extension.purpose.includes('get_data_dictionary'))).toBe(true);
  });
});
