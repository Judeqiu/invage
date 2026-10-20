import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchMooMooRawBundle } from '../src/moomoo/moomoo-client.js';
import { mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { mergeBrokerHistory, optionExecutionsFromHistory } from '../src/brokers/history.js';
import { addDecimals, mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { moomooSignContent, signMooMooRequest } from '../src/moomoo/moomoo-sign.js';
import { tradesHistory } from '../src/webapp/trades-v2-data.js';
import { runQuery } from '../src/data-query/engine.js';
import type { MooMooRawBundle } from '../src/moomoo/moomoo-types.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

const code = 'US.AAPL270115P150000', time = String(Date.parse('2026-10-07T14:00:00Z') * 1000);
const credentials = { app_key:'test', private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'), sign_alg:'Ed25519' as const };
const fees = () => ({ order_id:'parent', currency:'USD', total_fee:'3.88', fees:[{type:'Commission',amount:'2.99'},{type:'Platform Fee',amount:'0.89'}] });
function bundle(): MooMooRawBundle {
  return { schema:'invage.moomoo.raw.v1', acc_id:'A', fetched_at:'2026-10-14T00:00:00Z', authorized:{s:'ok'}, funds:{s:'ok',d:{us_cash:'1000'}}, positions:{s:'ok',d:[]},
    fills_history:{start:'946684800000000',end:'1791936000000000',rows:['a','b','c'].map(deal_id => ({deal_id,order_id:'parent',code,qty:'1',price:'2.00',status:'OK',trd_side:'SELL_SHORT',create_time:time}))},
    orders_history:{start:'946684800000000',end:'1791936000000000',rows:[{order_id:'parent',code,exchange:'US',side:'SELL',order_status:'FILLED_ALL',create_time:time,currency:'USD',qty:'3',price:'2.00',dealt_qty:'3',dealt_avg_price:'2.00',order_type:'LIMIT'}]},
    option_basicinfo:[{code,stock_type:'DRVT',contract_size:100}], orders_fees:[fees()], history_mode:'full' };
}
const history = (raw = bundle()) => mapMooMooBundleToStatement(raw,'moomoo').history!;
const state = (h = history()): InvestorState => ({user:{id:'8648d3d4-f46f-4979-a9f3-7d76cefa9d15',created_at:'2026-01-01'},profile:{display_name:'Test',contact_email:''},log:[],broker_history:{moomoo:h},option_executions:optionExecutionsFromHistory(h)});

describe('Moomoo order fees', () => {
  it('records the total and breakdown, allocating exactly once across complete single-contract fills', () => {
    const h = history();
    expect(h.orders[0].fees).toEqual({currency:'USD',total:'3.88',items:[{type:'Commission',amount:'2.99'},{type:'Platform Fee',amount:'0.89'}]});
    expect(h.sync.fees).toBe('available');
    expect(addDecimals(...h.executions.map(e => e.fee_cash!))).toBe('-3.880000000000');
    const raw = bundle(); raw.fills_history!.rows.reverse();
    expect(history(raw).executions.map(e => [e.id,e.fee_cash]).sort()).toEqual(h.executions.map(e => [e.id,e.fee_cash]).sort());
    expect(mergeBrokerHistory(h,h).executions).toHaveLength(3);
    expect(mergeOptionExecutions([],optionExecutionsFromHistory(h)).every(e => e.commission !== null)).toBe(true);
  });
  it.each(['FILLED_PART','SUBMITTED'])('retains %s parent fees without assigning provisional totals to fills', status => {
    const raw = bundle(); raw.orders_history!.rows[0].order_status = status;
    const h = history(raw);
    expect(h.orders[0].fees?.total).toBe('3.88');
    expect(h.executions.every(e => e.fee_cash === null)).toBe(true);
    expect(h.sync.fees).toBe('partial');
  });
  it('allocates final cancelled partial orders only when all filled quantities reconcile', () => {
    const raw = bundle(); raw.orders_history!.rows[0].order_status = 'CANCELLED_PART';
    expect(history(raw).executions.every(e => e.fee_cash !== null)).toBe(true);
    raw.fills_history!.rows.pop();
    expect(history(raw).executions.every(e => e.fee_cash === null)).toBe(true);
  });
  it('preserves combo charges at the parent without inventing leg fees and exposes them in trade details', () => {
    const raw = bundle(), order = raw.orders_history!.rows[0];
    order.code = 'US.AAPL'; order.multi_leg_info = {leg_infos:[
      {leg_code:code,leg_side:'SELL_SHORT',leg_ratio_qty:'1'},
      {leg_code:'US.AAPL270115P140000',leg_side:'BUY',leg_ratio_qty:'1'},
    ]};
    const h = history(raw), s = state(h);
    expect(h.executions.every(e => e.fee_cash === null)).toBe(true);
    const detail = tradesHistory(s).rows[0];
    expect(detail.orderFees).toEqual([{orderId:'parent',...h.orders[0].fees}]);
    expect(detail.netCash).toBeNull();
    const other = structuredClone(s); other.broker_history!.moomoo.account_id = 'other';
    expect(tradesHistory(other).rows[0].orderFees).toEqual([]);
  });
  it('exposes order totals and itemized charges through account-scoped data queries', () => {
    const snapshot = {state:state(),revision:1};
    expect(runQuery(snapshot,{from:'broker_orders',select:['account_id','fee_total','fee_currency']}).rows).toEqual([{account_id:'A',fee_total:'3.88',fee_currency:'USD'}]);
    expect(runQuery(snapshot,{from:'broker_order_fees',select:['order_id','currency','type','amount']}).rows).toEqual([
      {order_id:'parent',currency:'USD',type:'Commission',amount:'2.99'},
      {order_id:'parent',currency:'USD',type:'Platform Fee',amount:'0.89'},
    ]);
  });
  it('keeps a fee currency mismatch at the order, with execution net cash unknown', () => {
    const raw = bundle(); raw.orders_fees![0].currency = 'HKD';
    expect(history(raw).executions.every(e => e.fee_cash === null)).toBe(true);
    expect(history(raw).orders[0].fees?.currency).toBe('HKD');
  });
  it('supports stock fills and explicit zero fees', () => {
    const raw = bundle(); raw.fills_history!.rows.forEach(r => r.code = 'US.AAPL'); raw.orders_history!.rows[0].code = 'US.AAPL';
    raw.orders_fees![0].total_fee = '0'; raw.orders_fees![0].fees = [];
    expect(history(raw).executions.every(e => e.instrument === 'security' && Number(e.fee_cash) === 0)).toBe(true);
  });
  it('enriches legacy null fees, preserves them on incremental omission and clears a recovered fee gap', () => {
    const raw = bundle(); delete raw.orders_fees;
    raw.fee_gaps = [{reference:'parent',reason:'Order fees unavailable or invalid; retry with a later sync (Full sync for older orders).'}];
    const old = history(raw), next = history(); next.sync.mode = 'incremental';
    const merged = mergeBrokerHistory(old,next);
    expect(merged.sync.gaps).toEqual([]); expect(merged.sync.fees).toBe('available');
    expect(mergeOptionExecutions(optionExecutionsFromHistory(old),optionExecutionsFromHistory(merged)).every(e => e.commission !== null)).toBe(true);
    raw.fee_gaps = []; raw.history_mode = 'incremental';
    expect(mergeBrokerHistory(merged,history(raw)).orders[0].fees?.total).toBe('3.88');
    const empty = history(); empty.executions = []; empty.orders = []; empty.sync.mode = 'incremental';
    expect(mergeBrokerHistory(merged,empty).sync.fees).toBe('available');
  });
  it.each([{total_fee:'NaN'},{total_fee:3.88},{total_fee:'-1'},{currency:''},{account_id:'other'},{fees:[{type:'Commission',amount:'NaN'}]}])('rejects invalid archived fee evidence: %j', patch => {
    const raw = bundle(); Object.assign(raw.orders_fees![0], patch);
    expect(() => history(raw)).toThrow();
  });
});

function transport(response: unknown = {s:'ok',d:fees()}, skew = false) {
  const raw = bundle(), requests: Array<{url:URL;init?:RequestInit}> = []; let feeAttempts = 0;
  const fetchImpl: typeof fetch = async (url,init) => {
    const u = new URL(String(url)); requests.push({url:u,init});
    if (u.pathname.endsWith('/authorized_trd_accs')) return Response.json({s:'ok',d:[{account_id:'A'}]});
    if (u.pathname.endsWith('/funds')) return Response.json(raw.funds);
    if (u.pathname.endsWith('/positions')) return Response.json(raw.positions);
    if (u.pathname.endsWith('/fills_history')) return Response.json({s:'ok',d:{order_fills:u.searchParams.get('trd_market') === 'US' ? raw.fills_history!.rows : [],completed:true}});
    // Parent was created before this sync's window; fills still identify it.
    if (u.pathname.endsWith('/orders_history')) return Response.json({s:'ok',d:{orders:[],completed:true}});
    if (u.pathname.endsWith('/orders/detail')) return Response.json({s:'ok',d:raw.orders_history!.rows});
    if (u.pathname.endsWith('/fees')) {
      if (skew && ++feeAttempts === 1) return Response.json({s:'error',errcode:-12006});
      return response instanceof Response ? response.clone() : Response.json(response);
    }
    if (u.pathname.endsWith('/server-time')) return Response.json({server_time_ms:'1782971427455'});
    if (u.pathname.endsWith('/stock-basicinfo')) return Response.json({ret_code:0,data:{basic_list:raw.option_basicinfo}});
    throw new Error(`Unexpected ${u.pathname}`);
  };
  return {fetchImpl,requests};
}
describe('Moomoo fee fetching', () => {
  it('fetches once per referenced parent, signs the read-only GET, and retains raw breakdowns', async () => {
    const t = transport(), raw = await fetchMooMooRawBundle(credentials,t);
    const requests = t.requests.filter(r => r.url.pathname.endsWith('/fees'));
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe('/api/v1.0/accounts/A/orders/parent/fees');
    const headers = new Headers(requests[0].init?.headers);
    expect(headers.get('Authorization')).toBe(signMooMooRequest(moomooSignContent({timestampMs:headers.get('X-Timestamp')!,method:'GET',path:requests[0].url.pathname,query:''}),credentials.private_key,'Ed25519'));
    expect(raw.orders_fees).toEqual([fees()]); expect(raw.fee_gaps).toEqual([]);
    expect(history(raw).sync.fees).toBe('available');
  });
  it('re-signs fee requests on clock skew', async () => {
    const t = transport(undefined,true), raw = await fetchMooMooRawBundle(credentials,t);
    const requests = t.requests.filter(r => r.url.pathname.endsWith('/fees'));
    expect(requests).toHaveLength(2);
    expect(new Headers(requests[1].init?.headers).get('X-Timestamp')).toBe('1782971427455');
    expect(raw.orders_fees).toHaveLength(1);
  });
  it.each([{s:'error',errcode:-1200},{s:'ok',d:{...fees(),order_id:'other'}},{s:'ok',d:{...fees(),total_fee:null}},new Response('',{status:403})])('preserves holdings/history and records unknown fees on unavailable or malformed responses', async response => {
    const raw = await fetchMooMooRawBundle(credentials,transport(response));
    expect(raw.orders_fees).toEqual([]); expect(raw.fee_gaps).toHaveLength(1);
    expect(history(raw).sync).toMatchObject({status:'partial',fees:'unavailable'});
    expect(history(raw).executions).toHaveLength(3);
  });
  it('retries rate-limited fee requests without duplicating a charge', async () => {
    vi.useFakeTimers();
    try {
      const t = transport(); let attempts = 0;
      const pending = fetchMooMooRawBundle(credentials,{fetchImpl:async (url,init) => String(url).endsWith('/fees') && ++attempts === 1
        ? new Response('',{status:429}) : t.fetchImpl(url,init)});
      await vi.runAllTimersAsync();
      expect((await pending).orders_fees).toHaveLength(1); expect(attempts).toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
