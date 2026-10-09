import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapTigerBundleToStatement } from '../src/tiger/tiger-map.js';
import { fetchTigerRawBundle, tigerExecute } from '../src/tiger/tiger-client.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';
import { addDecimals, mergeOptionExecutions } from '../src/brokers/option-executions.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';

const time = Date.parse('2026-09-29T01:30:00Z');
const terms = { secType: 'OPT', symbol: 'PATH', currency: 'USD', market: 'US', expiry: '20270319', strike: '15', right: 'PUT' };
const fill = (id = '44878623094603781', qty = '2') => ({ ...terms, id, accountId: 'A1', orderId: '44878623031431171',
  action: 'SELL', filledQuantity: qty, filledQuantityScale: 0, filledPrice: '3', filledAmount: String(Number(qty) * 300), transactionTime: time });
const order = () => ({ ...terms, id: '44878623031431171', account: 'A1', action: 'SELL', isOpen: true,
  filledQuantity: '2', filledQuantityScale: 0, commission: '1.40', gst: '0.12', status: 'Filled' });
function bundle(): TigerRawBundle {
  return { schema: 'invage.tiger.raw.v1', fetched_at: '2026-10-09T00:00:00Z', gateway: 'https://openapi.tigerfintech.com/hkg/gateway',
    account: 'A1', license: 'TBSG', account_kind: 'prime', managed_accounts: null,
    assets: { method: 'prime_assets', envelope: { code: 0, data: { account: 'A1', segments: { S: { currencyAssets: { USD: { cashBalance: '1000' } } } } } } },
    positions: { STK: { code: 0, data: { items: [] } }, FUND: { code: 0, data: { items: [] } },
      OPT: { code: 0, data: { items: [{ ...terms, underlyingSymbol: 'PATH  270319P00015000', multiplier: 100,
        positionQty: '-2', averageCost: '3', latestPrice: '1' }] } } },
    option_history: { start: 946684800000, end: time + 1000, orders: [order()], transactions: [fill()] },
  };
}

describe('Tiger option fills and fees', () => {
  it('retains exact IDs, exchange-local opening dates, canonical underlyings, commission and GST', () => {
    const statement = mapTigerBundleToStatement(bundle(), 'tiger');
    expect(statement.option_executions?.[0]).toMatchObject({ execution_id: '44878623094603781',
      executed_at: '2026-09-28T21:30:00', underlying: 'PATH', gross_premium: '600', commission: '-1.520000000000' });
    expect(openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions).path)
      .toMatchObject({ openedFrom: '2026-09-28', stoNetPremium: 598.48 });
    expect(mergeOptionExecutions(statement.option_executions, statement.option_executions)).toHaveLength(1);
  });
  it('allocates a final single-contract order fee across its fills without losing the remainder', () => {
    const b = bundle();
    b.option_history!.orders = [{ ...order(), filledQuantity: '3', commission: '1.00', gst: '0.09' }];
    b.option_history!.transactions = [fill('a', '1'), fill('b', '2')];
    const statement = mapTigerBundleToStatement(b, 'tiger');
    expect(addDecimals(...statement.option_executions!.map(row => row.commission!))).toBe('-1.090000000000');
  });
  it('does not guess per-leg fees from a combo order', () => {
    const b = bundle();
    const combo = { ...order(), secType: 'MLEG' }; delete (combo as Partial<typeof combo>).isOpen;
    b.option_history!.orders = [combo];
    const statement = mapTigerBundleToStatement(b, 'tiger');
    expect(statement.option_executions?.[0].commission).toBeNull();
    expect(openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions).path)
      .toMatchObject({ stoGrossPremium: 600, stoNetPremium: null });
  });
  it('reconciles a partial assignment against outstanding opening fills', () => {
    const b = bundle();
    b.option_history!.orders.push({ ...order(), id: 'assignment', action: 'BUY', isOpen: false,
      filledQuantity: '1', attrList: ['ASSIGNMENT'], latestTime: time + 86400000, realizedPnl: '299.24' });
    (b.positions.OPT.data as { items: Record<string, unknown>[] }).items[0].positionQty = '-1';
    const statement = mapTigerBundleToStatement(b, 'tiger');
    expect(statement.option_events?.[0]).toMatchObject({ kind: 'assignment', contracts: '1', date: '2026-09-29' });
    expect(openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions, {}, statement.option_events).path)
      .toMatchObject({ stoNetPremium: 299.24, openedFrom: '2026-09-28' });
  });
  it('leaves net proceeds unknown when order-fill coverage or fee currency is incomplete', () => {
    const b = bundle(); b.option_history!.orders[0].filledQuantity = '3';
    expect(mapTigerBundleToStatement(b, 'tiger').option_executions?.[0].commission).toBeNull();
    b.option_history!.orders = [{ ...order(), commissionCurrency: 'SGD' }];
    expect(mapTigerBundleToStatement(b, 'tiger').option_executions?.[0].commission).toBeNull();
  });
  it('does not treat same-day zero fee placeholders as settled commissions', () => {
    const b = bundle(); b.option_history!.orders = [{ ...order(), commission: '0', gst: '0' }];
    expect(mapTigerBundleToStatement(b, 'tiger').option_executions?.[0].commission).toBeNull();
    b.option_history!.end += 86400000;
    expect(mapTigerBundleToStatement(b, 'tiger').option_executions?.[0].commission).toBe('0.000000000000');
  });
  it('supports old position-only snapshots and fails before apply on account mismatch or missing order metadata', () => {
    const b = bundle(); delete b.option_history;
    expect(mapTigerBundleToStatement(b, 'tiger').option_executions).toBeUndefined();
    const bad = bundle(); bad.option_history!.transactions[0].accountId = 'OTHER';
    expect(() => mapTigerBundleToStatement(bad, 'tiger')).toThrow(/account/);
    bad.option_history!.transactions[0].accountId = 'A1'; bad.option_history!.orders = [];
    expect(() => mapTigerBundleToStatement(bad, 'tiger')).toThrow(/Missing Tiger order metadata/);
  });
});

