import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { fetchMooMooRawBundle } from '../src/moomoo/moomoo-client.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';
import { buildExecutionJournal, mergeOptionExecutions } from '../src/brokers/option-executions.js';
import type { MooMooRawBundle } from '../src/moomoo/moomoo-types.js';

const code = 'US.PATH270319P15000';
const fill = (id: string, side = 'SELL_SHORT', qty = '2', price = '4.410000') => ({
  deal_id: id, order_id: `order-${id}`, code, trd_side: side, qty, price,
  create_time: Date.parse('2026-09-29T01:30:00Z') * 1000, status: 'OK',
});
function bundle(rows = [fill('a')]): MooMooRawBundle {
  return { schema: 'invage.moomoo.raw.v1', fetched_at: '2026-10-09T10:00:00Z', acc_id: 'A1',
    authorized: { s: 'ok' }, funds: { s: 'ok', d: { us_cash: '1000' } },
    positions: { s: 'ok', d: [{ code, qty: '-2', currency: 'USD', position_side: 'SHORT',
      cost_price: '4.410', cost_price_valid: true, nominal_price: '1' }] },
    option_basicinfo: [{ code, stock_type: 'DRVT', contract_size: 100, stock_owner: 'US.PATH' }],
    fills_history: { start: '946684800000000', end: '1791532800000000', rows },
  };
}

describe('Moomoo opening fills', () => {
  it('uses exact premium arithmetic, exchange-local dates, and explicitly unknown fees', () => {
    const statement = mapMooMooBundleToStatement(bundle(), 'moomoo');
    expect(statement.option_executions?.[0]).toMatchObject({ executed_at: '2026-09-28T21:30:00',
      side: 'sell', effect: 'open', gross_premium: '882.000000', commission: null, contract_id: code });
    const journal = buildExecutionJournal(statement.option_executions);
    expect(journal.executions[0].net_premium).toBeNull();
    expect(journal.daily[0].net_premium).toBeNull();
    expect(journal.cumulative[0].net_premium).toBeNull();
    const detail = openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions);
    expect(detail.path).toEqual({ openedFrom: '2026-09-28', openedTo: '2026-09-28',
      openingExecutionIds: ['a'], stoNetPremium: null, stoGrossPremium: 882, currency: 'USD' });
  });
  it('allocates only outstanding opening proceeds after partial buybacks and deduplicates overlapping syncs', () => {
    const a = fill('a', 'SELL_SHORT', '3');
    const b = { ...fill('b', 'BUY_BACK', '1', '1.01'), create_time: Number(a.create_time) + 1000000 };
    const statement = mapMooMooBundleToStatement(bundle([a, b, a]), 'moomoo');
    expect(statement.option_executions).toHaveLength(2);
    expect(statement.option_executions?.find(e => e.execution_id === 'b')).toMatchObject({
      side: 'buy', effect: 'close', gross_premium: '-101.00' });
    expect(mergeOptionExecutions(statement.option_executions, statement.option_executions)).toHaveLength(2);
    expect(openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions).path)
      .toMatchObject({ stoNetPremium: null, stoGrossPremium: 882 });
  });
  it('keeps insufficient opening history unverified and supports legacy snapshots', () => {
    const statement = mapMooMooBundleToStatement(bundle([fill('a', 'SELL_SHORT', '1')]), 'moomoo');
    expect(openOptionTradeDetails({ path: statement.lots[0].holding }, statement.option_executions)).toEqual({});
    const old = bundle(); delete old.fills_history;
    expect(mapMooMooBundleToStatement(old, 'moomoo').option_executions).toBeUndefined();
  });
  it('never publishes net totals for a group with any unreported fees', () => {
    const rows = mapMooMooBundleToStatement(bundle(), 'moomoo').option_executions!;
    const journal = buildExecutionJournal([...rows, { ...rows[0], execution_id: 'known', commission: '-1' }]);
    expect(journal.daily[0].net_premium).toBeNull();
    expect(journal.cumulative[0].net_premium).toBeNull();
  });
  it.each(['CANCELLED', 'CHANGED'])('rejects %s fills rather than retaining false opening evidence', status => {
    expect(() => mapMooMooBundleToStatement(bundle([{ ...fill('a'), status }]), 'moomoo')).toThrow(/reconciliation/);
  });
});

