import { describe, expect, it } from 'vitest';
import { assertStatementNotOlder } from '../src/brokers/apply-statement.js';

describe('broker statement freshness', () => {
  const state = { broker_connections: { ibkr: { last_sync: { ok: true, as_of: '2026-10-06' } } },
    option_observations: [] } as unknown as Parameters<typeof assertStatementNotOlder>[0];

  it('rejects an older position snapshot before it can replace open contracts', () => {
    expect(() => assertStatementNotOlder(state, 'ibkr', 'ibkr', '2026-09-28'))
      .toThrow(/older than the current ibkr position date 2026-10-06/);
  });

  it('allows a same-day correction or a newer snapshot', () => {
    expect(() => assertStatementNotOlder(state, 'ibkr', 'ibkr', '2026-10-06')).not.toThrow();
    expect(() => assertStatementNotOlder(state, 'ibkr', 'ibkr', '2026-10-07')).not.toThrow();
  });

  it('checks the retained position date when cash has a different date', () => {
    const partial = {broker_connections:{ibkr:{last_sync:{ok:true,as_of:'2026-10-01',positions_as_of:'2026-10-06',snapshot_deferred:['cash']}}},option_observations:[]};
    expect(()=>assertStatementNotOlder(partial as unknown as typeof state,'ibkr','ibkr','2026-10-04')).toThrow(/position date 2026-10-06/);
  });
});
