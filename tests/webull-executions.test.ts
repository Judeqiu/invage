import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapWebullBundleToStatement } from '../src/webull/webull-map.js';
import { fetchWebullRawBundle } from '../src/webull/webull-client.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';
import { addDecimals, mergeOptionExecutions } from '../src/brokers/option-executions.js';
import type { WebullRawBundle } from '../src/webull/webull-types.js';
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/webull/${name}.json`, 'utf8'));
const order = (extra = {}) => ({ order_id: 'exact-system-id', instrument_type: 'OPTION', status: 'FILLED', side: 'BUY',
  order_type: 'LIMIT', place_time_at: '2026-09-16T13:59:59Z', total_quantity: '2',
  filled_quantity: '2', filled_price: '1.125', filled_time_at: '2026-09-16T14:00:00Z', position_intent: 'BUY_TO_OPEN',
  legs: [{ symbol: 'AAPL', option_type: 'CALL', option_expire_date: '2026-09-18', strike_price: '200', option_contract_multiplier: '100', side: 'BUY' }], ...extra });
const bundle = (orders: unknown[]): WebullRawBundle => ({ schema: 'invage.webull.raw.v1', fetched_at: '2026-09-17T02:15:00Z',
  region: 'us', host: 'api.webull.com', account_id: 'account', accounts: fixture('accounts'), balances: fixture('balances'),
  positions: fixture('positions'), option_history: [{ orders }] });
describe('Webull historical option orders', () => {
  it('reconciles order gross premium with native position IDs and retains unknown fees', () => {
    const s = mapWebullBundleToStatement(bundle([order()]), 'webull');
    expect(s.option_executions?.[0]).toMatchObject({ executed_at: '2026-09-16T10:00:00', gross_premium: '-225.000', commission: null, contracts: '2' });
    const portfolio = Object.fromEntries(s.lots.map(lot => [`${lot.ticker}@webull`, lot.holding]));
    const details = openOptionTradeDetails(portfolio, s.option_executions, { webull: 'account' });
    expect(details['AAPL-C-200-20260918-L@webull']).toMatchObject({ openedFrom: '2026-09-16', stoNetPremium: null });
    const repeat = mapWebullBundleToStatement(bundle([order()]), 'webull').option_executions;
    expect(mergeOptionExecutions(s.option_executions, repeat)).toHaveLength(1);
    portfolio['AAPL-C-200-20260918-L@webull'].broker_ref!.native_id = 'a-new-position-cycle';
    expect(openOptionTradeDetails(portfolio, repeat, { webull: 'account' })['AAPL-C-200-20260918-L@webull']).toBeDefined();
  });
  it('uses actual fees on legacy single-leg orders only with verified matching currency', () => {
    const raw=bundle([order()]);raw.order_details=[{orders:[order({currency:'USD',commission:{actual_commission:'1.21'},fees:[{type:'SEC',actual_value:'0.09'}]})]}];
    expect(mapWebullBundleToStatement(raw,'webull').option_executions![0].commission).toBe('-1.30');
    delete (raw.order_details[0] as any).orders[0].currency;
    expect(mapWebullBundleToStatement(raw,'webull').option_executions![0].commission).toBeNull();
  });
  it('keeps missing intent unknown rather than assuming history starts with no position', () => {
    const s = mapWebullBundleToStatement(bundle([order({ filled_quantity: '3', position_intent: undefined }),
      order({ order_id: 'close', side: 'SELL', filled_quantity: '1', position_intent: undefined,
        filled_time_at: '2026-09-16T15:00:00Z', legs: [{...order().legs[0],side:'SELL'}] })]), 'webull');
    expect(s.option_executions?.map(e => e.effect)).toEqual(['unknown', 'unknown']);
    const p = Object.fromEntries(s.lots.map(l => [l.ticker, l.holding]));
    expect(openOptionTradeDetails(p, s.option_executions, { webull: 'account' })['AAPL-C-200-20260918-L']).toBeUndefined();
  });
  it('rebuilds the reported August and September cash from expired contracts on the full-sync path', () => {
    const trades = [
      ['aug-mbly', '2026-08-18', 'MBLY', '2026-11-20', '8', '5', '0.61'],
      ['aug-path', '2026-08-24', 'PATH', '2026-10-16', '15', '5', '1.21'],
      ['aug-tsla-oct', '2026-08-26', 'TSLA', '2026-10-16', '300', '1', '4.70'],
      ['aug-tsla-nov', '2026-08-26', 'TSLA', '2026-11-20', '300', '1', '10.20'],
      ['sep-mbly', '2026-09-08', 'MBLY', '2026-10-16', '9', '7', '0.26'],
      ['sep-path', '2026-09-08', 'PATH', '2026-12-18', '15', '1', '1.42'],
      ['sep-ko', '2026-09-15', 'KO', '2026-12-18', '80', '3', '0.99'],
      ['sep-unh', '2026-09-21', 'UNH', '2026-12-18', '320', '1', '5.45'],
      ['sep-vrt-nov', '2026-09-24', 'VRT', '2026-11-20', '190', '1', '3.82'],
      ['sep-vrt-dec', '2026-09-24', 'VRT', '2026-12-18', '190', '1', '5.55'],
      ['sep-bac', '2026-09-29', 'BAC', '2027-01-15', '50', '2', '1.17'],
      ['sep-mbly-feb', '2026-09-29', 'MBLY', '2027-02-19', '9', '7', '0.52'],
      ['sep-path-feb', '2026-09-30', 'PATH', '2027-02-19', '15', '5', '0.90'],
    ].map(([id, date, symbol, expiry, strike, quantity, price]) => order({
      order_id:id, side:'SELL', position_intent:undefined, filled_quantity:quantity, filled_price:price,
      filled_time_at:`${date}T14:00:00Z`, place_time_at:`${date}T13:59:59Z`, total_quantity:quantity,
      legs:[{symbol, option_type:'PUT', option_expire_date:expiry, strike_price:strike,
        option_contract_multiplier:'100', side:'SELL', quantity}],
    }));
    const raw = bundle(trades);
    raw.positions = [];
    raw.history_plan = {mode:'full', from:'2000-01-01T00:00:00Z', through:'2026-10-30T00:00:00Z'};
    const s = mapWebullBundleToStatement(raw, 'webull');
    const records = s.option_executions!;
    expect(records).toHaveLength(13);
    const total = (month: string) => Number(addDecimals(...records.filter(e => e.executed_at.startsWith(month)).map(e => e.gross_premium)));
    expect(total('2026-08')).toBe(2400);
    expect(total('2026-09')).toBe(3151);
    expect(records.find(e => e.execution_id === 'order:sep-mbly-feb')).toMatchObject({gross_premium:'364.00'});
    expect(records.every(e => e.effect === 'unknown' && e.currency === 'USD' && e.commission === null)).toBe(true);
    expect(s.history?.executions).toEqual([]);
    expect(s.history?.sync.full_history_synced).toBe(false);
    expect(s.history?.sync.gaps.some(g => g.reason.includes('order: IDs'))).toBe(true);
    expect(mergeOptionExecutions(records, mapWebullBundleToStatement(raw, 'webull').option_executions)).toHaveLength(13);
  });
  it('retains cancelled partial fills and explicit closes without requiring an opening holding', () => {
    const raw = bundle([order({status:'CANCELED', position_intent:'BUY_TO_CLOSE', filled_quantity:'1', filled_price:'0.32'}),
      order({order_id:'pending', status:'PARTIAL_FILLED', filled_time_at:undefined})]);
    raw.positions = [];
    expect(mapWebullBundleToStatement(raw, 'webull').option_executions).toMatchObject([
      {effect:'close', contracts:'1', gross_premium:'-32.00'},
    ]);
  });
  it('preserves reported negative prices, rebates, zero fees, and explicit currency', () => {
    const raw = bundle([order({currency:'HKD', filled_price:'-0.25',
      commission:{actual_commission:'-0.15'}, fees:[]})]);
    raw.positions = [];
    expect(mapWebullBundleToStatement(raw, 'webull').option_executions![0]).toMatchObject({
      currency:'HKD', gross_premium:'50.00', commission:'0.15',
    });
    (raw.option_history![0] as any).orders[0].commission.actual_commission = '0';
    expect(mapWebullBundleToStatement(raw, 'webull').option_executions![0].commission).toBe('0');
  });
  it('rejects mismatched archive account bindings', () => {
    const raw = bundle([order({account_id:'another-account'})]);
    expect(() => mapWebullBundleToStatement(raw, 'webull')).toThrow(/account mismatch/);
  });
  it('does not turn active cumulative fills or combo prices into executions', () => {
    expect(mapWebullBundleToStatement(bundle([order({status:'PARTIAL_FILLED'}),order({order_id:'combo',option_strategy:'VERTICAL'})]),'webull').option_executions).toEqual([]);
  });
  it('rejects conflicting history and contract multipliers', () => {
    expect(() => mapWebullBundleToStatement(bundle([order(),order({filled_price:'2'})]),'webull')).toThrow(/Conflicting/);
    expect(() => mapWebullBundleToStatement(bundle([order({legs:[{...order().legs[0],option_contract_multiplier:'10'}]})]),'webull')).toThrow(/multiplier/);
  });
  it('follows pagination after an empty page with fixed history bounds', async () => {
    const queries: URL[] = [];
    const raw = await fetchWebullRawBundle({ app_key:'key',app_secret:'secret',region:'us' }, {fetchImpl: async url => {
      const u = new URL(String(url));
      if(u.pathname.endsWith('/accounts/list'))return Response.json(fixture('accounts'));
      if(u.pathname.endsWith('/balances/get'))return Response.json(fixture('balances'));
      if(u.pathname.endsWith('/positions/list'))return Response.json(fixture('positions'));
      queries.push(u);return Response.json(queries.length===1?{data:[],pagination_key:'next'}:{data:[{orders:[order()]}]});
    }});
    expect(raw.option_history).toHaveLength(1);
    expect(queries[1].searchParams.get('pagination_key')).toBe('next');
    expect(queries[0].searchParams.get('start_time')).toBe('2018-05-21T00:00:00.000Z');
    expect(queries[0].searchParams.get('end_time')).toBe(queries[1].searchParams.get('end_time'));
  });
});
