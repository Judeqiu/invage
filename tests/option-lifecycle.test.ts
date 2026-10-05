import { describe, expect, it } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { OptionLifecycleEvent } from '../src/brokers/option-events.js';
import { mergeOptionLifecycleEvents } from '../src/brokers/option-events.js';
import { parseFlexOptionEvents } from '../src/ibkr/flex-events.js';
import { appendOptionObservation, buildOptionEpisodes } from '../src/brokers/option-history.js';

const base: OptionLifecycleEvent = {
  id: 'e1', broker_id: 'ibkr', channel: 'ibkr', account_id: 'U1', contract_id: '123',
  underlying: 'AAPL', right: 'put', strike: '150', expiry: '2026-10-09', multiplier: '100',
  date: '2026-10-09', kind: 'expiration', settlement: 'unknown', contracts: '1',
  currency: 'USD', source: 'ibkr_flex', broker_realized_pl: '298.50',
};

function state(channel = 'ibkr', units = 1): InvestorState {
  const s: InvestorState = { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
  const option = { underlying: 'AAPL', right: 'put' as const, side: 'short' as const,
    strike: 150, expiry: '2026-10-09', multiplier: 100,
    settlement: 'physical' as const, mark: 5 };
  for (const [date, present] of [['2026-10-08', true], ['2026-10-10', false]] as const) {
    appendOptionObservation(s, { statement: { account_id: 'U1', as_of: date,
      cash: [{ currency: 'USD', amount: 100 }],
      lots: present ? [{ ticker: 'AAPL-P-150', currency: 'USD', holding: {
        instrument: 'option', units, avg_price: 300, option,
        broker_ref: { native_id: '123' },
      } }] : [], skipped: [] }, brokerId: channel, connectionId: channel, channel,
    observedAt: `${date}T12:00:00Z`, syncId: `${channel}-${date}` });
  }
  return s;
}

function xml(rows: string): string {
  return `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" fromDate="20261008" toDate="20261010"><OptionEAEList>${rows}</OptionEAEList></FlexStatement></FlexStatements></FlexQueryResponse>`;
}

describe('broker-confirmed option lifecycle', () => {
  it('parses option events, skips underlying delivery rows, and exposes malformed event rows', () => {
    const attrs = 'accountId="U1" assetCategory="OPT" tradeID="e1" conid="123" underlyingSymbol="AAPL" putCall="P" strike="150" expiry="20261009" multiplier="100" date="20261009" transactionType="Expiration" quantity="-1" currency="USD" proceeds="0" realizedPnl="298.50"';
    const result = parseFlexOptionEvents(xml(`<OptionEAE ${attrs}/><OptionEAE assetCategory="STK" transactionType="Buy"/><OptionEAE assetCategory="OPT" symbol="AAPL  261009P00150000"/>`));
    expect(result?.events).toMatchObject([{ kind: 'expiration', date: '2026-10-09',
      contracts: '1', broker_realized_pl: '298.50' }]);
    expect(result?.skipped).toHaveLength(1);
    expect(result?.skipped[0].reason).toMatch(/transactionType/);
    expect(mergeOptionLifecycleEvents(result!.events, result!.events)).toHaveLength(1);
    expect(() => mergeOptionLifecycleEvents(result!.events, [{ ...result!.events[0], contracts: '2' }])).toThrow(/conflict/i);
    expect(() => mergeOptionLifecycleEvents([], [{ ...result!.events[0], broker_id: 'webull' }])).toThrow(/source disagrees/i);
  });

  it('classifies full expiry and cash settlement with broker-reported option P&L', () => {
    const expired = state();
    expired.option_events = [base];
    expect(buildOptionEpisodes(expired)[0]).toMatchObject({ status: 'expired',
      broker_event_pl: { amount: '298.50', currency: 'USD' } });
    const cash = state();
    cash.option_events = [{ ...base, kind: 'assignment', settlement: 'cash' }];
    expect(buildOptionEpisodes(cash)[0]).toMatchObject({ status: 'cash_settled',
      broker_event_pl: { amount: '298.50', currency: 'USD' } });
  });

  it('keeps physical assignment separate from combined underlying trade P&L', () => {
    const s = state();
    s.option_events = [{ ...base, kind: 'assignment', settlement: 'physical' }];
    const episode = buildOptionEpisodes(s)[0];
    expect(episode.status).toBe('assigned');
    expect(episode.broker_event_pl).toBeUndefined();
    s.option_events = [{ ...base, kind: 'exercise', settlement: 'physical' }];
    expect(buildOptionEpisodes(s)[0].status).toBe('conflicting_evidence');
  });

  it('requires full quantity and a later dated event; all four position feeds otherwise remain unconfirmed', () => {
    const partial = state('ibkr', 2);
    partial.option_events = [base];
    expect(buildOptionEpisodes(partial)[0].status).toBe('partially_explained');
    const sameDay = state();
    sameDay.option_events = [{ ...base, date: '2026-10-08' }];
    expect(buildOptionEpisodes(sameDay)[0].status).toBe('no_longer_observed');
    for (const broker of ['ibkr', 'tiger', 'moomoo', 'webull']) {
      expect(buildOptionEpisodes(state(broker))[0].status).toBe('no_longer_observed');
    }
  });
});
