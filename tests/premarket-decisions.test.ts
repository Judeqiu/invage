import { expect, it } from 'vitest';
import { analyzeDecision, triggerCeiling, type ListedOption, type PositionCash } from '../src/premarket/decisions.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import type { OptionRelationship, RollContract } from '../src/brokers/option-relationships.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { positionHistory } from '../src/premarket/history.js';
import { calendarFromCsv, dueSession } from '../src/premarket/session.js';

const option: ListedOption = { id: 'CURRENT', underlying: 'AMD', strike: 100, expiry: '2026-11-27', right: 'put',
  currency: 'USD', shares: 100, premiumMultiplier: 100, shareOnly: true, exercise: 'american', source: 'option terms',
  quote: { bid: 19, ask: 20, bookAsOf: null, lastTradeAt: null, collectedAt: '2026-11-02T12:00:00Z', source: 'option book',
    bidSize: 1, askSize: 1, volume: 0, openInterest: 0, ivPercent: 22, delta: -.8, gamma: 0, theta: 0, vega: 0, rho: 0 } };
const cost = { currency: 'USD', feePerContract: .65, minimumOrderFee: 1, reference: 'test fee estimate' };
const cash: PositionCash = { openGross: 1000, openFees: -2, chainGross: 1000, chainFees: -2, originalGross: 1000 };
const stock = { price: 90, currency: 'USD', asOf: '2026-11-02T11:59:50Z', source: 'test source', field: 'preMarketPrice' };
const position = { currency: option.currency, strike: option.strike, expiry: option.expiry, quantity: 1, listed: option };

it('distinguishes the buyback amount, fee cash, close preference and strategy P&L at the exact boundary', () => {
  const result = analyzeDecision(position, cash, stock, [], '2026-11-02', cost);
  expect(result.close).toMatchObject({ buyback: 2000, preferredUnder: 2000, highlight: false,
    thisGrossBeforeFutureFees: -1000, thisNetBeforeFutureFees: -1002, thisNetWithEstimatedFee: -1003 });
  const below = { ...option, quote: { ...option.quote, ask: 19.75 } };
  expect(analyzeDecision({ ...position, listed: below }, cash, stock, [], '2026-11-02').close.highlight).toBe(true);
  expect(triggerCeiling(100)).toBe(110);
  expect(triggerCeiling(12.5)).toBe(13.75);
});

it('compares both expirations and exposure using the whole cash history, preserves rebates and leaves unknowns visible', () => {
  const call: ListedOption = { ...option, id: 'CALL', right: 'call', strike: 95, expiry: '2026-12-18',
    quote: { ...option.quote, bid: 4, ask: 5 } };
  const roll = { ...option, id: 'ROLL', strike: 98, expiry: '2027-01-15', quote: { ...option.quote, bid: 21, ask: 22 } };
  const cashAfterRoll = { ...cash, chainGross: 600, chainFees: 2 };
  const result = analyzeDecision(position, cashAfterRoll, stock, [call, roll], '2026-11-02', cost);
  expect(result.hold).toMatchObject({ assignmentCash: 10000, breakeven: 93.98, expiryAtSpot: -398, expiryAtZero: -9398, timeValueAtAsk: 10 });
  expect(result.calls[0]).toMatchObject({ income: 400, ifCalled: 502, ifNotCalledAtScanSpot: 2, ifNotCalledAtZero: -8998, upCap: 502 });
  expect(result.rolls[0]).toMatchObject({ grossFlow: 100, netFlowEstimate: 98, newIncome: 2100,
    assignmentCash: 9800, chainNetBeforeFutureFees: 702, breakeven: 90.98, breakevenWithEstimatedFees: 91 });
  const unknown = analyzeDecision({ ...position, listed: null }, { ...cash, chainFees: null }, stock, [call, roll], '2026-11-02');
  expect(unknown.close.buyback).toBeNull();
  expect(unknown.hold.assignmentCash).toBeNull();
  expect(unknown.calls[0].ifCalled).toBeNull();
  expect(unknown.rolls[0].grossFlow).toBeNull();
});

it('keeps verified current-put outcomes available when earlier cash flows cannot be reconciled', () => {
  const incomplete = { ...cash, chainGross: null, chainFees: null, originalGross: null };
  const hold = analyzeDecision(position, incomplete, stock, [], '2026-11-02').hold;
  expect(hold).toMatchObject({ breakeven: null, expiryAtSpot: null, currentPutBreakeven: 90.02, currentPutExpiryAtSpot: -2 });
  const withoutQuote = analyzeDecision(position, incomplete, null, [], '2026-11-02').hold;
  expect(withoutQuote).toMatchObject({ currentPutBreakeven: 90.02, currentPutExpiryAtSpot: null });
  const withoutFees = analyzeDecision(position, { ...incomplete, openFees: null }, stock, [], '2026-11-02').hold;
  expect(withoutFees).toMatchObject({ currentPutBreakeven: null, currentPutExpiryAtSpot: null });
});

