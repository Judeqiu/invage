import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tigerCommissions } from '../src/tiger/tiger-executions.js';
import { tigerOrderFees } from '../src/tiger/tiger-fees.js';
import { fetchTigerRawBundle } from '../src/tiger/tiger-client.js';
import { fetchWebullRawBundle } from '../src/webull/webull-client.js';
import { mapWebullHistory } from '../src/webull/webull-history.js';
import { webullOrderFees } from '../src/webull/webull-fees.js';
import { mapFutubullHistory } from '../src/futubull/futubull-history.js';
import { addDecimals } from '../src/brokers/option-executions.js';
import { mergeBrokerHistory } from '../src/brokers/history.js';
import type { WebullRawBundle } from '../src/webull/webull-types.js';

const plan = {mode:'full' as const,from:'2026-01-01T00:00:00Z',through:'2026-10-20T00:00:00Z'};
const at = Date.parse('2026-10-16T14:00:00Z');
const tigerOrder = () => ({id:'o',account:'A',secType:'STK',market:'SG',symbol:'Z74',currency:'SGD',
  status:'Filled',filledQuantity:'100',commission:'1.4',gst:'0.12'});
const tigerFills = () => ['25','75'].map((filledQuantity,i) => ({id:String(i),orderId:'o',accountId:'A',secType:'STK',
  market:'SI',symbol:'Z74.SI',currency:'SGD',filledQuantity,transactionTime:at}));

