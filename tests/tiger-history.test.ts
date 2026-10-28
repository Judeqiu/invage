import { parseBrokerSnapshot } from '../src/brokers/adapter.js';
import { tigerAdapter } from '../src/tiger/tiger-adapter.js';
import { mergeBrokerHistory } from '../src/brokers/history.js';
import { describe, expect, it } from 'vitest';
import { mapTigerHistory } from '../src/tiger/tiger-history.js';
import type { TigerRawBundle } from '../src/tiger/tiger-types.js';
import { mapTigerBundleToStatement } from '../src/tiger/tiger-map.js';
import { tigerHistoryTime, tigerMarketClock, tigerYahooSymbol } from '../src/tiger/tiger-markets.js';

describe('Tiger regional history', () => {
  const time = Date.parse('2026-10-13T02:00:00Z');
  function bundle(market = 'SI', symbol = 'Z74.SI'): TigerRawBundle {
    return {
      schema: 'invage.tiger.raw.v1', fetched_at: new Date(time).toISOString(),
      gateway: 'https://example.test', account: 'A1', license: 'TBSG', account_kind: 'prime',
      managed_accounts: null, assets: { method: 'prime_assets', envelope: { code: 0,
        data: { account: 'A1', segments: { S: { currencyAssets: { USD: { cashBalance: '1000' } } } } } } },
      positions: { STK: { code: 0, data: { items: [] } }, OPT: { code: 0, data: { items: [] } }, FUND: { code: 0, data: { items: [] } } },
      history: { start: time - 86400000, end: time + 1000, mode: 'full', gaps: [],
        orders: [{ id: 'o1', account: 'A1', secType: 'STK', market: 'SG', symbol: 'Z74',
          action: 'BUY', status: 'Filled', openTime: time, orderType: 'LMT', currency: 'SGD' }],
        transactions: [{ id: 't1', orderId: 'o1', accountId: 'A1', secType: 'STK', market, symbol,
          action: 'BUY', transactionTime: time, currency: 'SGD', filledQuantity: '100', filledPrice: '3.50', filledAmount: '350' }],
      },
    };
  }

  it('isolates malformed history while independently validating the current snapshot', () => {
    const raw=bundle(); raw.history!.transactions[0].transactionTime='ambiguous';
    const payload={kind:'json' as const,body:Buffer.from(JSON.stringify(raw))};
    const snapshot=parseBrokerSnapshot(tigerAdapter,payload,'tiger');
    expect(snapshot.cash).toEqual([{currency:'USD',amount:1000}]);
    expect(snapshot.history).toBeUndefined();
    expect(snapshot.skipped).toContainEqual(expect.objectContaining({kind:'event',reason:expect.stringContaining('reconciliation queued')}));
    raw.assets.envelope.data={};
    expect(()=>parseBrokerSnapshot(tigerAdapter,{...payload,body:Buffer.from(JSON.stringify(raw))},'tiger')).toThrow(/cash sleeves/);
  });

  it.each([['SI', 'Z74.SI'], ['SI', 'Z74'], ['SG', 'Z74.SI'], ['SG', 'Z74']])(
    'reconciles %s %s executions with Singapore orders without changing raw evidence', (market, symbol) => {
      const raw = bundle(market, symbol);
      const before = structuredClone(raw);
      const history = mapTigerHistory(raw, [], 'tiger')!;
      expect(history.executions[0]).toMatchObject({ native_symbol: 'SG.Z74', symbol: 'Z74.SI',
        clock: 'Asia/Singapore', executed_at: '2026-10-13T10:00:00', gross_cash: '-350' });
      expect(history.orders[0]).toMatchObject({ native_symbol: 'SG.Z74', clock: 'Asia/Singapore' });
      expect(history.sync.full_history_synced).toBe(true);
      expect(raw).toEqual(before);
    },
  );

  it('records stock order charges and keeps their availability after incremental merges', () => {
    const raw=bundle();Object.assign(raw.history!.orders[0], {filledQuantity:'100',commission:'1.4',gst:'0.12'});
    const h=mapTigerHistory(raw,[],'tiger')!;
    expect(h.executions[0].fee_cash).toBe('-1.520000000000');
    expect(h.orders[0].fees).toMatchObject({total:'1.52',currency:'SGD'});
    const empty=structuredClone(h);empty.executions=[];empty.orders=[];empty.sync.mode='incremental';empty.sync.fees='unavailable';
    expect(mergeBrokerHistory(h,empty).sync.fees).toBe('available');
  });
  it.each(['351','-351'])('preserves reported trade amounts even when a calculated amount differs: %s',reported=>{
    const raw=bundle();raw.history!.transactions[0].filledAmount=reported;
    const h=mapTigerHistory(raw,[],'tiger')!;
    expect(h.executions[0].gross_cash).toBe(reported.startsWith('-')?reported.slice(1):`-${reported}`);
  });
  it('retains broker-reported option cash even when historical multiplier metadata is absent',()=>{
    const raw=bundle('US','SKHY');
    Object.assign(raw.history!.transactions[0],{secType:'OPT',right:'PUT',strike:'135',expiry:'20261120',filledAmount:'744',currency:'USD'});
    const h=mapTigerHistory(raw,[],'tiger')!;
    expect(h.executions[0]).toMatchObject({instrument:'option',multiplier:null,gross_cash:'-744'});
  });

  it('retains unfamiliar markets in UTC with native identity and an explicit partial-coverage gap', () => {
    const raw = bundle('FUTURE_MARKET', 'ABC');
    raw.history!.orders[0].market = 'FUTURE_MARKET';
    const h = mapTigerHistory(raw, [], 'tiger')!;
    expect(h.executions[0]).toMatchObject({ native_symbol: 'FUTURE_MARKET.ABC', symbol: null,
      clock: 'UTC', executed_at: '2026-10-13T02:00:00', gross_cash: '-350' });
    expect(h.orders[0].clock).toBe('UTC');
    expect(h.sync).toMatchObject({ status: 'partial', full_history_synced: false });
    expect(h.sync.gaps.some(g => g.reason.includes('retained in UTC'))).toBe(true);
  });

  const regions = [
    ['US', 'US', 'AAPL', 'AAPL', 'America/New_York', '2026-10-12T22:00:00'],
    ['HK', 'SEHK', '00700', '0700.HK', 'Asia/Hong_Kong', '2026-10-13T10:00:00'],
    ['SG', 'SI', 'Z74', 'Z74.SI', 'Asia/Singapore', '2026-10-13T10:00:00'],
    ['AU', 'AX', 'BHP', 'BHP.AX', 'Australia/Sydney', '2026-10-13T13:00:00'],
    ['NZ', 'NZX', 'AIR', 'AIR.NZ', 'Pacific/Auckland', '2026-10-13T15:00:00'],
    ['JP', 'TSE', '9984', '9984.T', 'Asia/Tokyo', '2026-10-13T11:00:00'],
    ['CN', 'SEHKNTL', '600519.SS', '600519.SS', 'Asia/Shanghai', '2026-10-13T10:00:00'],
    ['CN', 'SEHKSZSE', '000001.SZ', '000001.SZ', 'Asia/Shanghai', '2026-10-13T10:00:00'],
  ];
  it.each(regions)('maps %s positions, orders and %s executions consistently', (market, alias, native, yahoo, clock, at) => {
    const raw = bundle(` ${alias.toLowerCase()} `, yahoo);
    Object.assign(raw.history!.orders[0], { market, symbol: native });
    raw.positions.STK.data = { items: [{ market, symbol: yahoo, secType: 'STK', currency: 'USD',
      positionQty: '100', averageCost: '3.50' }] };
    const before = structuredClone(raw);
    const statement = mapTigerBundleToStatement(raw, 'tiger');
    expect(statement.lots[0].ticker).toBe(yahoo);
    expect(statement.history!.executions[0]).toMatchObject({ symbol: yahoo, clock, executed_at: at });
    expect(statement.history!.orders[0].native_symbol).toBe(statement.history!.executions[0].native_symbol);
    expect(statement.history!.sync.status).toBe('complete');
    expect(raw).toEqual(before);
  });

  it('retains unresolved China executions without guessing a listing from currency or ticker', () => {
    const raw = bundle('CN', '000001');
    const h = mapTigerHistory(raw, [], 'tiger')!;
    expect(h.executions[0]).toMatchObject({ symbol: null, clock: 'Asia/Shanghai', native_symbol: 'CN.000001' });
    expect(h.sync.status).toBe('partial');
    expect(tigerYahooSymbol({ market: 'CN', symbol: '000001', exchange: 'SZSE' })).toBe('000001.SZ');
    expect(tigerYahooSymbol({ market: 'CN', symbol: '600519', exchange: 'SEHKNTL' })).toBe('600519.SS');
  });

  it.each([
    ['US', '2026-01-15T00:00:00Z', '2026-01-14T19:00:00'],
    ['US', '2026-07-15T00:00:00Z', '2026-07-14T20:00:00'],
    ['AU', '2026-01-15T00:00:00Z', '2026-01-15T11:00:00'],
    ['AU', '2026-07-15T00:00:00Z', '2026-07-15T10:00:00'],
    ['NZ', '2026-01-15T00:00:00Z', '2026-01-15T13:00:00'],
    ['NZ', '2026-07-15T00:00:00Z', '2026-07-15T12:00:00'],
  ])('uses historical daylight saving for %s at %s', (market, utc, expected) => {
    expect(tigerHistoryTime(Date.parse(utc), tigerMarketClock(market)!)).toBe(expected);
  });

  it.each(['2026-10-13 10:00:00', '', null, Number.MAX_SAFE_INTEGER + 1])('rejects ambiguous or invalid timestamps: %s', value => {
    const raw = bundle('UNKNOWN', 'ABC');
    raw.history!.transactions[0].transactionTime = value;
    expect(() => mapTigerHistory(raw, [], 'tiger')).toThrow(/timestamp/);
  });
});
