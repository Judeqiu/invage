import { describe, expect, it } from 'vitest';
import { mapTigerHistory } from '../src/tiger/tiger-history.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';

describe('Tiger Singapore history', () => {
  const time = Date.parse('2026-10-13T02:00:00Z');
  function bundle(market = 'SI', symbol = 'Z74.SI'): TigerRawBundle {
    return {
      schema: 'invage.tiger.raw.v1', fetched_at: new Date(time).toISOString(),
      gateway: 'https://example.test', account: 'A1', license: 'TBSG', account_kind: 'prime',
      managed_accounts: null, assets: { method: 'prime_assets', envelope: { code: 0, data: {} } },
      positions: { STK: { code: 0, data: {} }, OPT: { code: 0, data: {} }, FUND: { code: 0, data: {} } },
      history: { start: time - 86400000, end: time + 1000, mode: 'full', gaps: [],
        orders: [{ id: 'o1', account: 'A1', secType: 'STK', market: 'SG', symbol: 'Z74',
          action: 'BUY', status: 'Filled', openTime: time, orderType: 'LMT', currency: 'SGD' }],
        transactions: [{ id: 't1', orderId: 'o1', accountId: 'A1', secType: 'STK', market, symbol,
          action: 'BUY', transactionTime: time, currency: 'SGD', filledQuantity: '100', filledPrice: '3.50', filledAmount: '350' }],
      },
    };
  }

  it.each([['SI', 'Z74.SI'], ['SI', 'Z74'], ['SG', 'Z74.SI'], ['SG', 'Z74']])(
    'reconciles %s %s executions with Singapore orders without changing raw evidence', (market, symbol) => {
      const raw = bundle(market, symbol);
      const before = structuredClone(raw);
      const history = mapTigerHistory(raw, [], 'tiger')!;
      expect(history.executions[0]).toMatchObject({ native_symbol: 'SG.Z74', symbol: 'Z74.SI',
        clock: 'Asia/Singapore', executed_at: '2026-10-13T10:00:00', gross_cash: '-350' });
      expect(history.orders[0]).toMatchObject({ native_symbol: 'SG.Z74', clock: 'Asia/Singapore' });
      expect(history.sync.full_history_synced).toBe(true);
      expect(raw).toEqual(before);
    },
  );

  it('continues rejecting unrecognized markets', () => {
    expect(() => mapTigerHistory(bundle('UNKNOWN'), [], 'tiger')).toThrow('Unknown historical market timezone');
  });
});
