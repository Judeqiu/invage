import { describe, expect, it } from 'vitest';
import type { Holding } from '../src/market/types.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';

const holding: Holding = {
  instrument: 'option', channel: 'ibkr', units: 2, avg_price: 300,
  broker_ref: { native_id: '123' },
  option: { underlying: 'PATH', right: 'put', side: 'short', strike: 15,
    expiry: '2026-11-20', multiplier: 100, settlement: 'physical', mark: 100 },
};

function fill(id: string, date: string, side: 'buy' | 'sell', effect: 'open' | 'close',
  contracts: string, gross: string, commission = '-1'): OptionExecution {
  return { channel: 'ibkr', account_id: 'U1', execution_id: id, contract_id: '123',
    executed_at: `${date}T10:30:00`, underlying: 'PATH', right: 'put', strike: '15',
    expiry: '2026-11-20', multiplier: '100', contracts, side, effect,
    currency: 'USD', gross_premium: gross, commission };
}

describe('open option trade detail', () => {
  it('uses only outstanding STO fills, allocating commission after a partial close', () => {
    const rows = [fill('1', '2026-09-28', 'sell', 'open', '2', '600', '-2'),
      fill('2', '2026-09-29', 'buy', 'close', '1', '-100'),
      fill('3', '2026-10-01', 'sell', 'open', '1', '250')];
    expect(openOptionTradeDetails({ path: holding }, rows, { ibkr: 'U1' })).toEqual({ path: {
      openedFrom: '2026-09-28', openedTo: '2026-10-01', stoNetPremium: 548, currency: 'USD',
    } });
  });

  it('does not claim an opening date or premium when fills do not reconcile to the position', () => {
    expect(openOptionTradeDetails({ path: holding }, [fill('1', '2026-09-28', 'sell', 'open', '1', '300')], { ibkr: 'U1' })).toEqual({});
    expect(openOptionTradeDetails({ path: holding }, [fill('1', '2026-09-28', 'sell', 'open', '2', '600')], { ibkr: 'U2' })).toEqual({});
  });

  it('recognizes a broker OCC code leaked into the underlying field', () => {
    const coded = { ...holding, option: { ...holding.option!, underlying: 'PATH 261120P00015000' } };
    expect(openOptionTradeDetails({ path: coded }, [fill('1', '2026-09-28', 'sell', 'open', '2', '600')]).path)
      .toMatchObject({ openedFrom: '2026-09-28', stoNetPremium: 599 });
  });
});
