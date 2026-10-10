import { describe, expect, it } from 'vitest';
import { buildOptionRelationships, groupOptionRelationships, parseRelationshipArchive,
  type RollContract, type RollFill } from '../src/brokers/option-relationships.js';

const source = { id: 'broker-sync/ibkr/history.xml', version: 'v1' };
const old: RollContract = { underlying: 'AMD', right: 'call', expiry: '2026-11-20', strike: '200', multiplier: '100', currency: 'USD' };
const replacement = { ...old, expiry: '2027-01-15', strike: '220' };
function fill(id: string, c: RollContract, side: RollFill['side'], effect: RollFill['effect'], extra: Partial<RollFill> = {}): RollFill {
  return { id, order: id, parent: 'parent', prefix: '', account: 'A', contract: c, quantity: '2',
    side, effect, at: '2026-10-01T10:00:00', clock: 'Broker-reported clock', cash: side === 'buy' ? '-100.12345' : '200.12346',
    basis: 'net', terminal: false, source, ...extra };
}
const pair = () => [fill('close', old, 'buy', 'close'), fill('open', replacement, 'sell', 'open')];

describe('option relationships', () => {
  it('links explicit orders and deduplicates overlapping archives with exact cash', () => {
    const result = buildOptionRelationships('ibkr', 'ibkr', 'A', [...pair(), ...pair().map(f => ({ ...f, source: { ...source, version: 'v2' } }))]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ evidence: 'order', cash: '100.00001', cash_basis: 'net', closed_quantity: '2', opened_quantity: '2' });
    expect(result[0].sources).toHaveLength(2);
  });
  it('rejects conflicting quantities and cross-account fills', () => {
    expect(() => buildOptionRelationships('ibkr', 'ibkr', 'A', [...pair(), { ...pair()[0], quantity: '3' }])).toThrow('Conflicting');
    expect(() => buildOptionRelationships('ibkr', 'ibkr', 'B', pair())).toThrow('account');
  });
  it('marks unequal parent quantities for review and suppresses cash', () => {
    const result = buildOptionRelationships('moomoo', 'moomoo', 'A', [pair()[0], { ...pair()[1], quantity: '5' }]);
    expect(result[0]).toMatchObject({ evidence: 'review', cash: null, cash_basis: 'unknown' });
  });
  it('does not infer rolls from new spreads or expiry book trades', () => {
    expect(buildOptionRelationships('tiger', 'tiger', 'A', [fill('buy', old, 'buy', 'unknown'), fill('sell', replacement, 'sell', 'unknown')])).toEqual([]);
    expect(buildOptionRelationships('ibkr', 'ibkr', 'A', pair().map(f => ({ ...f, terminal: true })))).toEqual([]);
  });
  it('matches complete paired IBKR prefixes but refuses partially linked orders', () => {
    const fs = pair().map(f => ({ ...f, parent: '', prefix: 'aaa.bbb' }));
    expect(buildOptionRelationships('ibkr', 'ibkr', 'A', fs)[0].evidence).toBe('execution');
    const extra = { ...fs[0], id: 'other-fill', prefix: 'other.prefix' };
    expect(buildOptionRelationships('ibkr', 'ibkr', 'A', [...fs, extra])).toEqual([]);
  });
  it('does not consume fills twice when both parent and prefix evidence exists', () => {
    const result = buildOptionRelationships('ibkr', 'ibkr', 'A', pair().map(f => ({ ...f, prefix: 'aaa.bbb' })));
    expect(result).toHaveLength(1); expect(result[0].evidence).toBe('order');
  });
  it('withholds cash when any reported cash component is unknown', () => {
    expect(buildOptionRelationships('moomoo', 'moomoo', 'A', [pair()[0], { ...pair()[1], cash: null }])[0].cash).toBeNull();
  });
  it('allows missing cash evidence to be enriched but rejects conflicting known amounts', () => {
    const fs = pair(); expect(buildOptionRelationships('moomoo', 'moomoo', 'A', [{ ...fs[0], cash: null }, ...fs])[0].cash).toBe('100.00001');
    expect(() => buildOptionRelationships('moomoo', 'moomoo', 'A', [...fs, { ...fs[0], cash: '-101' }])).toThrow('Conflicting');
  });
  it('requires Tiger parent leg totals to agree with all returned partial fills', () => {
    expect(buildOptionRelationships('tiger', 'tiger', 'A', pair().map(f => ({ ...f, expected_quantity: '3' })))[0].evidence).toBe('review');
  });
  it('retains the true replacement effect when a Tiger combination sells an existing long', () => {
    const result = buildOptionRelationships('tiger', 'tiger', 'A', [
      fill('long', replacement, 'buy', 'open', { at: '2026-09-01T10:00:00', parent: '' }),
      pair()[0], { ...pair()[1], effect: 'unknown' },
    ]);
    expect(result[0]).toMatchObject({ evidence: 'review', replacement_effect: 'close', cash: null });
  });
  it('labels unique nearby Webull resized orders as possible, never as proven net cash', () => {
    const initial = fill('initial', old, 'sell', 'unknown', { at: '2026-09-01T10:00:00', parent: '' });
    const close = fill('close', old, 'buy', 'unknown', { parent: '' });
    const open = fill('new', replacement, 'sell', 'unknown', { parent: '', quantity: '5', at: '2026-10-01T09:59:00' });
    expect(buildOptionRelationships('webull', 'webull', 'A', [initial, close, open])[0]).toMatchObject({ evidence: 'possible', cash: null, closed_quantity: '2', opened_quantity: '5' });
    expect(buildOptionRelationships('webull', 'webull', 'A', [initial, close, open, { ...open, id: 'competitor', order: 'competitor', contract: { ...replacement, strike: '230' } }])).toEqual([]);
  });
  it('forms account-scoped paths but splits intervening activity and competing branches', () => {
    const next = { ...replacement, expiry: '2027-06-18', strike: '240' };
    const fs = [...pair(), fill('c2', replacement, 'buy', 'close', { parent: 'p2', at: '2026-11-01T10:00:00' }),
      fill('o2', next, 'sell', 'open', { parent: 'p2', at: '2026-11-01T10:00:00' })];
    const relations = buildOptionRelationships('ibkr', 'ibkr', 'A', fs);
    expect(groupOptionRelationships(relations, fs)[0].relationships).toHaveLength(2);
    expect(groupOptionRelationships(relations, [...fs, fill('intervening', replacement, 'sell', 'open', { at: '2026-10-15T10:00:00' })])).toHaveLength(2);
    const branch = { ...relations[0], id: 'branch' };
    expect(groupOptionRelationships([...relations, branch], fs).every(g => g.relationships.length === 1)).toBe(true);
  });
});

