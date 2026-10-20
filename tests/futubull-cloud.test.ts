import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { futubullAdapter } from '../src/futubull/futubull-adapter.js';
import { moomooAdapter } from '../src/moomoo/moomoo-adapter.js';
import { addBrokerSource, addBrokerAccount, discoverBrokerAccounts, readBrokerAccountModel, publicBrokerAccounts } from '../src/brokers/accounts.js';
import { getBrokerConnector } from '../src/brokers/catalog.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { mergeBrokerHistory } from '../src/brokers/history.js';

const private_key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const credentials = { app_key: 'futu-key', private_key };
const accountId = '281756420273981734';
const plan = { mode: 'full' as const, from: '2026-01-01T00:00:00.000Z', through: '2026-10-14T00:00:00.000Z' };
function state(): InvestorState {
  return { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' }, profile: { display_name: 'Alice' }, log: [] } as InvestorState;
}
function transport(options: { withOrder?: boolean; feeResponse?: unknown } = {}) {
  const urls: URL[] = [];
  let skewed = false;
  const order = { order_id:'parent', code:'US.AAPL', exchange:'US', side:'BUY', order_status:'FILLED_ALL',
    create_time:'1782971427455000', currency:'USD', qty:'1', price:'180', dealt_qty:'1', dealt_avg_price:'180', order_type:'LIMIT' };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    expect(url.origin).toBe('https://webapi.futunn.com');
    if (url.pathname.endsWith('/server-time')) return Response.json({ server_time_ms: String(Date.now()) });
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('futu-key');
    if (url.pathname.endsWith('/authorized_trd_accs')) {
      if (!skewed) { skewed = true; return Response.json({ s: 'error', errcode: -12006 }); }
      // Literal JSON preserves uint64 digits beyond JavaScript's safe integer range.
      return new Response(`{"s":"ok","d":{"accounts":[{"account_id":${accountId},"security_firm":"FUTUSECURITIES","account_card_number":"1234567890123456"}]}}`);
    }
    if (url.pathname.endsWith('/funds')) return Response.json(JSON.parse(readFileSync('tests/fixtures/moomoo/funds.json', 'utf8')));
    if (url.pathname.endsWith('/positions')) return Response.json(JSON.parse(readFileSync('tests/fixtures/moomoo/positions.json', 'utf8')));
    if (url.pathname.endsWith('/fills_history')) {
      const us = url.searchParams.get('trd_market') === 'US';
      const next = url.searchParams.get('page_flag');
      return Response.json({ s: 'ok', d: { completed: !us || !!next, page_flag: us && !next ? 'next' : '', order_fills: us && !next ? [{
        deal_id: 'deal1', code: 'US.AAPL', status: 'OK', trd_side: 'BUY', qty: '1', price: '180', create_time: '1782971427455000',
        ...(options.withOrder ? { order_id:'parent' } : {}),
      }] : [] } });
    }
    if (url.pathname.endsWith('/orders_history')) return Response.json({ s: 'ok', d: { orders: options.withOrder && url.searchParams.get('trd_market') === 'US' ? [order] : [], completed: true, page_flag: '' } });
    if (url.pathname.endsWith('/orders/detail')) return Response.json({ s:'ok',d:[order] });
    if (url.pathname.endsWith('/orders/parent/fees')) return Response.json(options.feeResponse ?? { s:'ok',d:{ order_id:'parent',total_fee:'1.23',fees:[{type:'Commission',amount:'1.00'},{type:'Platform Fees',amount:'0.23'}] } });
    throw new Error(`Unexpected path ${url.pathname}`);
  };
  return { transport: { kind: 'http' as const, fetch }, urls };
}

