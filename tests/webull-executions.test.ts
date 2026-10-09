import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapWebullBundleToStatement } from '../src/webull/webull-map.js';
import { fetchWebullRawBundle } from '../src/webull/webull-client.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';
import { mergeOptionExecutions } from '../src/brokers/option-executions.js';
import type { WebullRawBundle } from '../src/webull/webull-types.js';
const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/webull/${name}.json`, 'utf8'));
const order = (extra = {}) => ({ order_id: 'exact-system-id', instrument_type: 'OPTION', status: 'FILLED', side: 'BUY',
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
  it('infers an opening and closing from complete chronology and matches only the outstanding quantity', () => {
    const s = mapWebullBundleToStatement(bundle([order({ filled_quantity: '3', position_intent: undefined }),
      order({ order_id: 'close', side: 'SELL', filled_quantity: '1', position_intent: undefined,
        filled_time_at: '2026-09-16T15:00:00Z', legs: [{...order().legs[0],side:'SELL'}] })]), 'webull');
    expect(s.option_executions?.find(e => e.execution_id === 'order:close')?.effect).toBe('close');
    const p = Object.fromEntries(s.lots.map(l => [l.ticker, l.holding]));
    expect(openOptionTradeDetails(p, s.option_executions, { webull: 'account' })['AAPL-C-200-20260918-L']).toBeDefined();
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
