import { describe, expect, it } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { BrokerStatement } from '../src/brokers/statement.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import { appendOptionObservation, buildOptionEpisodes } from '../src/brokers/option-history.js';

const option = {
  underlying: 'AAPL', right: 'put' as const, side: 'short' as const,
  strike: 150, expiry: '2026-11-20', multiplier: 100,
  settlement: 'physical' as const, mark: 200,
};
const holding = { instrument: 'option' as const, units: 1, avg_price: 500, option };

function state(): InvestorState {
  return { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
}
function statement(asOf: string, present: boolean, skipped = false, skipSymbol?: string): BrokerStatement {
  return { account_id: 'U1', as_of: asOf, cash: [{ currency: 'USD', amount: 100 }],
    lots: present ? [{ ticker: 'AAPL-P-150-20261120-S', currency: 'USD', holding }] : [],
    skipped: skipped ? [{ kind: 'position', reason: 'unsupported position row', ...(skipSymbol ? { symbol: skipSymbol } : {}) }] : [] };
}
function observe(s: InvestorState, date: string, present: boolean, skipped = false, channel = 'ibkr', skipSymbol?: string) {
  appendOptionObservation(s, { statement: statement(date, present, skipped, skipSymbol), brokerId: channel,
    connectionId: channel, channel, observedAt: `${date}T12:00:00Z`, syncId: `${channel}-${date}` });
}

describe('option observation episodes', () => {
  it('calculates exact commission-inclusive P&L only for a fully matched close', () => {
    const s = state();
    observe(s, '2026-09-30', true);
    observe(s, '2026-10-01', false);
    const base: OptionExecution = { channel: 'ibkr', account_id: 'U1', execution_id: 'open',
      contract_id: '123', executed_at: '2026-09-18T09:33:53', underlying: 'AAPL',
      right: 'put', expiry: '2026-11-20', strike: '150', multiplier: '100',
      contracts: '1', side: 'sell', effect: 'open', currency: 'USD',
      gross_premium: '315', commission: '-1.040079' };
    const close: OptionExecution = { ...base, execution_id: 'close',
      executed_at: '2026-10-01T09:54:28', side: 'buy', effect: 'close',
      gross_premium: '-15', commission: '-1.04028' };
    s.option_executions = [base, close];
    const [episode] = buildOptionEpisodes(s, new Date('2026-10-02T00:00:00Z'));
    expect(episode.status).toBe('closed_by_fills');
    expect(episode.matched_trade_pl).toEqual({ amount: '297.919641', currency: 'USD',
      opened: '1', closed: '1', fees: '-2.080359' });
    s.option_executions = [close];
    expect(buildOptionEpisodes(s)[0].matched_trade_pl).toBeUndefined();
    s.option_executions = [base, { ...close, contracts: '0.5' }];
    expect(buildOptionEpisodes(s)[0].matched_trade_pl).toBeUndefined();
  });

  it('does not assign same-day reopening fills to an earlier closed episode', () => {
    const s = state();
    observe(s, '2026-09-30', true);
    observe(s, '2026-10-01', false);
    observe(s, '2026-10-02', true);
    observe(s, '2026-10-03', false);
    const base: OptionExecution = { channel: 'ibkr', account_id: 'U1', execution_id: '1',
      contract_id: '123', executed_at: '2026-09-18T09:33:53', underlying: 'AAPL',
      right: 'put', expiry: '2026-11-20', strike: '150', multiplier: '100',
      contracts: '1', side: 'sell', effect: 'open', currency: 'USD',
      gross_premium: '315', commission: '-1' };
    s.option_executions = [base,
      { ...base, execution_id: '2', executed_at: '2026-10-01T09:00:00', side: 'buy', effect: 'close', gross_premium: '-15' },
      { ...base, execution_id: '3', executed_at: '2026-10-01T10:00:00', gross_premium: '100' },
      { ...base, execution_id: '4', executed_at: '2026-10-03T09:00:00', side: 'buy', effect: 'close', gross_premium: '-10' }];
    const episodes = buildOptionEpisodes(s);
    expect(episodes).toHaveLength(2);
    expect(episodes[1].matched_trade_pl).toBeUndefined();
    expect(episodes[0].matched_trade_pl).toBeUndefined();
  });

  it('preserves a position through a missed day and a partial response, then records the absence interval and reopening', () => {
    const s = state();
    observe(s, '2026-10-01', true);
    observe(s, '2026-10-03', false, true);
    let episodes = buildOptionEpisodes(s, new Date('2026-10-03T13:00:00Z'));
    expect(episodes).toHaveLength(1);
    expect(episodes[0].first_seen_absent).toBeNull();
    expect(episodes[0]).toMatchObject({ status: 'unverified', uncertain_as_of: '2026-10-03' });
    observe(s, '2026-10-04', false);
    episodes = buildOptionEpisodes(s, new Date('2026-10-04T13:00:00Z'));
    expect(episodes[0]).toMatchObject({ first_seen: '2026-10-01', last_seen_open: '2026-10-01',
      first_seen_absent: '2026-10-04', status: 'no_longer_observed' });
    observe(s, '2026-10-05', true);
    episodes = buildOptionEpisodes(s, new Date('2026-10-05T13:00:00Z'));
    expect(episodes).toHaveLength(2);
    expect(episodes[0].first_seen).toBe('2026-10-05');
    expect(episodes[1].first_seen_absent).toBe('2026-10-04');
  });

  it('does not turn a newer open position into history when an older statement arrives later', () => {
    const s = state();
    appendOptionObservation(s, { statement: statement('2026-10-02', true), brokerId: 'ibkr',
      connectionId: 'ibkr', channel: 'ibkr', observedAt: '2026-10-02T12:00:00Z', syncId: 'newer-open' });
    appendOptionObservation(s, { statement: statement('2026-09-30', false), brokerId: 'ibkr',
      connectionId: 'ibkr', channel: 'ibkr', observedAt: '2026-10-03T12:00:00Z', syncId: 'older-absent' });
    expect(buildOptionEpisodes(s, new Date('2026-10-03T13:00:00Z'))).toMatchObject([
      { first_seen: '2026-10-02', last_seen_open: '2026-10-02',
        first_seen_absent: null, status: 'open' },
    ]);
  });

  it('keeps a genuine earlier exit separate from a later open episode after backfill', () => {
    const s = state();
    appendOptionObservation(s, { statement: statement('2026-10-02', true), brokerId: 'ibkr',
      connectionId: 'ibkr', channel: 'ibkr', observedAt: '2026-10-02T12:00:00Z', syncId: 'newer-open' });
    appendOptionObservation(s, { statement: statement('2026-09-29', true), brokerId: 'ibkr',
      connectionId: 'ibkr', channel: 'ibkr', observedAt: '2026-10-03T12:00:00Z', syncId: 'older-open' });
    appendOptionObservation(s, { statement: statement('2026-09-30', false), brokerId: 'ibkr',
      connectionId: 'ibkr', channel: 'ibkr', observedAt: '2026-10-04T12:00:00Z', syncId: 'older-absent' });
    const episodes = buildOptionEpisodes(s, new Date('2026-10-04T13:00:00Z'));
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ first_seen: '2026-10-02', first_seen_absent: null, status: 'open' });
    expect(episodes[1]).toMatchObject({ first_seen: '2026-09-29', last_seen_open: '2026-09-29',
      first_seen_absent: '2026-09-30', status: 'no_longer_observed' });
  });

  it('keeps identical contracts in separate broker channels and does not duplicate a sync', () => {
    const s = state();
    observe(s, '2026-10-01', true, false, 'ibkr');
    observe(s, '2026-10-01', true, false, 'moomoo');
    observe(s, '2026-10-01', true, false, 'ibkr');
    expect(s.option_observations).toHaveLength(2);
    expect(buildOptionEpisodes(s, new Date('2026-10-01T13:00:00Z')).map(e => e.channel)).toEqual(['ibkr', 'moomoo']);
  });

  it('marks an expired last observation unverified without calling it expired or assigned', () => {
    const s = state();
    observe(s, '2026-10-01', true);
    const [episode] = buildOptionEpisodes(s, new Date('2026-12-01T12:00:00Z'));
    expect(episode.status).toBe('unverified');
    expect(episode.first_seen_absent).toBeNull();
  });

  it('does not let an unrelated skipped stock mask an option exit', () => {
    const s = state();
    observe(s, '2026-10-01', true);
    observe(s, '2026-10-04', false, true, 'ibkr', 'TSLA');
    expect(buildOptionEpisodes(s, new Date('2026-10-04T13:00:00Z'))[0].first_seen_absent).toBe('2026-10-04');
    const same = state();
    observe(same, '2026-10-01', true);
    observe(same, '2026-10-04', false, true, 'ibkr', 'AAPL');
    expect(buildOptionEpisodes(same, new Date('2026-10-04T13:00:00Z'))[0].first_seen_absent).toBeNull();
    expect(buildOptionEpisodes(same, new Date('2026-10-04T13:00:00Z'))[0].status).toBe('unverified');
  });

  it('seeds an existing open lot before its first new observation', () => {
    const s = state();
    s.portfolio = { 'AAPL-P-150-20261120-S@ibkr': { ...holding, channel: 'ibkr' } };
    s.log.push({ ts: '2026-09-30', action: 'broker_sync', connector_id: 'ibkr', account_id: 'U1' });
    observe(s, '2026-10-04', false);
    expect(s.option_observations).toHaveLength(2);
    expect(buildOptionEpisodes(s, new Date('2026-10-04T12:00:00Z'))[0]).toMatchObject({
      first_seen: '2026-09-30', first_seen_absent: '2026-10-04', status: 'no_longer_observed',
    });
  });
});