describe('Tiger stock and parent order fees', () => {
  it('allocates stock fees exactly across fills and market aliases', () => {
    const fees = tigerCommissions(tigerOrder(),tigerFills(),at+86400000);
    expect(addDecimals(...fees.values())).toBe('-1.520000000000');
    expect([...fees.values()]).toEqual(['-0.380000000000','-1.140000000000']);
  });
  it('assigns rounding remainders chronologically regardless of gateway response order', () => {
    const order={...tigerOrder(),filledQuantity:'3',commission:'1',gst:'0'};
    const fills=['a','b','c'].map((id,i)=>({...tigerFills()[0],id,filledQuantity:'1',transactionTime:at+i}));
    const forward=tigerCommissions(order,fills,at+86400000);
    const reverse=tigerCommissions(order,[...fills].reverse(),at+86400000);
    expect([...reverse]).toEqual([...forward]);
    expect(forward.get('c')).toBe('-0.333333333334');
    expect(addDecimals(...reverse.values())).toBe('-1.000000000000');
  });
  it('does not allocate across incomplete fills, currencies, instruments or combo legs', () => {
    expect(tigerCommissions(tigerOrder(),tigerFills().slice(0,1),at).size).toBe(0);
    for (const patch of [{currency:'USD'},{symbol:'OTHER'},{secType:'OPT'}]) {
      const fills=tigerFills();Object.assign(fills[0],patch);
      expect(tigerCommissions(tigerOrder(),fills,at).size).toBe(0);
    }
    expect(tigerCommissions({...tigerOrder(),secType:'MLEG'},tigerFills(),at).size).toBe(0);
  });
  it('retains combo charge items without counting them twice in the total', () => {
    expect(tigerOrderFees({...tigerOrder(),secType:'MLEG',charges:[{total:'1.52',details:[
      {type:'COMMISSION',afterDiscountAmount:'0.7'},{type:'PLATFORM_FEE',afterDiscountAmount:'0.6'},
      {type:'GST',afterDiscountAmount:'0.12'},{type:'REGULATORY',afterDiscountAmount:'0.1'}]}]}))
      .toMatchObject({total:'1.52',currency:'SGD',items:expect.arrayContaining([{type:'GST',amount:'0.12'}])});
    expect(tigerOrderFees({...tigerOrder(),gst:undefined})).toBeUndefined();
  });
  it('does not allocate provisional same-day zero placeholders', () => {
    const order={...tigerOrder(),commission:'0',gst:'0'};
    expect(tigerCommissions(order,tigerFills(),at).size).toBe(0);
    expect(tigerCommissions(order,tigerFills(),at+86400000).size).toBe(2);
  });
  it.each([[false,true],[true,true],[false,false]])('recovers missing totals with optional lookup failure=%s, missing=%s', async (fail,missing) => {
    let queried=false;
    const raw=await fetchTigerRawBundle({account:'A',tiger_id:'1',license:'TBSG',private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')},
      {history:plan,gateway:'https://openapi.tigerfintech.com/hkg/gateway',fetchImpl:async (_url,init) => {
        const body=JSON.parse(String(init?.body??'{}')),biz=JSON.parse(body.biz_content??'{}');
        if(body.method==='orders'&&biz.id){queried=true;expect(biz).toMatchObject({account:'A',id:'o',show_charges:true});
          return Response.json(fail?{code:1}:{code:0,data:{items:[{...tigerOrder(),charges:[{details:[{type:'GST',afterDiscountAmount:'0.12'}]}]}]}});}
        if(body.method==='orders')return Response.json({code:0,data:{items:[{...tigerOrder(),gst:missing?undefined:'0.12'}]}});
        if(body.method==='order_transactions'||body.method==='positions')return Response.json({code:0,data:{items:[]}});
        return Response.json({code:0,data:[]});
      }});
    expect(queried).toBe(missing);
    expect(raw.history!.orders[0].commission).toBe('1.4');
    expect(raw.history!.gaps.length).toBe(fail?1:0);
  });
});

const webullOrder=()=>({order_id:'o',client_order_id:'client',symbol:'AAPL',side:'BUY',status:'FILLED',
  order_type:'LIMIT',filled_quantity:'1',filled_price:'10',total_quantity:'1',place_time_at:'2026-10-16T14:00:00Z'});
const actualFees=()=>({commission:{actual_commission:'0.101',receivable_commission:'99'},fees:[{type:'REGULATORY',actual_value:'0.009',receivable_value:'99'}]});
function webullBundle():WebullRawBundle{return {schema:'invage.webull.raw.v1',fetched_at:plan.through,region:'hk',host:'api.webull.hk',account_id:'A',accounts:[],positions:[],balances:[],history_plan:plan,
  option_history:[{client_order_id:'client',orders:[webullOrder()]}],order_details:[{client_order_id:'client',orders:[{...webullOrder(),...actualFees()}]}]};}
describe('Webull actual order fees',()=>{
  it('records exact actual fees with unknown currency and keeps execution history unsupported',()=>{
    const h=mapWebullHistory(webullBundle(),'webull')!;
    expect(h.orders[0].fees).toMatchObject({currency:null,total:'0.110'});
    expect(h.executions).toEqual([]);expect(h.sync.fees).toBe('partial');
    expect(h.sync.full_history_synced).toBe(false);
    expect(mergeBrokerHistory(h,h).orders).toHaveLength(1);
  });
  it('does not mistake receivable charges or absent fees for zero',()=>{
    expect(webullOrderFees({commission:{receivable_commission:'1'},fees:[]})).toBeUndefined();
    expect(webullOrderFees({commission:{actual_commission:'0'}})).toBeUndefined();
    expect(webullOrderFees({commission:{actual_commission:'0'},fees:[]})).toMatchObject({total:'0'});
    expect(webullOrderFees({actual_commission:'1',currency:'HKD',fees:[]})).toMatchObject({currency:'HKD',total:'1'});
  });
  it('rejects foreign accounts and never attaches a sibling order fee',()=>{
    const raw=webullBundle();(raw.order_details![0] as any).orders[0].account_id='B';
    expect(()=>mapWebullHistory(raw,'webull')).toThrow(/account/);
    (raw.order_details![0] as any).orders[0].order_id='sibling';
    expect(mapWebullHistory(raw,'webull')!.orders[0].fees).toBeUndefined();
  });
  it('retrieves separate broker orders even when the platform reuses a client ID', async () => {
    const ids:string[]=[];
    const raw=await fetchWebullRawBundle({app_key:'ak',app_secret:'sk',region:'sg',account_id:'A'},{history:plan,fetchImpl:async url=>{
      const u=new URL(String(url));
      if(u.pathname==='/trading/accounts/list')return Response.json([{account_id:'A'}]);
      if(u.pathname==='/trading/orders/historical-orders/list')return Response.json({data:[{orders:['a','b'].map(order_id=>({...webullOrder(),order_id}))}]});
      if(u.pathname==='/trading/orders/get'){
        const id=u.searchParams.get('order_id')!;ids.push(id);
        expect(u.searchParams.get('client_order_id')).toBe('client');
        return Response.json({client_order_id:'client',orders:[{...webullOrder(),order_id:id,...actualFees()}]});
      }
      return Response.json([]);
    }});
    expect(ids).toEqual(['a','b']);
    expect(mapWebullHistory(raw,'webull')!.orders.every(o=>o.fees?.total==='0.110')).toBe(true);
  });
  it.each([false,true])('fetches details by client order ID; optional failure=%s preserves history',async fail=>{
    let queried=false;
    const raw=await fetchWebullRawBundle({app_key:'ak',app_secret:'sk',region:'hk',account_id:'A'}, {history:plan,fetchImpl:async url=>{
      const u=new URL(String(url));
      if(u.pathname==='/trading/accounts/list')return Response.json([{account_id:'A'}]);
      if(u.pathname==='/trading/orders/historical-orders/list')return Response.json({data:[{client_order_id:'client',orders:[webullOrder()]}]});
      if(u.pathname==='/trading/orders/get'){
        queried=true;expect(u.searchParams.get('order_id')).toBe('o');expect(u.searchParams.get('client_order_id')).toBe('client');expect(u.searchParams.get('account_id')).toBe('A');
        return fail?new Response('unavailable',{status:503}):Response.json({client_order_id:'client',orders:[{...webullOrder(),...actualFees()}]});
      }
      return Response.json([]);
    }});
    expect(queried).toBe(true);expect(raw.option_history).toHaveLength(1);
    expect(mapWebullHistory(raw,'webull')!.orders[0].fees?.total).toBe(fail?undefined:'0.110');
  });
});

function openD(){return {acc_id:'A',history:{plan,deals:[{deal_id:'d',order_id:'o',code:'US.AAPL',qty:'2',price:'10',trd_side:'BUY',create_time:'2026-10-16 10:00:00'}],
  orders:[{order_id:'o',code:'US.AAPL',qty:'2',dealt_qty:'2',price:'10',trd_side:'BUY',order_status:'FILLED_ALL',order_type:'NORMAL',create_time:'2026-10-16 10:00:00'}],
  order_fees:[{order_id:'o',fee_amount:'1.123456789012',fee_details:[['Commission','1.123456789012']]}]}};}
describe('Futu OpenD reported fees',()=>{
  it('retains precise itemization and allocates only fully reconciled final fills',()=>{
    const h=mapFutubullHistory(openD(),'futubull')!;
    expect(h.orders[0].fees).toMatchObject({currency:'USD',total:'1.123456789012'});
    expect(h.executions[0].fee_cash).toBe('-1.123456789012');expect(h.sync.fees).toBe('available');
    const raw=openD();raw.history.orders[0].dealt_qty='3';
    expect(mapFutubullHistory(raw,'futubull')!.executions[0].fee_cash).toBeNull();
  });
  it('preserves unknown charges on unsupported gateways and rejects fee account mismatch',()=>{
    const raw=openD();raw.history.order_fees=[];
    const h=mapFutubullHistory(raw,'futubull')!;expect(h.sync.fees).toBe('unavailable');expect(h.executions[0].fee_cash).toBeNull();
    expect(h.sync.gaps.length).toBeGreaterThan(0);
    const foreign=openD();Object.assign(foreign.history.order_fees[0],{acc_id:'B'});
    expect(mapFutubullHistory(foreign,'futubull')!.orders[0].fees).toBeUndefined();
  });
});
