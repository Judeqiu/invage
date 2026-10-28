import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
import {buildDashboardModel,buildLivePositions} from '../src/report/dashboard-model.js';
import {activityFields,commonActivityFields} from '../src/brokers/activity-report.js';
import {withPageProjections} from './helpers/portfolio-projection.js';
const chrome=process.env.CHROME_BINARY||'/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('shows source freshness, all activity versions and signed basis without presenting unknowns as zero',async()=>{
 const root=resolve('webui');let fail=false,posts=0;const activityRequests:string[]=[];
 const fields=commonActivityFields([activityFields({code:'US.SK',qty:'-1',price:'-7.4400',amount:'0'}),activityFields({code:'US.SK',qty:'-1',price:'0'})]);
 const activities=[{key:'one',brokerId:'moomoo',channel:'moomoo',accountId:'A',category:'execution',sourceId:'deal',instruments:['option'],observations:2,versions:2,fields},
 {key:'two',brokerId:'ibkr',channel:'ibkr',accountId:'B',category:'cash_activity',sourceId:'dividend',instruments:[],observations:1,versions:1,fields:commonActivityFields([activityFields({symbol:'AAPL',type:'Dividends',amount:'1.23'})])}];
 const report={available:true,accounts:[{brokerId:'moomoo',channel:'moomoo',accountId:'A',label:'Moomoo',snapshotDate:'2026-10-23',lastSync:{ok:false,at:'2026-10-28T00:00:00Z',error:'401 Unauthorized'},history:{status:'partial',from:'2026-01-01',through:'2026-10-23',gaps:[{reason:'Missing cash endpoints'}]}}],capture:[],activities};
 const payload=withPageProjections({empty:false,displayName:'Evidence',generatedAt:'2026-10-28T01:00:00Z',brokerAsOf:{moomoo:'2026-10-23'},connectionMetrics:{moomoo:{as_of:'2026-10-23',currency:'USD',fund_assets:-3496.2395}},dashboardConfig:{dashboardVersion:'v2',showBrokerActivity:true,showTotalPremium:true,showRealizedPnl:true},model:buildDashboardModel(buildLivePositions({negative:{instrument:'option',channel:'moomoo',currency:'USD',units:1,avg_price:-744,option:{underlying:'SKHY',right:'put',side:'short',strike:135,expiry:'2026-11-20',multiplier:100,settlement:'physical',mark:509.2}}},{SKHY:120}),[])});
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://localhost');
  if(req.method!=='GET')posts++;
  const json=(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(url.pathname.endsWith('/broker-activity')){
   activityRequests.push(url.search);
   if(url.searchParams.get('activity')==='0')return json({...report,activities:[]});
   if(fail){res.statusCode=503;return json({});}
   return json(url.searchParams.has('key')?{observations:[{data:{price:'-7.4400'}},{data:{price:'0'}}]}:report);
  }
  if(url.pathname.endsWith('/broker-position-report'))return json({available:true,rows:[{data:{cost_price:'-7.4400',pl_ratio:'0',pl_val:'-1253.2'}}]});
  if(url.pathname.endsWith('/dashboard'))return json(payload);
  if(url.pathname.endsWith('/dashboard-cache'))return json({});
  if(url.pathname.endsWith('/option-history'))return json({episodes:[],connections:[],gaps:[],next_offset:null});
  const file=resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+'/')||!existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());
  await page.setViewport({width:1440,height:1100});await page.goto(origin+'/dashboard/v2.html');
  await page.waitForSelector('[data-activity-key]');await page.waitForSelector('[data-broker-position]');
  const status=await page.$eval('#brokerReportStatus',n=>n.textContent);
  expect(status).toContain('2026-10-23');expect(status).toContain('Failed');expect(status).toContain('401 Unauthorized');
  expect(await page.$eval('#brokerActivity',n=>n.textContent)).toContain('2 of 2 grouped records');
  expect(await page.$eval('#brokerActivity',n=>n.textContent)).toContain('Multiple reported values');
  expect(await page.$eval('#brokerActivity',n=>n.textContent)).toContain('Source not provided');
  expect(await page.$eval('#openOptions',n=>n.textContent)).toContain('-7.44');
  expect(await page.$eval('#openOptions',n=>n.textContent)).toContain('Unavailable %');
  expect(await page.$eval('#v2Summary',n=>n.textContent)).toContain('Before fees');
  expect(await page.$eval('#v2Summary',n=>n.textContent)).toContain('−$3,496.24');
  expect(await page.$eval('#v2Summary',n=>n.textContent)).toContain('Excluded from itemized portfolio value');
  await page.select('[data-activity-filter="category"]','cash_activity');
  expect(await page.$eval('#brokerActivity',n=>n.textContent)).toContain('1 of 2 grouped records');
  await page.select('[data-activity-filter="category"]','');
  await page.select('[data-activity-filter="account"]','B');
  await page.click('#channelPills [data-channel="moomoo"]');
  expect(await page.$eval('[data-activity-filter="account"]',n=>(n as HTMLSelectElement).value)).toBe('');
  expect(await page.$eval('#brokerActivity',n=>n.textContent)).toContain('1 of 1 grouped records');
  await page.click('#channelPills [data-channel="merged"]');
  await page.type('[data-activity-search]','US.SK');
  expect(await page.$$('#brokerActivity tbody tr')).toHaveLength(1);
  await page.click('[data-activity-key="one"]');await page.waitForFunction(()=>document.querySelector('dialog[open] pre')?.textContent?.includes('-7.4400'));
  expect(await page.$eval('dialog[open] pre',n=>n.textContent)).toContain('"0"');await page.keyboard.press('Escape');
  await page.click('[data-broker-position]');await page.waitForFunction(()=>document.querySelector('dialog[open] pre')?.textContent?.includes('pl_ratio'));
  expect(await page.$eval('dialog[open] pre',n=>n.textContent)).toContain('"pl_ratio": "0"');await page.keyboard.press('Escape');
  fail=true;await page.click('[data-activity-reload]');await page.waitForSelector('#brokerReportStatus [role="alert"]');
  expect(await page.$$('#brokerActivity tbody tr')).toHaveLength(1);
  fail=false;await page.click('#brokerReportStatus [data-activity-reload]');await page.waitForSelector('#brokerReportStatus article');
  for(const width of [390,768,1440]){await page.setViewport({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  // A new user without the setting sees status but no activity table or full-activity request.
  delete payload.dashboardConfig.showBrokerActivity;
  activityRequests.length=0;
  await page.reload();await page.waitForSelector('#brokerReportStatus article');
  await page.waitForSelector('#openOptions .option-ledger-row');
  expect(await page.$eval('#brokerActivity',n=>(n as HTMLElement).hidden)).toBe(true);
  expect(activityRequests.length).toBeGreaterThan(0);
  expect(activityRequests.every(q=>q==='?activity=0')).toBe(true);
  expect(posts).toBe(0);expect(errors).toEqual([]);
  await page.screenshot({path:'/tmp/invage-broker-activity-desktop.png',fullPage:true});
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:'/tmp/invage-broker-activity-mobile.png',fullPage:true});
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},30000);

