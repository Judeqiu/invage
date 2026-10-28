import {expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
import {buildDashboardModel,buildLivePositions} from '../src/report/dashboard-model.js';
import {withPageProjections} from './helpers/portfolio-projection.js';
const chrome=process.env.CHROME_BINARY||'/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('retains only numerical corrections in the restored dashboard',async()=>{
 const root=resolve('webui');
 const option=(underlying:string,avg_price:number,multiplier:number)=>({instrument:'option' as const,channel:'moomoo',currency:'USD',units:1,avg_price,option:{underlying,right:'put' as const,side:'short' as const,strike:135,expiry:'2026-11-20',multiplier,settlement:'physical' as const,mark:509.2}});
 const payload=withPageProjections({empty:false,displayName:'Numbers',generatedAt:'2026-10-28T01:00:00Z',brokerAsOf:{moomoo:'2026-10-28'},connectionMetrics:{moomoo:{as_of:'2026-10-28',currency:'USD',fund_assets:-123.45}},dashboardConfig:{dashboardVersion:'v2',showTotalPremium:true,showRealizedPnl:true},model:buildDashboardModel(buildLivePositions({negative:option('SKHY',-744,100),zero:option('ZERO',100,0)},{SKHY:120,ZERO:120}),[])});
 const server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://localhost');
  const json=(data:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(url.pathname.endsWith('/dashboard'))return json(payload);
  if(url.pathname.endsWith('/dashboard-cache')||url.pathname.endsWith('/broker-sync'))return json(null);
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
  await page.setViewport({width:1440,height:900});await page.goto(origin+'/dashboard/v2.html');
  await page.waitForSelector('#openOptions .option-ledger-row');
  expect(await page.$eval('[data-option-underlying="SKHY"] td:nth-child(5)',n=>n.textContent)).toBe('-7.44');
  expect(await page.$eval('[data-option-underlying="ZERO"] td:nth-child(3)',n=>n.textContent)).toBe('—');
  expect(await page.$eval('[data-option-underlying="ZERO"] td:nth-child(5)',n=>n.textContent)).toBe('—');
  expect(await page.$eval('#v2Summary',n=>n.textContent)).toContain('−$123.45');
  expect(await page.$('#brokerActivity')).toBeNull();expect(await page.$('#brokerReportStatus')).toBeNull();
  expect(await page.$eval('#v2Summary',n=>n.textContent)).toContain('Premium & earnings');
  expect(await page.$eval('.option-ledger thead',n=>n.textContent)).toContain('PREMIUM / ROLL');
  expect(await page.$eval('#v2Summary',n=>n.textContent)).not.toContain('Call share-delivery');
  expect(errors).toEqual([]);
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