describe('Moomoo fill pagination', () => {
  const credentials = { app_key: 'test', private_key: readFileSync('tests/fixtures/moomoo/ed25519-private.pem', 'utf8'), sign_alg: 'Ed25519' as const };
  function transport(pages: unknown[]) {
    const queries: URLSearchParams[] = [];
    const fetchImpl: typeof fetch = async url => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/authorized_trd_accs')) return Response.json({ s: 'ok', d: [{ account_id: 'A1' }] });
      if (u.pathname.endsWith('/funds')) return Response.json(bundle().funds);
      if (u.pathname.endsWith('/positions')) return Response.json({ s: 'ok', d: [{ ...(bundle().positions.d as Record<string, unknown>[])[0], contract_size: 100 }] });
      if (u.pathname.endsWith('/fills_history')) {
        queries.push(u.searchParams);
        return Response.json(pages.shift() ?? { s: 'ok', d: { order_fills: [], completed: true, page_flag: '' } });
      }
      if (u.pathname.endsWith('/stock-basicinfo')) return Response.json({ ret_code: 0, data: { basic_list: bundle().option_basicinfo } });
      throw new Error(`Unexpected ${u.pathname}`);
    };
    return { fetchImpl, queries };
  }
  it('requests explicit history bounds and follows the cursor with one stable end time', async () => {
    const t = transport([{ s: 'ok', d: { order_fills: [fill('a')], completed: false, page_flag: 'next/+=' } },
      { s: 'ok', d: { order_fills: [fill('b')], completed: true, page_flag: '' } }]);
    const raw = await fetchMooMooRawBundle(credentials, t);
    expect(raw.fills_history?.rows).toHaveLength(2);
    expect(t.queries.map(q => q.get('page_flag'))).toEqual(['', 'next/+=', '']);
    expect(t.queries.map(q => q.get('trd_market'))).toEqual(['US', 'US', 'HK']);
    expect(t.queries[0].get('start')).toBe('946684800000000');
    expect(t.queries[0].get('end')).toBe(t.queries[1].get('end'));
  });
  it('fails closed on repeated cursors or malformed pages', async () => {
    const page = { s: 'ok', d: { order_fills: [], completed: false, page_flag: 'same' } };
    await expect(fetchMooMooRawBundle(credentials, transport([page, page]))).rejects.toThrow(/pagination did not advance/);
    await expect(fetchMooMooRawBundle(credentials, transport([{ s: 'ok', d: {} }]))).rejects.toThrow(/incomplete/);
  });
});

describe('Moomoo complete execution history', () => {
  const expired = 'US.PATH260828P15000';
  it('imports closed contracts independently of current holdings, including adjusted sizes', () => {
    const raw = bundle([
      { ...fill('historical-open'), code: expired, price: '3.66', qty: '1' },
      { ...fill('historical-close', 'BUY_BACK'), code: expired, price: '0.09', qty: '1' },
    ]);
    raw.positions.d = [];
    raw.option_basicinfo = [{ code: expired, stock_type: 'DRVT', contract_size: 25, stock_owner: 'US.PATH' }];
    const statement = mapMooMooBundleToStatement(raw, 'moomoo-second');
    expect(statement.lots).toEqual([]);
    expect(statement.option_executions).toHaveLength(2);
    expect(statement.option_executions?.map(e => e.gross_premium).sort()).toEqual(['-2.25', '91.50']);
    expect(statement.option_executions?.every(e => e.multiplier === '25' && e.channel === 'moomoo-second')).toBe(true);
  });
  it('refuses to silently drop historical fills or borrow a current contract multiplier', () => {
    const raw = bundle([{ ...fill('old'), code: expired }]);
    expect(() => mapMooMooBundleToStatement(raw, 'moomoo')).toThrow(/Historical contract metadata unavailable/);
    raw.option_basicinfo!.push({ code: expired, stock_type: 'DRVT', contract_size: 100 }, { code: expired, stock_type: 'DRVT', contract_size: 100 });
    expect(() => mapMooMooBundleToStatement(raw, 'moomoo')).toThrow(/Ambiguous/);
  });
  it('fetches closed-only history and requests exact metadata for historical option codes', async () => {
    const credentials = { app_key: 'test', private_key: readFileSync('tests/fixtures/moomoo/ed25519-private.pem', 'utf8'), sign_alg: 'Ed25519' as const };
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const u = new URL(String(url)); requests.push(u.pathname);
      if (u.pathname.endsWith('/authorized_trd_accs')) return Response.json({ s: 'ok', d: [{ account_id: 'A1' }] });
      if (u.pathname.endsWith('/funds')) return Response.json(bundle().funds);
      if (u.pathname.endsWith('/positions')) return Response.json({ s: 'ok', d: [] });
      if (u.pathname.endsWith('/fills_history')) return Response.json({ s: 'ok', d: {
        order_fills: u.searchParams.get('trd_market') === 'US' ? [{ ...fill('old'), code: expired }] : [], completed: true,
      } });
      if (u.pathname.endsWith('/stock-basicinfo')) {
        expect(JSON.parse(String(init?.body)).code_list).toEqual([expired]);
        return Response.json({ ret_code: 0, data: { basic_list: [{ code: expired, stock_type: 'DRVT', contract_size: 100 }] } });
      }
      throw new Error('Unexpected request');
    };
    const raw = await fetchMooMooRawBundle(credentials, { fetchImpl });
    expect(mapMooMooBundleToStatement(raw, 'moomoo').option_executions).toHaveLength(1);
    expect(requests.filter(p => p.endsWith('/fills_history'))).toHaveLength(2);
  });
});