it('separates physical call deliveries by account and underlying and does not assign shares to cash-settled calls',()=>{
 const source=readFileSync('webui/dashboard/app.js','utf8');
 const fn=source.slice(source.indexOf('function callShareDeliveryCard('),source.indexOf('function netRiskCapitalCard('));
 const result=runInNewContext(`${fn}\ncallShareDeliveryCard(view)`,{
  view:{positions:[
   {channel:'A',units:2,option:{underlying:'AAPL',right:'call',side:'short',settlement:'physical',multiplier:100}},
   {channel:'B',units:1,option:{underlying:'AAPL',right:'call',side:'short',settlement:'physical',multiplier:10}},
   {channel:'A',units:100,option:{underlying:'INDEX',right:'call',side:'short',settlement:'cash',multiplier:100}},
   {channel:'A',units:1,option:{underlying:'UNKNOWN',right:'call',side:'short',multiplier:100}},
  ]},optionUnderlyingLabel:(o:any)=>o.underlying,escapeHtml:(s:string)=>s,metricCardHtml:(title:string,value:string)=>({title,value}),
 });
 expect(result.value).toContain('A · AAPL: 200 shares');expect(result.value).toContain('B · AAPL: 10 shares');
 expect(result.value).toContain('A · UNKNOWN: Unavailable');expect(result.value).not.toContain('INDEX');
});
