import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import {
  addBrokerAccount, addBrokerSource, ibkrStatements, patchBrokerAccount, previewBrokerAccount, publicBrokerAccounts,
  persistBrokerAccountModel, readBrokerAccountModel, resolveBrokerAccountId,
} from '../src/brokers/accounts.js';
import { adapters } from '../src/brokers/adapter.js';

function investor(over: Partial<InvestorState> = {}): InvestorState {
  return {
    user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' },
    log: [], ...over,
  };
}
function flex(id: string, cash: number): string {
  return `<FlexStatement accountId="${id}" fromDate="20260925" toDate="20260926">
    <OpenPositions></OpenPositions><CashReport>
    <CashReportCurrency accountId="${id}" currency="USD" endingCash="${cash}" />
    </CashReport></FlexStatement>`;
}

describe('account-based broker connections', () => {
  it('lazily maps old IBKR into one source and preserves its channel and last sync', () => {
    const state = investor({ broker_connections: {
      ibkr: { enabled: true, credentials: { token: 'secret1234', activity_query_id: '111' },
        last_sync: { at: '2026-09-25T00:00:00Z', ok: true, account_id: 'U1' } },
    } });
    const model = readBrokerAccountModel(state);
    expect(model.connections.ibkr.channel).toBe('ibkr');
    expect(model.connections.ibkr.account_id).toBeUndefined();
    expect(model.connections.ibkr.last_sync?.account_id).toBe('U1');
    expect(model.sources['legacy-ibkr'].credentials.token).toBe('secret1234');
    expect(model.connections.ibkr.config.activity_query_id).toBe('111');
    expect(state.broker_sources).toBeUndefined();
    expect(() => patchBrokerAccount(state, 'ibkr', { account_id: 'U2' })).toThrow(/prior sync/);
    patchBrokerAccount(state, 'ibkr', { account_id: 'U1' });
    expect(readBrokerAccountModel(state).connections.ibkr.account_id).toBe('U1');
  });

  it('supports any number of accounts with unique immutable channels and one shared source', () => {
    const state = investor();
    const source = addBrokerSource(state, 'ibkr', { token: 'secret1234' });
    const a = addBrokerAccount(state, { source_id: source, account_id: 'U1', label: 'Main',
      config: { activity_query_id: '111' } });
    const b = addBrokerAccount(state, { source_id: source, account_id: 'U2', label: 'Second',
      config: { activity_query_id: '111' } });
    const model = readBrokerAccountModel(state);
    expect(model.connections[a].channel).not.toBe(model.connections[b].channel);
    expect(model.connections[a].source_id).toBe(model.connections[b].source_id);
    expect(() => resolveBrokerAccountId(state, 'ibkr')).toThrow(/Multiple ibkr accounts/);
    expect(resolveBrokerAccountId(state, 'ibkr', b)).toBe(b);
    expect(() => addBrokerAccount(state, { source_id: source, account_id: 'U1', label: 'Duplicate',
      config: { activity_query_id: '222' } })).toThrow(/Duplicate broker account/);
    model.connections[a].last_sync = { at: '2026-09-27T00:00:00Z', ok: false, error: 'Bad token secret1234' };
    persistBrokerAccountModel(state, model);
    expect(JSON.stringify(publicBrokerAccounts(state))).not.toContain('secret1234');
  });

  it('splits a multi-account Flex response and rejects duplicate account statements', () => {
    const xml = `<FlexQueryResponse><FlexStatements count="2">${flex('U1', 100)}${flex('U2', 200)}</FlexStatements></FlexQueryResponse>`;
    const statements = ibkrStatements(Buffer.from(xml), 'ibkr-c02');
    expect(statements.map(s => [s.account_id, s.cash[0].amount])).toEqual([['U1', 100], ['U2', 200]]);
    expect(() => ibkrStatements(Buffer.from(`<FlexQueryResponse>${flex('U1', 100)}${flex('U1', 200)}</FlexQueryResponse>`), 'ibkr-c02'))
      .toThrow(/Duplicate IBKR Flex account/);
    expect(() => ibkrStatements(Buffer.from(`<FlexQueryResponse>${flex('U1', 100)}<FlexStatement accountId="U2">`), 'ibkr-c02'))
      .toThrow(/incomplete FlexStatement/);
  });

  it('lets a migrated account update its Activity query before confirming the binding', () => {
    const state = investor({ broker_connections: {
      ibkr: { enabled: true, credentials: { token: 'secret1234', activity_query_id: '111' } },
    } });
    patchBrokerAccount(state, 'ibkr', { config: { activity_query_id: '222' } });
    expect(readBrokerAccountModel(state).connections.ibkr.config.activity_query_id).toBe('222');
    expect(readBrokerAccountModel(state).connections.ibkr.account_id).toBeUndefined();
  });

  it('allows correcting an unused account and locks a channel that has imported data', () => {
    const state = investor();
    const source = addBrokerSource(state, 'ibkr', { token: 'secret1234' });
    const id = addBrokerAccount(state, { source_id: source, account_id: 'U1', label: 'Main',
      config: { activity_query_id: '111' } });
    patchBrokerAccount(state, id, { account_id: 'U2' });
    expect(readBrokerAccountModel(state).connections[id].account_id).toBe('U2');
    const channel = readBrokerAccountModel(state).connections[id].channel;
    state.portfolio = { [`AAPL@${channel}`]: { instrument: 'equity', channel, units: 1, avg_price: 10 } };
    expect(() => patchBrokerAccount(state, id, { account_id: 'U3' })).toThrow(/cannot be changed/);
  });

  it('refuses a mismatched preview without changing existing holdings or cash', async () => {
    const state = investor({
      portfolio: { 'AAPL@manual': { instrument: 'equity', channel: 'manual', units: 2, avg_price: 10 } },
    });
    const source = addBrokerSource(state, 'ibkr', { token: 'secret1234' });
    const id = addBrokerAccount(state, { source_id: source, account_id: 'U2', label: 'Second',
      config: { activity_query_id: '111' } });
    const before = JSON.stringify(state);
    const spy = vi.spyOn(adapters.ibkr, 'fetchRaw').mockResolvedValue({
      kind: 'xml', body: Buffer.from(`<FlexQueryResponse>${flex('U1', 100)}</FlexQueryResponse>`),
    });
    try {
      await expect(previewBrokerAccount(state, id)).rejects.toThrow(/account mismatch/);
      expect(JSON.stringify(state)).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });
});
