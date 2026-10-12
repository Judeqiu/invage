import { describe, expect, it, vi } from 'vitest';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { BrokerStatement } from '../src/brokers/statement.js';
import { assertBrokerStatement } from '../src/brokers/statement.js';
import { appendOptionObservation, buildOptionEpisodes } from '../src/brokers/option-history.js';
import { mergeOptionExecutions, type OptionExecution } from '../src/brokers/option-executions.js';
import { mergeOptionLifecycleEvents, type OptionLifecycleEvent } from '../src/brokers/option-events.js';
import { parseRelationshipArchive } from '../src/brokers/option-relationships.js';

vi.mock('../src/state/investor-store.js', () => ({ saveInvestor: vi.fn() }));
vi.mock('../src/books/index.js', () => ({ isBooksEnabled: () => false }));
const { applyBrokerStatement } = await import('../src/brokers/apply-statement.js');

const code = 'AMD   261016P00230000';
function statement(underlying = code): BrokerStatement {
  return { account_id: 'A', as_of: '2026-10-12', cash: [{ currency: 'USD', amount: 10 }], skipped: [],
    lots: [{ ticker: `${underlying}-P-230-20261016-S`, currency: 'USD', holding: {
      instrument: 'option', units: 2, avg_price: 400, option: {
        underlying, right: 'put', side: 'short', strike: 230, expiry: '2026-10-16',
        multiplier: 100, settlement: 'physical', mark: 200,
      }, broker_ref: { native_id: 'vendor-contract-1' },
    } }] };
}
function state(broker = 'tiger'): InvestorState {
  return { user: { id: 'u', slug: 'u', created_at: '2026-01-01' }, log: [],
    profile: { display_name: 'U', contact_email: 'u@example.com' },
    broker_connections: { conn: { broker_id: broker, channel: broker, account_id: 'A' } },
  } as InvestorState;
}
const observation = { brokerId: 'tiger', connectionId: 'conn', channel: 'tiger',
  syncId: 'old', observedAt: '2026-10-11T00:00:00Z' };

describe('broker option normalization at sync', () => {
  it.each(['ibkr', 'tiger', 'moomoo', 'webull'])('stores consistent positions and observations for %s', async broker => {
    const s = state(broker), doc = statement();
    s.portfolio = { [`${doc.lots[0].ticker}@${broker}`]: { ...doc.lots[0].holding, channel: broker, currency: 'USD' } };
    await applyBrokerStatement({ state: s, revision: 1 }, 'conn', doc, undefined, undefined,
      { brokerId: broker, channel: broker });
    expect(Object.keys(s.portfolio!)).toEqual([`AMD-P-230-20261016-S@${broker}`]);
    expect(Object.values(s.portfolio!)[0]).toMatchObject({ units: 2, avg_price: 400,
      option: { underlying: 'AMD', strike: 230, mark: 200 }, broker_ref: { native_id: 'vendor-contract-1' } });
    expect(s.option_observations![0].options[0].underlying).toBe('AMD');
    expect(doc.lots[0].holding.option!.underlying).toBe(code);
  });

  it('rejects contradictory contract codes before changing state', async () => {
    const s = state(), before = structuredClone(s);
    await expect(applyBrokerStatement({ state: s, revision: 1 }, 'conn', statement('AMD261016C00230000'),
      undefined, undefined, { brokerId: 'tiger', channel: 'tiger' })).rejects.toThrow(/disagrees/);
    expect(s).toEqual(before);
  });

  it('rejects duplicate lots after normalization, including custom statement imports', async () => {
    const doc = statement();
    doc.lots.push(statement('AMD').lots[0]);
    expect(() => assertBrokerStatement(doc)).toThrow(/duplicate lot ticker/);
    const s = state(), before = structuredClone(s);
    await expect(applyBrokerStatement({ state: s, revision: 1 }, 'conn', doc, undefined, undefined,
      { brokerId: 'tiger', channel: 'tiger' })).rejects.toThrow(/duplicate lot keys/);
    expect(s).toEqual(before);
  });

  it('upgrades retained observations without splitting history or breaking sync retries', () => {
    const s = state();
    const old = statement(); old.as_of = '2026-10-11';
    appendOptionObservation(s, { ...observation, statement: old });
    const legacy = s.option_observations![0].options[0];
    legacy.underlying = code;
    legacy.key = JSON.stringify([code, legacy.right, legacy.side, legacy.strike, legacy.expiry,
      legacy.multiplier, legacy.settlement]);
    const beforeRead = structuredClone(s);
    expect(buildOptionEpisodes(s)[0].contract.underlying).toBe('AMD');
    expect(s).toEqual(beforeRead);
    appendOptionObservation(s, { ...observation, statement: old });
    expect(s.option_observations).toHaveLength(1);
    expect(s.option_observations![0].options[0].underlying).toBe('AMD');
    appendOptionObservation(s, { ...observation, syncId: 'new', statement: statement('AMD') });
    const episodes = buildOptionEpisodes(s);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ first_seen: '2026-10-11', last_seen_open: '2026-10-12', first_seen_absent: null });
    expect(episodes[0].observations).toHaveLength(2);
  });

  it('normalizes overlapping executions and lifecycle events without losing native IDs', () => {
    const execution: OptionExecution = { channel: 'tiger', account_id: 'A', execution_id: 'e',
      contract_id: 'native', executed_at: '2026-10-12T10:00:00', underlying: code, right: 'put',
      expiry: '2026-10-16', strike: '230', multiplier: '100', contracts: '2', side: 'sell',
      effect: 'open', currency: 'USD', gross_premium: '800', commission: '-1' };
    expect(mergeOptionExecutions([execution], [{ ...execution, underlying: 'AMD' }])).toEqual([
      { ...execution, underlying: 'AMD' },
    ]);
    const event: OptionLifecycleEvent = { id: 'event', broker_id: 'tiger', channel: 'tiger', account_id: 'A',
      contract_id: 'native', underlying: code, right: 'put', expiry: '2026-10-16', strike: '230',
      multiplier: '100', date: '2026-10-16', kind: 'expiration', settlement: 'physical',
      contracts: '2', currency: 'USD', source: 'tiger_api' };
    expect(mergeOptionLifecycleEvents([event], [{ ...event, underlying: 'AMD' }])).toEqual([
      { ...event, underlying: 'AMD' },
    ]);
  });

  it('uses the same stock symbol for retained Tiger relationship evidence', () => {
    const bytes = Buffer.from(JSON.stringify({ account: 'A', option_history: { transactions: [], orders: [
      { id: 'event', account: 'A', secType: 'OPT', symbol: code, right: 'PUT', expiry: '20261016',
        strike: '230', currency: 'USD', action: 'BUY', filledQuantity: '2',
        latestTime: 1790863200000, attrList: ['EXPIRE'] },
    ] } }));
    const [fill] = parseRelationshipArchive('tiger', bytes, 'A', { id: 'archive', version: 'v1' });
    expect(fill.contract.underlying).toBe('AMD');
    expect(fill.id).toBe('event:event');
  });
});
