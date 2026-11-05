import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { applyBrokerNav } from '../src/report/broker-nav.js';
import { withPageProjections } from './helpers/portfolio-projection.js';
const chrome=process.env.CHROME_BINARY||'/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('shows complete broker NAV with source/time across merged and selected account, and sends matching Explain context',async()=>{
 const channel='moomoo-test';
 const live=buildLivePositions({'AAA@moomoo-test':{units:100,avg_price:150,currency:'USD',channel,broker_ref:{listing_exchange:'US'}}},{AAA:200},undefined,[{channel,currency:'USD',amount:4812.59}],[],undefined,{reportingCurrency:'USD',fxRates:{}},{resilient:true});
 const metrics={as_of:'2026-11-05',source_as_of:'2026-11-05T11:32:58.000Z',currency:'USD',broker_net_assets:29644.0691,broker_cash:4812.51,fund_assets:674.9};
 applyBrokerNav(live,{[channel]:metrics});
 const dashboard:any=withPageProjections({empty:false,displayName:'NAV test',productProfile:'consultant',generatedAt:'2026-11-05T11:33:07.490Z',equityPrices:{AAA:200},dashboardConfig:{dashboardVersion:'v2'},brokerAsOf:{[channel]:'2026-11-05'},connectionMetrics:{[channel]:metrics},brokerChannels:{[channel]:{brokerId:'moomoo',label:'Moomoo test'}},model:buildDashboardModel(live,[]),premiumJournal:{available:true,channels:[],daily:[]},optionAnalytics:{executions:[],gaps:[],profits:[]}});
 const root=resolve('webui');const prompts:string[]=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://localhost');const json=(x:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));};
  if(url.pathname.endsWith('/dashboard'))return json(dashboard);
  if(url.pathname.endsWith('/broker-sync'))return json(null);
  if(url.pathname.endsWith('/option-history'))return json({episodes:[],connections:[],gaps:[],next_offset:null});
  if(url.pathname==='/api/chat/messages'){let body='';for await(const chunk of req)body+=chunk;prompts.push(JSON.parse(body).text);return json({conversationId:'explain-nav'});}
  const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/')||!existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(origin)?req.continue():req.abort());
  await page.goto(origin+'/dashboard/v2.html');await page.waitForFunction(()=>document.getElementById('loadProgress')?.getAttribute('aria-valuenow')==='8');
  const nav=()=>page.$eval('#navValue',node=>node.textContent);
  expect(await nav()).toBe('$29,644.07');
  expect(await page.$eval('#v2Summary',node=>node.textContent)).toContain('Broker NAV');
  expect(await page.$eval('#navDelta',node=>node.textContent)).toContain('Broker NAV');
  expect(await page.$eval('#navDelta',node=>node.textContent)).toContain(metrics.source_as_of);
  await page.click('#channelPills button:nth-child(2)');
  expect(await nav()).toBe('$29,644.07');
  expect(await page.$eval('#navLabel',node=>node.textContent)).toBe('Net asset value (NAV)');
  expect(errors).toEqual([]);
 }finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}
},30000);