it('keeps the same Singapore start across U.S. DST, handles exchange holidays, and uses an inclusive calendar-day window', () => {
  expect(dueSession(new Date('2026-10-30T11:59:00Z'))).toBeNull();
  expect(dueSession(new Date('2026-10-30T12:00:00Z'))).toEqual({ date: '2026-10-30', windowEnd: '2026-11-27' });
  expect(dueSession(new Date('2026-11-02T12:00:00Z'))).toEqual({ date: '2026-11-02', windowEnd: '2026-11-30' });
  expect(dueSession(new Date('2026-11-02T14:30:00Z'))).toBeNull();
  expect(dueSession(new Date('2026-11-01T12:00:00Z'))).toBeNull();
  const { closed, years } = calendarFromCsv('#\nHoliday Name,Date,Regular Trading Hours,Global Trading Hours\nThanksgiving,2026-11-26,None,None\nEarly close,2026-11-27,09:30:00 - 13:00:00,None\n');
  expect([...years]).toEqual(['2026']);
  expect([...closed]).toEqual(['2026-11-26']);
});

it('reconciles every predecessor by broker fill ID and carries realized losses and signed fees into the current chain', () => {
  const account = { channel: 'ibkr', account_id: 'UFIXTURE' };
  const contract = (expiry: string): RollContract =>
    ({ underlying: 'AMD', right: 'put', expiry, strike: '100', multiplier: '100', currency: 'USD' });
  const old = contract('2026-09-18'), middle = contract('2026-10-16'), current = contract('2026-11-27');
  const execution = (execution_id: string, t: RollContract, executed_at: string, effect: 'open' | 'close',
    gross_premium: string, commission: string): OptionExecution => ({
    ...t, ...account, execution_id, contract_id: t.expiry, executed_at, contracts: '1',
    effect, side: effect === 'open' ? 'sell' : 'buy', gross_premium, commission,
  });
  const executions = [
    execution('open-old', old, '2026-08-20T11:23:00', 'open', '1000', '-2'),
    execution('close-old', old, '2026-09-17T11:23:00', 'close', '-1400', '-1'),
    execution('open-middle', middle, '2026-09-17T11:23:00', 'open', '1600', '1'),
    execution('close-middle', middle, '2026-10-15T11:23:00', 'close', '-2100', '-2'),
    execution('open-current', current, '2026-10-15T11:23:00', 'open', '2500', '-1'),
  ];
  const link = (id: string, prev: RollContract, replacement: RollContract, closing: OptionExecution,
    opening: OptionExecution): OptionRelationship => ({
    id, ...account, broker_id: 'ibkr', old: prev, replacement, closed_quantity: '1', opened_quantity: '1',
    at: closing.executed_at, through: opening.executed_at, clock: 'America/New_York', side: 'short', replacement_effect: 'open',
    evidence: 'order', reason: 'Broker linked both order legs', cash: null, cash_basis: 'unknown',
    closing_fills: [closing.execution_id], opening_fills: [opening.execution_id], orders: [], parent: id, sources: [],
  });
  const links = [link('second', middle, current, executions[3], executions[4]),
    link('first', old, middle, executions[1], executions[2])];
  const state: InvestorState = { user: { id: 'fixture', created_at: '2026-08-01' },
    profile: { display_name: 'Fixture investor', contact_email: 'fixture@test.local' }, log: [], option_executions: executions };
  const details = positionHistory(state, {
    groups: [{ ...account, id: 'chain', broker_id: 'ibkr', underlying: current.underlying, latest: current, latest_quantity: '1',
      last_at: links[0].at, relationships: links, continuity: 'unverified' }],
    spreads: [], historyGaps: [], coverage: [], gaps: [], as_of: null, connections: [],
  }, { channel: account.channel, units: 1, avg_price: 2500, currency: 'USD', instrument: 'option',
    option: { ...current, strike: 100, multiplier: 100, settlement: 'physical', side: 'short', mark: 2000 } },
  account.account_id, { openedFrom: '2026-10-15', openedTo: '2026-10-15', openingExecutionIds: ['open-current'],
    stoNetPremium: 2499, stoGrossPremium: 2500, currency: 'USD' });
  expect(details.cash).toEqual({ originalGross: 1000, openGross: 2500, openFees: -1, chainGross: 1600, chainFees: -5 });
  expect(details.rolls.map(roll => [roll.buybackCash, roll.replacementCash, roll.actualFees, roll.predecessorNet]))
    .toEqual([[-1400, 1600, 0, -403], [-2100, 2500, -3, -501]]);
});