describe('raw linkage readers', () => {
  it('reads MooMoo closed contracts without holdings and preserves explicit intent', () => {
    const row = { code: 'US.AMD261120C200000', qty: '2', price: '1', create_time: '1790863200000000', status: 'OK', order_id: 'P' };
    const bytes = Buffer.from(JSON.stringify({ acc_id: 'A', fills_history: { rows: [
      { ...row, deal_id: 'c', trd_side: 'BUY_BACK' },
      { ...row, code: 'US.AMD270115C220000', deal_id: 'o', trd_side: 'SELL_SHORT' },
    ] } }));
    const parsed = parseRelationshipArchive('moomoo', bytes, 'A', source);
    expect(parsed.map(f => f.effect)).toEqual(['close', 'open']);
    expect(buildOptionRelationships('moomoo', 'moomoo', 'A', parsed)[0]).toMatchObject({ evidence: 'order', cash: null });
    expect(() => parseRelationshipArchive('moomoo', bytes, 'B', source)).toThrow('account');
  });
  it('reads IBKR execution IDs and rejects unsafe XML and corrections', () => {
    const row = `<Trade accountId="A" assetCategory="OPT" levelOfDetail="EXECUTION" transactionType="ExchTrade" tradeID="1" ibOrderID="2" brokerageOrderID="p" ibExecID="a.b.02.01" dateTime="20261001;100000" underlyingSymbol="AMD" putCall="C" expiry="20261120" strike="200" multiplier="100" currency="USD" ibCommissionCurrency="USD" quantity="2" buySell="BUY" openCloseIndicator="C" netCash="-20.123"/>`;
    const xml = `<FlexStatement accountId="A"><Trades>${row}</Trades></FlexStatement>`;
    expect(parseRelationshipArchive('ibkr', Buffer.from(xml), 'A', source)[0]).toMatchObject({ prefix: 'a.b', parent: 'p', cash: '-20.123' });
    expect(() => parseRelationshipArchive('ibkr', Buffer.from('<!DOCTYPE x>'+xml), 'A', source)).toThrow('Document');
    expect(() => parseRelationshipArchive('ibkr', Buffer.from(xml.replace('tradeID="1"', 'origTradeID="9" tradeID="1"')), 'A', source)).toThrow('correction');
  });
  it('keeps terminal Tiger events in the balance timeline and prevents duplicate expiry rolls', () => {
    const bytes = Buffer.from(JSON.stringify({ account: 'A', option_history: { transactions: [], orders: [
      { id: 'event', account: 'A', secType: 'OPT', symbol: 'AMD', right: 'CALL', expiry: '20261120', strike: '200', currency: 'USD',
        action: 'BUY', filledQuantity: '2', latestTime: 1790863200000, attrList: ['ASSIGNMENT'] },
    ] } }));
    const fs = parseRelationshipArchive('tiger', bytes, 'A', source);
    expect(fs[0].terminal).toBe(true); expect(buildOptionRelationships('tiger', 'tiger', 'A', fs)).toEqual([]);
  });
});
