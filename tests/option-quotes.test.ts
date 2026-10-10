import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedChain } from '../src/market/options-insight.js';
const provider = vi.hoisted(() => ({ calls: [] as unknown[][], load: undefined as undefined | ((symbol: string, expiry?: string) => Promise<LoadedChain>) }));
import { createOptionQuotesTool } from '../src/tools/option_quotes.js';

vi.mock('../src/market/options-insight.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/market/options-insight.js')>(),
  loadOptionsChain: (symbol: string, expiry?: string) => {
    provider.calls.push([symbol, expiry]);
    return provider.load!(symbol, expiry);
  },
}));

const contract = { underlying: 'TSLA', expiry: '2027-02-19', strike: 395, right: 'put' as const };
const execute = (contracts: unknown) => createOptionQuotesTool().execute('test', { contracts });

describe('direct option quote batch', () => {
  beforeEach(() => { provider.calls = []; provider.load = undefined; });

  it('shares chains across strikes and preserves price units and unknown option time', async () => {
    provider.load = async () => ({ underlying: 'TSLA', expiry: contract.expiry,
      spot: 382, currency: 'USD', asOfYmd: '2026-10-10', expirationDates: [contract.expiry], calls: [],
      puts: [{ strike: 395, lastPrice: 42, bid: 41, ask: 43 }, { strike: 400, lastPrice: 46, bid: 45, ask: 47 }],
      fetchedAt: '2026-10-10T11:00:00Z', quote: { asOf: '2026-10-09T20:00:00Z', marketState: 'CLOSED', priceField: 'regularMarketPrice' } });
    const result = await execute([contract, { ...contract, underlying: ' tsla ', strike: 400 }]);
    expect(provider.calls).toHaveLength(1);
    const details = result.details as { rows: Record<string, unknown>[] };
    expect(details.rows).toHaveLength(2);
    expect(details.rows[0]).toMatchObject({ available: true, bid: 41, ask: 43, mid: 42,
      price_unit: 'per underlying share', option_quote_as_of: null,
      underlying_quote: { marketState: 'CLOSED' } });
    expect(details.rows[1]).toMatchObject({ strike: 400, underlying: 'TSLA', mid: 46 });
  });

  it('keeps successful quotes when another expiry fails and marks missing contracts unavailable', async () => {
    provider.load = async (_symbol, expiry) => {
      if (expiry !== contract.expiry) throw new Error('Provider unavailable');
      return { underlying: 'TSLA', expiry, spot: 382, currency: 'USD', asOfYmd: '2026-10-10',
        expirationDates: [expiry], calls: [], puts: [{ strike: 395, lastPrice: 42 }] };
    };
    const result = await execute([contract, { ...contract, strike: 400 }, { ...contract, expiry: '2027-03-19' }]);
    const details = result.details as { rows: Record<string, unknown>[] };
    expect(provider.calls).toHaveLength(2);
    expect(details.rows[0]).toMatchObject({ available: true, last_price: 42, bid: null, ask: null, mid: null });
    expect(details.rows[1]).toMatchObject({ available: false });
    expect(details.rows[2]).toMatchObject({ available: false, error: 'Provider unavailable' });
  });

  it('rejects invalid dates and unbounded batches before accessing a provider', async () => {
    for (const input of [[], Array(41).fill(contract), [{ ...contract, expiry: '2027-02-30' }], [{ ...contract, strike: Infinity }]]) {
      expect((await execute(input)).details).toBeNull();
    }
    expect(provider.calls).toHaveLength(0);
  });
});
