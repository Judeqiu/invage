import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapMooMooBundleToStatement } from '../src/moomoo/moomoo-map.js';
import { fetchMooMooRawBundle } from '../src/moomoo/moomoo-client.js';
import { mergeBrokerHistory,planBrokerHistorySync } from '../src/brokers/history.js';
import { addDecimals } from '../src/brokers/option-executions.js';
import { parseRelationshipArchive } from '../src/brokers/option-relationships.js';
import type { MooMooRawBundle } from '../src/moomoo/moomoo-types.js';
const closing='US.AVGO261023C375000',opening='US.AVGO261218C400000';
const start='946684800000000',end='1791936000000000';
const time=String(Date.parse('2026-10-07T14:46:31Z')*1000);
const fill=(id:string,code:string,side:string,price:string)=>({deal_id:id,order_id:'parent',code,trd_side:side,qty:'1',price,status:'OK',create_time:time});
const parent=()=>({order_id:'parent',code:'US.AVGO',exchange:'US',side:'SELL',order_status:'FILLED_ALL',create_time:time,updated_time:time,currency:'USD',qty:'1',price:'8.15',dealt_qty:'1',dealt_avg_price:'8.15',order_type:'LIMIT',time_in_force:'DAY',session:'RTH',security_type:'MULTILEG_OPTION',multi_leg_info:{leg_infos:[
  {leg_code:closing,leg_side:'BUY_BACK',leg_ratio_qty:'1',leg_security_type:'OPTION',leg_hp_multiplier:'100'},
  {leg_code:opening,leg_side:'SELL_SHORT',leg_ratio_qty:'1',leg_security_type:'OPTION',leg_hp_multiplier:'100'},
]}});
function bundle():MooMooRawBundle{return {schema:'invage.moomoo.raw.v1',acc_id:'A',fetched_at:'2026-10-14T00:00:00Z',authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'1000'}},positions:{s:'ok',d:[]},fills_history:{start,end,rows:[fill('close',closing,'BUY_BACK','11.35'),fill('open',opening,'SELL_SHORT','19.50')]},orders_history:{start,end,rows:[parent()]},orders_details:[parent()],history_mode:'full'};}
const credentials={app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519' as const};
describe('Moomoo historical data',()=>{
  it('recovers David’s roll from exact parent leg metadata when expired quotes are absent',()=>{
    const raw=bundle(),statement=mapMooMooBundleToStatement(raw,'moomoo-A');
    expect(statement.history?.sync).toMatchObject({status:'complete',full_history_synced:true,fees:'unavailable'});
    expect(statement.history!.orders[0]).toMatchObject({id:'parent',filled_price:'8.15',legs:[{native_symbol:closing,effect:'close',multiplier:'100'},{native_symbol:opening,effect:'open',multiplier:'100'}]});
    expect(statement.option_executions).toHaveLength(2);
    expect(addDecimals(...statement.option_executions!.map(e=>e.gross_premium))).toBe('815.00');
    expect(statement.option_executions!.every(e=>e.commission===null)).toBe(true);
    const archive=parseRelationshipArchive('moomoo',Buffer.from(JSON.stringify(raw)),'A',{id:'test',version:'1'});
    expect(archive.map(f=>f.cash).sort()).toEqual(['-1135','1950']);
  });
  it('retains stock trades and unavailable expired contract data independently of current holdings',()=>{
    const raw=bundle();raw.fills_history!.rows.push(fill('stock','US.AAPL','BUY','200'),fill('unresolved','US.AVGO260911C380000','SELL_SHORT','3.25'));
    const statement=mapMooMooBundleToStatement(raw,'moomoo-A');
    expect(statement.history!.executions).toHaveLength(4);expect(statement.option_executions).toHaveLength(2);
    expect(statement.history!.executions.find(e=>e.id==='stock')).toMatchObject({instrument:'security',gross_cash:'-200',symbol:'AAPL',multiplier:'1'});
    expect(statement.history!.executions.find(e=>e.id==='unresolved')).toMatchObject({multiplier:null,gross_cash:null});
    expect(statement.history!.sync).toMatchObject({status:'partial',full_history_synced:false,gaps:[{kind:'metadata',reference:'US.AVGO260911C380000'}]});
    expect(planBrokerHistorySync(statement.history,'A').mode).toBe('full');
  });
  it('keeps signed spread prices and previously verified legs when details temporarily disappear',()=>{
    const first=mapMooMooBundleToStatement(bundle(),'moomoo-A').history!;
    const raw=bundle();raw.orders_details=[];delete (raw.orders_history!.rows[0] as Record<string,unknown>).multi_leg_info;
    raw.option_basicinfo=[closing,opening].map(code=>({code,stock_type:'DRVT',contract_size:100}));
    raw.history_gaps=[{reference:'parent',reason:'details temporarily unavailable'}];raw.history_mode='incremental';
    raw.orders_history!.rows[0].price='-8.15';raw.orders_history!.rows[0].dealt_avg_price='-8.15';
    const next=mergeBrokerHistory(first,mapMooMooBundleToStatement(raw,'moomoo-A').history!);
    expect(next.orders[0].legs).toHaveLength(2);expect(next.orders[0].limit_price).toBe('-8.15');expect(next.sync.status).toBe('partial');
  });
  it('enriches older unpriced archives with newly verified adjusted contract sizes',()=>{
    const raw=bundle();raw.orders_details=[];raw.orders_history!.rows=[];
    const sizes=new Map([[closing,'25'],[opening,'25']]);
    const archive=parseRelationshipArchive('moomoo',Buffer.from(JSON.stringify(raw)),'A',{id:'old',version:'1'},sizes);
    expect(archive.map(f=>f.contract.multiplier)).toEqual(['25','25']);
    expect(archive.map(f=>f.cash).sort()).toEqual(['-283.75','487.5']);
    raw.option_basicinfo=[{code:closing,stock_type:'DRVT',contract_size:100}];
    expect(()=>parseRelationshipArchive('moomoo',Buffer.from(JSON.stringify(raw)),'A',{id:'old',version:'1'},sizes)).toThrow(/Conflicting/);
  });
  it('rejects historical rows belonging to another broker account',()=>{
    const raw=bundle();raw.fills_history!.rows[0].account_id='other';
    expect(()=>mapMooMooBundleToStatement(raw,'moomoo-A')).toThrow(/account mismatch/);
  });
  it('rejects contradictory exact contract multipliers',()=>{
    const raw=bundle();raw.option_basicinfo=[{code:closing,stock_type:'DRVT',contract_size:25}];
    expect(()=>mapMooMooBundleToStatement(raw,'moomoo-A')).toThrow(/Conflicting/);
  });
  function transport(detailsUnavailable=false,malformed=false,held=false){
    const requests:{url:URL;body?:Record<string,unknown>}[]=[],raw=bundle();let usPages=0;
    if(held)raw.positions.d=[{code:opening,qty:'-1',position_side:'SHORT',currency:'USD',cost_price:'19.50',cost_price_valid:true,nominal_price:'1'}];
    const fetchImpl:typeof fetch=async(url,init)=>{
      const u=new URL(String(url));requests.push({url:u,...(init?.body?{body:JSON.parse(String(init.body))}:{})});
      if(u.pathname.endsWith('/authorized_trd_accs'))return Response.json({s:'ok',d:[{account_id:'A'}]});
      if(u.pathname.endsWith('/funds'))return Response.json(raw.funds);
      if(u.pathname.endsWith('/positions'))return Response.json(raw.positions);
      if(u.pathname.endsWith('/fills_history'))return Response.json({s:'ok',d:{order_fills:u.searchParams.get('trd_market')==='US'?raw.fills_history!.rows:[],completed:true}});
      if(u.pathname.endsWith('/orders_history')){
        if(u.searchParams.get('trd_market')==='HK')return Response.json({s:'ok',d:{orders:[],completed:true}});
        // Recent fills reference an old parent excluded from the order creation window.
        usPages++;
        return Response.json({s:'ok',d:{orders:[],completed:usPages>1,page_flag:'cursor'}});
      }
      if(u.pathname.endsWith('/orders/detail')){
        expect(init?.method).toBe('POST');expect(JSON.parse(String(init?.body))).toEqual({exchange:'US',order_ids:['parent']});
        if(detailsUnavailable)return Response.json({s:'error',errcode:500});
        return Response.json({s:'ok',d:malformed?[parent(),{...parent(),order_id:'wrong'}]:[parent()]});
      }
      if(u.pathname.endsWith('/stock-basicinfo'))return Response.json({ret_code:-7});
      throw new Error(`unexpected ${u.pathname}`);
    };return {fetchImpl,requests};
  }
  it('paginates order history, uses stable incremental bounds, and fetches an old parent for new fills',async()=>{
    const t=transport(),plan={mode:'incremental' as const,from:'2026-10-07T00:00:00.000Z',through:'2026-10-14T00:00:00.000Z'};
    const raw=await fetchMooMooRawBundle(credentials,{...t,history:plan});
    expect(raw.orders_details).toHaveLength(1);expect(raw.history_mode).toBe('incremental');
    const histories=t.requests.filter(r=>/\/(orders_history|fills_history)$/.test(r.url.pathname));
    expect(new Set(histories.map(r=>r.url.searchParams.get('start')))).toEqual(new Set([String(Date.parse(plan.from)*1000)]));
    expect(new Set(histories.map(r=>r.url.searchParams.get('end')))).toEqual(new Set([String(Date.parse(plan.through)*1000)]));
    expect(histories.filter(r=>r.url.pathname.endsWith('/orders_history')).map(r=>r.url.searchParams.get('page_flag'))).toEqual(['','cursor','']);
    expect(mapMooMooBundleToStatement(raw,'moomoo-A').option_executions).toHaveLength(2);
  });
  it('uses verified parent-leg size for a current holding omitted by the quote directory',async()=>{
    const raw=await fetchMooMooRawBundle(credentials,transport(false,false,true));
    const statement=mapMooMooBundleToStatement(raw,'moomoo-A');
    expect(statement.lots[0].holding.option!.multiplier).toBe(100);
    expect(statement.history!.sync.status).toBe('complete');
  });
  it.each([[true,false],[false,true]])('retains partial data on failed or contaminated order detail batches',async(unavailable,malformed)=>{
    const raw=await fetchMooMooRawBundle(credentials,transport(unavailable,malformed));
    expect(raw.orders_details).toEqual([]);expect(raw.history_gaps).toHaveLength(1);
    const mapped=mapMooMooBundleToStatement(raw,'moomoo-A');expect(mapped.history!.executions).toHaveLength(2);expect(mapped.option_executions).toEqual([]);
    expect(mapped.history!.sync.status).toBe('partial');expect(planBrokerHistorySync(mapped.history,'A').mode).toBe('full');
  });
});

describe('Moomoo position snapshot safety',()=>{
  it.each([undefined,null,{}, {positions:[]}, [null], [[]], [{}], [{code:'US.AAPL',qty:'not-a-number'}]])('rejects malformed positions instead of treating them as an empty account (%j)',value=>{
    const raw=bundle();raw.positions.d=value;
    expect(()=>mapMooMooBundleToStatement(raw,'moomoo')).toThrow(/positions response is incomplete/);
  });
  it('preserves a large legacy Moomoo account while historical metadata remains partial',()=>{
    const raw=bundle();
    raw.positions.d=Array.from({length:129},(_,i)=>({code:`US.TEST${i}`,qty:'1',currency:'USD',position_side:'LONG',cost_price:'10',cost_price_valid:true,nominal_price:'11'}));
    raw.fills_history!.rows.push(fill('unpriced','US.AVGO260911C380000','SELL_SHORT','3.25'));
    const statement=mapMooMooBundleToStatement(raw,'moomoo');
    expect(statement.lots).toHaveLength(129);expect(statement.history!.sync.status).toBe('partial');
    expect(statement.lots.every(l=>l.holding.channel==='moomoo')).toBe(true);
    raw.positions.d=[];expect(mapMooMooBundleToStatement(raw,'moomoo').lots).toEqual([]);
  });
});

it('retains amount-based and rejected orders with an unreported requested quantity',()=>{
  const raw=bundle();const amount={...parent(),order_id:'amount',code:'US.META',security_type:'STOCK',qty:'',dealt_qty:'0.0066',dealt_avg_price:'149.8'};
  delete (amount as Partial<ReturnType<typeof parent>>).multi_leg_info;
  raw.orders_history!.rows.push(amount,{...amount,order_id:'rejected',order_status:'FAILED',dealt_qty:'0',dealt_avg_price:''});
  const mapped=mapMooMooBundleToStatement(raw,'moomoo');
  expect(mapped.history!.orders.find(o=>o.id==='amount')).toMatchObject({quantity:null,filled_quantity:'0.0066',filled_price:'149.8'});
  expect(mapped.history!.orders.find(o=>o.id==='rejected')).toMatchObject({quantity:null,filled_quantity:'0',filled_price:null});
  expect(mapped.option_executions).toHaveLength(2);
});
