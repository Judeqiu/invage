import { describe, expect, it } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { BrokerStatement } from '../src/brokers/statement.js';
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
