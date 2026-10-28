import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {useTestDatabase,createInvestorFixture} from './helpers/database.js';
await useTestDatabase({books:true});
const {migrateBooks}=await import('../src/books/migrate.js');
const {captureBrokerActivity}=await import('../src/brokers/activity-store.js');
const {loadBrokerActivityReport,loadBrokerActivityDetails,parseActivityKey,loadBrokerPositionReport,activityFields}=await import('../src/brokers/activity-report.js');
const {loadInvestor}=await import('../src/state/investor-store.js');
await migrateBooks();
const scope={brokerId:'moomoo',channel:'moomoo-A',accountId:'A'};
async function state() {
 const id=randomUUID();
 await createInvestorFixture({user:{id,created_at:'2026-10-01',auth_token:randomUUID()},profile:{display_name:'Activity',contact_email:`${id}@test.local`},log:[]});
 return (await loadInvestor(id)).state;
}
const capture=(user:string,data:unknown,ref:string,s=scope)=>captureBrokerActivity(user,s,{kind:'json',body:Buffer.from(JSON.stringify(data))},ref);
it('groups identified observations while preserving changed, zero and signed source values and unidentified rows',async()=>{
 const s=await state();
 const data={acc_id:'A',fills_history:{rows:[{deal_id:'precise',qty:'-1',price:'0.1234567890123456789',amount:'0',code:'US.SKHY261120P135000'}, {qty:'0',price:'-7.4400'}]},orders_history:{rows:[{order_id:'o',dealt_qty:'50',order_status:'FILLED_ALL'}]}};
 await capture(s.user.id,data,'one');
 await capture(s.user.id,{...data,extra:'new document'},'two');
 await capture(s.user.id,{acc_id:'A',fills_history:{rows:[{deal_id:'precise',qty:'-1',price:'-7.4400',amount:'0'}]}},'three');
 const report=await loadBrokerActivityReport(s);
 const r=report.activities.find(r=>r.sourceId==='precise')!;
 expect(r.observations).toBe(3);expect(r.versions).toBe(2);
 expect(r.fields.price.values.map(v=>v.value).sort()).toEqual(['-7.4400','0.1234567890123456789']);
 expect(r.fields.quantity.values).toEqual([{field:'qty',value:'-1'}]);
 expect(r.fields.amount.values).toEqual([{field:'amount',value:'0'}]);
 expect(report.activities.filter(r=>r.sourceId===null)).toHaveLength(2);
 const detail=await loadBrokerActivityDetails(s.user.id,parseActivityKey(r.key));
 expect(detail.observations).toHaveLength(3);
 expect((await loadBrokerActivityDetails(randomUUID(),parseActivityKey(r.key))).observations).toEqual([]);
 const noId=report.activities.find(r=>r.sourceId===null)!;
 expect((await loadBrokerActivityDetails(s.user.id,parseActivityKey(noId.key))).observations).toHaveLength(1);
 expect(parseActivityKey(r.key)).toHaveLength(5);
 expect(()=>parseActivityKey('["moomoo","a","A","other","x"]')).toThrow();
 expect((await loadInvestor(s.user.id)).state).toEqual(s);
});
it('separates broker accounts, excludes mismatched archives, and exposes lifecycle, stock, FX and cash records',async()=>{
 const s=await state();
 await capture(s.user.id,{acc_id:'B',fills_history:{rows:[{deal_id:'wrong'}]}},'mismatch');
 const xml=Buffer.from('<FlexStatement accountId="A"><Trades><Trade tradeID="stock" assetCategory="STK" quantity="-10"/><Trade tradeID="fx" assetCategory="CASH"/></Trades><OptionEAE tradeID="assignment" transactionType="Assignment"/><CashTransactions><CashTransaction transactionID="dividend" amount="0"/></CashTransactions></FlexStatement>');
 await captureBrokerActivity(s.user.id,{...scope,brokerId:'ibkr'},{kind:'xml',body:xml},'flex');
 await capture(s.user.id,{acc_id:'B',fills_history:{rows:[{deal_id:'stock',qty:'1'}]}},'other-account',{...scope,accountId:'B',channel:'moomoo-B'});
 const r=await loadBrokerActivityReport(s);
 expect(r.activities.some(a=>a.sourceId==='wrong')).toBe(false);
 expect(r.capture.some(c=>c.status==='account_mismatch')).toBe(true);
 expect(r.activities.filter(a=>a.sourceId==='stock')).toHaveLength(2);
 expect(r.activities.find(a=>a.sourceId==='assignment')?.category).toBe('lifecycle');
 expect(r.activities.find(a=>a.sourceId==='dividend')?.fields.amount.values[0].value).toBe('0');
 expect(r.activities.find(a=>a.sourceId==='fx')?.instruments).toEqual(['fx']);
});
it('does not guess a position source from a matching ticker without an exact applied-snapshot reference',async()=>{
 const s=await state();
 await capture(s.user.id,{acc_id:'A',positions:{rows:[{code:'US.SK',cost_price:'-7.44',pl_ratio:'0',unrealized_pl:'-374.2'}]}},'archive');
 expect(await loadBrokerPositionReport(s,'US.SK')).toMatchObject({available:false});
});
it('serves source activity only to the authenticated user and rejects malformed references',async()=>{
 const {default:express}=await import('express');
 const {default:request}=await import('supertest');
 const {createDashboardApiRouter}=await import('../src/webapp/dashboard-api.js');
 const own=await state(),other=await state();
 await capture(own.user.id,{acc_id:'A',fills_history:{rows:[{deal_id:'private',amount:'-5'}]}},'private');
 const app=(id?:string)=>{
  const a=express();if(id)a.use((req,_res,next)=>{Object.assign(req,{user:{userId:id}});next();});
  a.use(createDashboardApiRouter());return a;
 };
 expect((await request(app()).get('/broker-activity')).status).toBe(401);
 expect((await request(app(own.user.id)).get('/broker-activity?key=broken')).status).toBe(400);
 const response=await request(app(own.user.id)).get('/broker-activity');
 expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');
 const row=response.body.activities[0];expect(row.sourceId).toBe('private');
 const summary=await request(app(own.user.id)).get('/broker-activity?activity=0').expect(200);
 expect(summary.body.activities).toEqual([]);expect(summary.body.capture).toHaveLength(1);
 expect((await request(app(other.user.id)).get('/broker-activity')).body.activities).toEqual([]);
 expect((await request(app(other.user.id)).get('/broker-activity').query({key:row.key})).body.observations).toEqual([]);
});
it('resolves a broker position only from its applied snapshot, preserving reported P/L zero and signed basis',async()=>{
 const s=await state();
 s.broker_sources={access:{broker_id:'moomoo',credentials:{}}};
 s.broker_connections={connection:{broker_id:'moomoo',source_id:'access',label:'Source',channel:'moomoo-a',account_id:'A',enabled:true,config:{acc_id:'A'}}};
 s.portfolio={position:{channel:'moomoo-a',units:1,avg_price:-744,broker_ref:{native_id:'US.SK'}}};
 s.option_observations=[{id:'applied',broker_id:'moomoo',connection_id:'connection',channel:'moomoo-a',account_id:'A',observed_at:'2026-10-28T01:00:00Z',as_of:'2026-10-28',source:'broker',complete:true,skipped_positions:0,options:[]}];
 const data={acc_id:'A',positions:{rows:[{code:'US.SK',cost_price:'-7.4400',pl_ratio:'0',pl_val:'-1253.2',unrealized_pl:'-374.2'}]}};
 await capture(s.user.id,data,'sync:applied',{...scope,channel:'moomoo-a'});
 await capture(s.user.id,{...data,positions:{rows:[{code:'US.SK',cost_price:'12345'}]}},'older-archive-captured-later',{...scope,channel:'moomoo-a'});
 const result=await loadBrokerPositionReport(s,'position');
 expect(result.available).toBe(true);expect(result.rows).toHaveLength(1);
 expect(result.rows![0].data).toMatchObject({cost_price:'-7.4400',pl_ratio:'0',pl_val:'-1253.2',unrealized_pl:'-374.2'});
});

it('shows quantity scales as source metadata rather than treating a scale as a quantity',()=>{
 expect(activityFields({filledQuantity:'1000000',filledQuantityScale:'6'}).quantity).toEqual({field:'filledQuantity',value:'1000000',scale:{field:'filledQuantityScale',value:'6'}});
 expect(activityFields({filledQuantityScale:'6'}).quantity).toBeNull();
});

it('flags fields absent in an otherwise identified observation instead of dropping that version',async()=>{
 const s=await state();
 await capture(s.user.id,{acc_id:'A',fills_history:{rows:[{deal_id:'sparse'}]}},'sparse');
 await capture(s.user.id,{acc_id:'A',fills_history:{rows:[{deal_id:'sparse',price:'0'}]}},'zero');
 const r=(await loadBrokerActivityReport(s)).activities[0];
 expect(r.observations).toBe(2);expect(r.fields.price).toEqual({values:[{field:'price',value:'0'}],missing:true});
});