describe('Futubull cloud access', () => {
  it('fetches Futubull fees once per parent and records them using authoritative parent currency', async () => {
    const mock = transport({withOrder:true});
    const raw = await futubullAdapter.fetchRaw({...credentials,acc_id:accountId},{transport:mock.transport,history:plan});
    const bundle = JSON.parse(raw.body.toString());
    expect(bundle.orders_fees).toEqual([{order_id:'parent',total_fee:'1.23',fees:[{type:'Commission',amount:'1.00'},{type:'Platform Fees',amount:'0.23'}]}]);
    expect(bundle.orders_fees[0]).not.toHaveProperty('currency');
    const h = futubullAdapter.parseToStatement(raw,'futubull-c1').history!;
    expect(h.orders[0].fees).toEqual({currency:'USD',total:'1.23',items:[{type:'Commission',amount:'1.00'},{type:'Platform Fees',amount:'0.23'}]});
    expect(h.executions[0]).toMatchObject({broker_id:'futubull',channel:'futubull-c1',account_id:accountId,fee_cash:'-1.230000000000'});
    expect(h.sync.fees).toBe('available');
    expect(mock.urls.filter(url=>url.pathname.endsWith('/fees'))).toHaveLength(1);
    const old = structuredClone(h); old.executions[0].fee_cash = null; delete old.orders[0].fees; old.sync.fees = 'unavailable';
    expect(mergeBrokerHistory(old,h).sync.fees).toBe('available');
    const incremental = structuredClone(h); incremental.sync.mode = 'incremental'; incremental.executions = []; incremental.orders = []; incremental.sync.fees = 'unavailable';
    const merged = mergeBrokerHistory(h,incremental);
    expect(merged.orders[0].fees?.total).toBe('1.23');
    expect(merged.sync.fees).toBe('available');
  });

  it('records an explicit zero total with a null breakdown without inventing a missing fee', async () => {
    const mock = transport({withOrder:true,feeResponse:{s:'ok',d:{order_id:'parent',total_fee:'0',fees:null}}});
    const raw = await futubullAdapter.fetchRaw({...credentials,acc_id:accountId},{transport:mock.transport,history:plan});
    expect(JSON.parse(raw.body.toString()).orders_fees[0].fees).toBeNull();
    const h = futubullAdapter.parseToStatement(raw,'futubull-c1').history!;
    expect(h.sync.fees).toBe('available');
    expect(h.orders[0].fees).toEqual({currency:'USD',total:'0',items:[]});
    expect(Number(h.executions[0].fee_cash)).toBe(0);
  });

  it.each([{s:'error',errcode:-1200},{s:'ok',d:{order_id:'wrong',total_fee:'1.23',currency:'USD',fees:[]}},{s:'ok',d:{order_id:'parent',total_fee:'1',fees:null}}])('retains Futubull positions and history with an explicit fee gap on failed fee responses', async feeResponse => {
    const mock = transport({withOrder:true,feeResponse});
    const raw = await futubullAdapter.fetchRaw({...credentials,acc_id:accountId},{transport:mock.transport,history:plan});
    const statement = futubullAdapter.parseToStatement(raw,'futubull-c1');
    expect(statement.lots.length).toBeGreaterThan(0);
    expect(statement.history?.executions[0].fee_cash).toBeNull();
    expect(statement.history?.sync).toMatchObject({status:'partial',fees:'unavailable',gaps:[{kind:'coverage',reference:'parent'}]});
  });
  it('discovers accounts using a Futu AppKey and retains exact account IDs', async () => {
    const s = state();
    const source = addBrokerSource(s, 'futubull', credentials);
    const mock = transport();
    expect(await discoverBrokerAccounts(s, source, {}, mock.transport)).toEqual([{
      account_id: accountId, security_firm: 'FUTUSECURITIES', card_last4: '3456', trading_card_last4: '3456',
    }]);
    expect(mock.urls.some(url => url.pathname.endsWith('/server-time'))).toBe(true);
  });

  it('imports positions, options, cash and paginated history under Futubull, not moomoo', async () => {
    const mock = transport();
    const raw = await futubullAdapter.fetchRaw({ ...credentials, acc_id: accountId }, { transport: mock.transport, history: plan });
    expect(JSON.parse(raw.body.toString()).schema).toBe('invage.futubull.cloud.raw.v1');
    const statement = futubullAdapter.parseToStatement(raw, 'futubull-c1');
    expect(statement.account_id).toBe(accountId);
    expect(statement.lots.map(lot => lot.ticker)).toContain('0700.HK-C-390-20260629-L');
    expect(statement.lots.every(lot => lot.holding.channel === 'futubull-c1')).toBe(true);
    expect(statement.cash).toContainEqual({ currency: 'USD', amount: 7000 });
    expect(statement.history).toMatchObject({ broker_id: 'futubull', channel: 'futubull-c1', account_id: accountId });
    expect(statement.history?.executions).toHaveLength(1);
    expect(statement.history?.executions[0].broker_id).toBe('futubull');
    expect(mock.urls.some(url => url.searchParams.get('page_flag') === 'next')).toBe(true);
    expect(() => moomooAdapter.parseToStatement(raw, 'moomoo-c1')).toThrow(/schema mismatch/);
  });

  it('keeps saved OpenD sources readable and usable while offering cloud fields for new access', () => {
    const s = state();
    s.broker_sources = { old: { broker_id: 'futubull', credentials: { opend_port: '11111', security_firm: 'FUTUSECURITIES' } } };
    s.broker_connections = {};
    const id = addBrokerAccount(s, { source_id: 'old', account_id: accountId, label: 'Existing Futu', config: {} });
    expect(readBrokerAccountModel(s).connections[id].account_id).toBe(accountId);
    expect(publicBrokerAccounts(s).connections[0].status).toBe('ready');
    const fields = getBrokerConnector('futubull').credentialFields.map(field => field.id);
    expect(fields).toEqual(['app_key', 'private_key', 'acc_id', 'sign_alg']);
    expect(getBrokerConnector('futubull').helpHref).toContain('open.futunn.com');
  });
});
