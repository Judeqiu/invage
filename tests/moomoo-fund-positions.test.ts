import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {fetchMooMooFundPositions,fetchMooMooRawBundle} from '../src/moomoo/moomoo-client.js';

const credentials={app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519' as const,acc_id:'A'};
describe.each(['moomoo','futubull'] as const)('%s Cloud fund evidence',broker=>{
 it('uses the bound account and correct host, retaining exact signed values and unknown currency',async()=>{
  const body=JSON.stringify({s:'ok',d:{position_list:[{symbol:'FUND.A',short_name:'Native fund name',sub_acc_id:'9007199254740993',share_holdings:'-1.00000001',hold_cost:'0.00',market_value:'-3.123456789012345678'}]}});
  const result=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async(url,init)=>{
   expect(String(url)).toBe(`https://${broker==='futubull'?'webapi.futunn.com':'webapi.moomoo.com'}/api/v1.0/accounts/A/fund_positions`);
   expect(init?.method).toBe('GET');expect((init?.headers as Record<string,string>).Authorization).toBeTruthy();
   return new Response(body);
  }});
  expect(result.status).toBe('available');expect(result.response_body).toBe(body);
  expect((result.response?.d as any).position_list[0].currency).toBeUndefined();
  expect((result.response?.d as any).position_list[0].market_value).toBe('-3.123456789012345678');
 });
 it('preserves numeric native sub-account identity beyond safe integer precision',async()=>{
  const response_body='{"s":"ok","d":{"position_list":[{"symbol":"FUND.A","sub_acc_id":9007199254740993,"market_value":"0"}]}}';
  const result=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>new Response(response_body)});
  expect((result.response?.d as any).position_list[0].sub_acc_id).toBe('9007199254740993');
  expect(result.response_body).toBe(response_body);
 });
 it('distinguishes an explicitly empty list from malformed success',async()=>{
  for(const [d,status] of [[{position_list:[]},'available'],[{},'unavailable'],[{position_list:[null]},'unavailable']] as const){
   const result=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>Response.json({s:'ok',d})});
   expect(result.status).toBe(status);
  }
 });
 it('preserves the actual unsupported HTTP response, not an empty list',async()=>{
  const body=JSON.stringify({s:'error',errcode:485210001,errmsg:'The brokerage associated with this account does not currently support this feature.'});
  const result=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>new Response(body,{status:400})});
  expect(result).toMatchObject({status:'unavailable',http_status:400,response_body:body,failure:'http'});
  expect(result.response).toBeUndefined();
 });
 it('retains broker, parsing and transport failures independently',async()=>{
  const brokerFailure=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>Response.json({s:'error',errcode:123,errmsg:'Denied'})});
  expect(brokerFailure).toMatchObject({status:'unavailable',failure:'broker',response:{errcode:123}});
  expect(await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>new Response('invalid')})).toMatchObject({failure:'malformed',response_body:'invalid'});
  expect(await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async()=>{throw Error('offline');}})).toMatchObject({failure:'transport',response_body:null,http_status:null});
 });
 it('retries clock skew using the broker clock and retains the final response',async()=>{
  let count=0;
  const result=await fetchMooMooFundPositions({...credentials,broker},{fetchImpl:async(url)=>{
   if(new URL(String(url)).pathname==='/api/v1.0/server-time')return Response.json({server_time_ms:'1782971427455'});
   return Response.json(++count===1?{s:'error',errcode:-12006}:{s:'ok',d:{position_list:[]}});
  }});
  expect(count).toBe(2);expect(result.status).toBe('available');
 });
 it('keeps cash, securities and history sync working when funds are unsupported',async()=>{
  const raw=await fetchMooMooRawBundle({...credentials,broker},{fetchImpl:async(url)=>{
   const path=new URL(String(url)).pathname;
   if(path.endsWith('/authorized_trd_accs'))return Response.json({s:'ok',d:{accounts:[{account_id:'A'}]}});
   if(path.endsWith('/funds'))return Response.json({s:'ok',d:{currency:'USD',us_cash:'0',funds_assets:'0'}});
   if(path.endsWith('/positions'))return Response.json({s:'ok',d:[]});
   if(path.endsWith('/fund_positions'))return Response.json({s:'error',errcode:485210001},{status:400});
   if(path.endsWith('/fills_history'))return Response.json({s:'ok',d:{order_fills:[],completed:true}});
   if(path.endsWith('/orders_history'))return Response.json({s:'ok',d:{orders:[],completed:true}});
   throw Error('Unexpected request');
  }});
  expect(raw.fund_positions?.status).toBe('unavailable');expect(raw.funds.s).toBe('ok');expect(raw.positions.s).toBe('ok');expect(raw.history_error).toBeUndefined();
 });
});
