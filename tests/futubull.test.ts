import { describe, expect, it } from 'vitest';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { mapFutubullSnapshot } from '../src/futubull/futubull-map.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

const snapshot = {
  schema: 'invage.futubull.raw.v1', fetched_at: '2026-10-07T08:00:00Z', acc_id: '281756420273981734',
  funds: [{ us_cash: 100.5, hk_cash: 0, sg_cash: null }],
  positions: [
    { code: 'US.AAPL', qty: 3, currency: 'USD', position_side: 'LONG', average_cost: 150,
      cost_price: 145, cost_price_valid: true },
    { code: 'HK.00700', qty: 100, currency: 'HKD', position_side: 'LONG', average_cost: 300,
      cost_price_valid: true },
    { code: 'US.AAPL261016C00150000', qty: 1, currency: 'USD', position_side: 'LONG',
      average_cost: 10, cost_price_valid: true },
  ],
};

describe('Futubull OpenD snapshot', () => {
  it('maps live equity holdings and cash without importing unsupported options', () => {
    const mapped = mapFutubullSnapshot(snapshot, 'futubull-c1');
    expect(mapped.account_id).toBe('281756420273981734');
    expect(mapped.lots.map(row => row.ticker)).toEqual(['AAPL', '0700.HK']);
    expect(mapped.lots[0].holding.avg_price).toBe(150);
    expect(mapped.cash).toEqual([{ currency: 'USD', amount: 100.5 }, { currency: 'HKD', amount: 0 }]);
    expect(mapped.skipped).toHaveLength(1);
  });

  it('rejects a snapshot that cannot safely replace cash', () => {
    expect(() => mapFutubullSnapshot({ ...snapshot, funds: [{ us_cash: -10 }] }, 'futubull-c1'))
      .toThrow(/negative/);
    expect(() => mapFutubullSnapshot({ ...snapshot, funds: [{}] }, 'futubull-c1'))
      .toThrow(/no importable/);
  });

  it('binds a distinct account channel and rejects duplicate live accounts', () => {
    const state = { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
      profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] } as InvestorState;
    const source = addBrokerSource(state, 'futubull', { opend_port: '11111', security_firm: 'FUTUSECURITIES' });
    const id = addBrokerAccount(state, { source_id: source, account_id: snapshot.acc_id,
      label: 'Futu HK', config: {} });
    expect(readBrokerAccountModel(state).connections[id].channel).toMatch(/^futubull-/);
    expect(() => addBrokerAccount(state, { source_id: source, account_id: snapshot.acc_id,
      label: 'Duplicate', config: {} })).toThrow(/Duplicate broker account/);
  });
});