describe('Tiger history transport', () => {
  const credentials = { tiger_id: 'test', account: 'A1', license: 'TBSG', private_key: readFileSync('tests/fixtures/tiger/test-private.pem', 'utf8') };
  it.each([false, true])('preserves numeric uint64 IDs and monetary source decimals, encoded data=%s', async encoded => {
    const data = '{"items":[{"id":44878623094603781,"orderId":44878623031431171,"filledPrice":0.123456789012345678}],"nextPageToken":""}';
    const result = await tigerExecute({ gateway: bundle().gateway, credentials, method: 'order_transactions', biz: {},
      fetchImpl: async () => new Response(`{"code":0,"data":${encoded ? JSON.stringify(data) : data}}`) });
    expect(result.data).toEqual({ items: [{ id: '44878623094603781', orderId: '44878623031431171', filledPrice: '0.123456789012345678' }], nextPageToken: '' });
  });
  it('follows both cursors with stable bounds, including empty pages, and keeps full filters', async () => {
    const seen: Array<{ method: string; biz: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body)); const biz = JSON.parse(request.biz_content);
      if (request.method === 'accounts') return Response.json({ code: 0, data: [] });
      if (request.method === 'prime_assets') return Response.json(bundle().assets.envelope);
      if (request.method === 'positions') return Response.json(bundle().positions[biz.sec_type as keyof TigerRawBundle['positions']]);
      seen.push({ method: request.method, biz });
      return Response.json({ code: 0, data: { items: [], nextPageToken: biz.page_token ? '' : 'next' } });
    };
    const raw = await fetchTigerRawBundle(credentials, { gateway: bundle().gateway, fetchImpl });
    expect(raw.option_history?.transactions).toEqual([]);
    expect(seen.map(row => [row.method, row.biz.page_token])).toEqual([
      ['orders', ''], ['orders', 'next'], ['order_transactions', ''], ['order_transactions', 'next'],
    ]);
    expect(new Set(seen.map(row => row.biz.end_date)).size).toBe(1);
    expect(seen.every(row => row.biz.start_date === 946684800000)).toBe(true);
  });
});
