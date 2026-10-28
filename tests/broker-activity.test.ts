import {expect,it} from 'vitest';
import {extractBrokerActivity,parseBrokerJsonExact} from '../src/brokers/activity.js';
const scope={brokerId:'moomoo',channel:'moomoo-A',accountId:'A'};
const json=(raw:unknown)=>Buffer.from(JSON.stringify(raw));
it('keeps exact numeric tokens, strings, booleans and unknown broker fields',()=>{
  expect(parseBrokerJsonExact('{"id":9007199254740993123,"money":0.1234567890123456789,"s":"123\\\"4","b":false,"x":null,"e":1e-20}'))
    .toEqual({id:'9007199254740993123',money:'0.1234567890123456789',s:'123"4',b:false,x:null,e:'1e-20'});
});
it('indexes both rights, low strikes, stocks and nested orders without inventing money',()=>{
  const result=extractBrokerActivity(json({acc_id:'A',fills_history:{rows:[
    {deal_id:'p',code:'US.MBLY260821P8000',price:'0.52',qty:'20'},
    {deal_id:'c',code:'US.AMD261218C200000',price:'5'},
    {deal_id:'stock',code:'US.AMD',qty:'100'}]},
    orders_details:[{order_id:'order',legs:[{code:'US.MBLY260821P8000',ratio:'1'}]}],future_endpoint:{unrecognized:'kept'}}),'json',scope);
  expect(result.status).toBe('indexed');
  expect(result.records.find(r=>r.sourceId==='p')).toMatchObject({category:'execution',instrument:'option',data:{price:'0.52',qty:'20'}});
  expect(result.records.find(r=>r.sourceId==='c')?.instrument).toBe('option');
  expect(result.records.find(r=>r.sourceId==='stock')?.category).toBe('execution');
  expect(result.records.find(r=>r.path==='/orders_details[0]/legs[0]')).toMatchObject({parentPath:'/orders_details[0]'});
  expect(result.records.some(r=>r.data.unrecognized==='kept')).toBe(true);
  expect(result.records.every(r=>!('gross_cash' in r.data))).toBe(true);
});
it('retains lifecycle order attributes and separate stock delivery observations',()=>{
  const result=extractBrokerActivity(json({account:'A',history:{orders:[
    {id:'option',orderId:'0',secType:'OPT',attrList:['ASSIGNMENT'],filledQuantity:6},
    {id:'stock',orderId:'parent',secType:'STK',attrList:['EXERCISE'],filledQuantity:600}]}}),'json',{...scope,brokerId:'tiger'});
  expect(result.records.filter(r=>r.category==='lifecycle').map(r=>r.instrument)).toEqual(['option','equity']);
  expect(result.records.filter(r=>r.category==='lifecycle').map(r=>r.sourceId)).toEqual(['option','stock']);
});
it('indexes all selected Flex sections and excludes other accounts',()=>{
  const body=Buffer.from(`<FlexQueryResponse><FlexStatements>
    <FlexStatement accountId="B"><Trades><Trade accountId="B" tradeID="foreign"/></Trades></FlexStatement>
    <FlexStatement accountId="A"><Trades>
      <Trade accountId="A" tradeID="stock" assetCategory="STK" transactionType="BookTrade" quantity="100"/>
      <Trade accountId="A" tradeID="fx" assetCategory="CASH" quantity="123.4567890123456789"/>
    </Trades><OptionEAE tradeID="assign" transactionType="Assignment"/>
    <CashTransactions><CashTransaction transactionID="div" type="Dividends" amount="1.23"/></CashTransactions>
    <Transfers><Transfer transactionID="transfer"/></Transfers>
    <CorporateActions><CorporateAction transactionID="split"/></CorporateActions>
    <NewSection><NewField id="future">unchanged text</NewField></NewSection>
    </FlexStatement></FlexStatements></FlexQueryResponse>`);
  const result=extractBrokerActivity(body,'xml',{...scope,brokerId:'ibkr'});
  expect(result.status).toBe('indexed');expect(result.gaps).toEqual([]);
  expect(result.records.some(r=>r.sourceId==='foreign')).toBe(false);
  expect(result.records.find(r=>r.sourceId==='stock')).toMatchObject({category:'execution',instrument:'equity',data:{transactionType:'BookTrade'}});
  expect(result.records.find(r=>r.sourceId==='fx')).toMatchObject({category:'execution',instrument:'fx',data:{quantity:'123.4567890123456789'}});
  expect(result.records.find(r=>r.sourceId==='assign')?.category).toBe('lifecycle');
  expect(result.records.find(r=>r.sourceId==='div')?.category).toBe('cash_activity');
  expect(result.records.find(r=>r.sourceId==='future')?.data._text).toBe('unchanged text');
});
it('does not confuse account directories with foreign account records',()=>{
  expect(extractBrokerActivity(json({acc_id:'A',authorized:{d:[{acc_id:'B'}]},positions:{d:[]}}),'json',scope).status).toBe('indexed');
  const result=extractBrokerActivity(json({acc_id:'A',fills_history:{rows:[{account_id:'B',deal_id:'bad'}]}}),'json',scope);
  expect(result).toMatchObject({status:'account_mismatch',records:[]});
});
it('reports omitted Flex sections and refuses malformed or unbound records',()=>{
  expect(extractBrokerActivity(Buffer.from('<FlexStatement accountId="A"/>'),'xml',scope).gaps).toContain('Flex report omits CashTransactions; coverage is unknown.');
  expect(extractBrokerActivity(json({fills_history:{rows:[{deal_id:'x'}]}}),'json',scope)).toMatchObject({status:'unverified',records:[]});
  expect(extractBrokerActivity(json({fills_history:{rows:[{account_id:'A',deal_id:'x'}]}}),'json',scope)).toMatchObject({status:'unverified',records:[]});
  expect(extractBrokerActivity(Buffer.from('{broken'),'json',scope)).toMatchObject({status:'unparsed',records:[]});
  expect(extractBrokerActivity(Buffer.from('<FlexStatement accountId="A"><Trade>'),'xml',scope)).toMatchObject({status:'unparsed',records:[]});
  expect(extractBrokerActivity(Buffer.from('<!DOCTYPE x><x/>'),'xml',scope).status).toBe('unparsed');
});
