import { describe, expect, it } from 'vitest';
import type { Holding } from '../src/market/types.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import { openOptionTradeDetails, attachLatestRollPremium, attachOpenVerticalSpreads } from '../src/webapp/option-dashboard-data.js';
import { buildOptionVerticalSpreads, type RollFill } from '../src/brokers/option-relationships.js';

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
      openedFrom: '2026-09-28', openedTo: '2026-10-01', stoNetPremium: 548, stoGrossPremium: 550, currency: 'USD',
      openingExecutionIds: ['1', '3'],
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

it('uses only the latest verified roll before fees, preserving unknown candidate cash', () => {
  const details = openOptionTradeDetails({ path: holding }, [fill('open', '2026-10-01', 'sell', 'open', '2', '600')]);
  const replacement = { underlying: 'PATH', right: 'put', strike: '15', expiry: '2026-11-20', multiplier: '100', currency: 'USD' };
  const relationship = { channel: 'ibkr', account_id: 'U1', side: 'short', replacement_effect: 'open', replacement,
    evidence: 'order', opened_quantity: '2', opening_fills: ['open'], through: '2026-10-01T10:30:00', gross_cash: '450' } as any;
  attachLatestRollPremium({ path: holding }, details, [relationship], { ibkr: 'U1' });
  expect(details.path.rollPremium).toBe(450);
  attachLatestRollPremium({ path: holding }, details, [{ ...relationship, evidence: 'possible' }], { ibkr: 'U1' });
  expect(details.path.rollPremium).toBeNull();
  attachLatestRollPremium({ path: holding }, details, [{ ...relationship, opening_fills: ['another-order'] }], { ibkr: 'U1' });
  expect(details.path.rollPremium).toBeNull();
});

it('attaches a vertical only to both reconciled lots from the exact opening fills', () => {
  const longHolding: Holding = { ...holding, broker_ref: { native_id: 'long' }, units: 1,
    option: { ...holding.option!, right: 'call', side: 'long', strike: 350 } };
  const shortHolding: Holding = { ...holding, broker_ref: { native_id: 'short' }, units: 1,
    option: { ...holding.option!, right: 'call', strike: 370 } };
  const long = { ...fill('long-fill', '2026-10-01', 'buy', 'open', '1', '-3509'), contract_id: 'long', right: 'call' as const, strike: '350' };
  const short = { ...long, execution_id: 'short-fill', contract_id: 'short', strike: '370', side: 'sell' as const, gross_premium: '2429' };
  const portfolio = { long: longHolding, short: shortHolding };
  const details = openOptionTradeDetails(portfolio, [long, short], { ibkr: 'U1' });
  const fills: RollFill[] = [long, short].map(row => ({ id: row.execution_id, order: row.execution_id, parent: 'spread', prefix: '', account: 'U1',
    contract: { underlying: row.underlying, right: row.right, expiry: row.expiry, strike: row.strike, multiplier: row.multiplier, currency: row.currency },
    at: row.executed_at, clock: 'Broker', quantity: '1', side: row.side, effect: 'open', cash: row.gross_premium, basis: 'gross', terminal: false,
    source: { id: 'archive', version: '1' } }));
  const spreads = buildOptionVerticalSpreads('ibkr', 'U1', fills);
  attachOpenVerticalSpreads(portfolio, details, spreads, { ibkr: 'U1' });
  expect(details.long.spread?.grossPremium).toBe(-1080);
  expect(details.short.spread?.id).toBe(details.long.spread?.id);
  const otherDetails = openOptionTradeDetails(portfolio, [{ ...long, execution_id: 'reopened' }, short]);
  attachOpenVerticalSpreads(portfolio, otherDetails, spreads);
  expect(otherDetails.long.spread).toBeUndefined();
  expect(otherDetails.short.spread).toBeUndefined();
});

it('reconciles lifecycle events without a native contract ID using exact account and terms', () => {
  const rows = [fill('old', '2026-09-01', 'sell', 'open', '1', '300'),
    fill('new', '2026-10-01', 'sell', 'open', '2', '500')];
  const event = { id:'assigned', broker_id:'ibkr', channel:'ibkr', account_id:'U1', underlying:'PATH',
    right:'put', strike:'15', expiry:'2026-11-20', multiplier:'100', date:'2026-09-20',
    kind:'assignment', settlement:'physical', contracts:'1', currency:'USD', source:'ibkr_flex' } as const;
  const result = openOptionTradeDetails({ path:holding }, rows, { ibkr:'U1' }, [event]);
  expect(result.path).toMatchObject({ stoGrossPremium:500, openingExecutionIds:['new'] });
  for (const mismatch of [{ account_id:'U2' }, { strike:'16' }, { contract_id:'other' }]) {
    expect(openOptionTradeDetails({ path:holding }, rows, { ibkr:'U1' }, [{ ...event, ...mismatch }])).toEqual({});
  }
});
