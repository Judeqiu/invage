import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { withPageProjections } from './helpers/portfolio-projection.js';
import { tradesFixture, optionFill } from './helpers/trades-fixture.js';
import { tradesHistory } from '../src/webapp/trades-v2-data.js';
import { selectDashboardTradeHistory } from '../src/webapp/dashboard-trade-history.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('shows and pages pre-observation trades and incomplete fills in dashboard Section 03', async () => {
  const state = tradesFixture();state.portfolio = {};
  state.option_executions!.push(optionFill({execution_id:'final-close',executed_at:'2026-10-02T10:00:00',side:'buy',effect:'close',contracts:'1',gross_premium:'-20'}));
  const rows = tradesHistory(state).rows;
  rows.push({...rows[0],id:'retained',underlying:'OLD<unsafe>',expiry:'2026-07-17',entryDate:null,entryThrough:null,lastTrade:'2026-07-18',status:'Incomplete history',multiplier:null,premium:null,netCash:null,paidToClose:null,realizedPnl:null,executions:[],
    sourceExecutions:[{broker_id:'ibkr',channel:'ibkr',account_id:'U1',id:'old-<unsafe>',order_id:null,native_symbol:'OLD-PUT',symbol:'OLD<unsafe>',instrument:'option',side:'buy',effect:'close',executed_at:'2026-07-18T10:00:00',clock:'America/New_York',currency:'USD',quantity:'2',price:'0',multiplier:null,gross_cash:null,fee_cash:null,option:{right:'put',expiry:'2026-07-17',strike:'150'}}]});
  const dashboard = withPageProjections({empty:false,displayName:'Test',productProfile:'consultant',generatedAt:'2026-10-28T07:00:00Z',dashboardConfig:{dashboardVersion:'v2'},
    model:buildDashboardModel(buildLivePositions({AAPL:{avg_price:100,units:1,channel:'ibkr',currency:'USD'}},{AAPL:110}),[]),optionAnalytics:{executions:[],gaps:[],profits:[]}});
  const root=resolve('webui'), requests:string[]=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url!,'http://localhost');const json=(v:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
    if(url.pathname.endsWith('/dashboard'))return json(dashboard);
    if(url.pathname.endsWith('/dashboard-cache'))return json({});
    if(url.pathname.endsWith('/option-history')){
      requests.push(url.search);if(url.searchParams.get('view')!=='trades')return json({episodes:[],connections:[],gaps:[],next_offset:null});
      const f=Object.fromEntries(['right','status','from','to','q','asOf'].map(k=>[k,url.searchParams.get(k)||''])) as any;
      const selected=selectDashboardTradeHistory(rows,f,r=>!url.searchParams.get('channel')||url.searchParams.get('channel')===r.channel);
      const offset=Number(url.searchParams.get('offset')||0);
      return json({trades:selected.slice(offset,offset+1).map(r=>({...r,positionEvidence:[]})),total:selected.length,next_offset:offset+1<selected.length?offset+1:null,connections:[{broker_id:'ibkr',channel:'ibkr',account_id:'U1',enabled:true}],history_started:true,gaps:[]});
    }
    const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/')||!existsSync(file)){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(readFileSync(file));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const origin=`http://127.0.0.1:${(server.address() as any).port}`;await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());
    await page.setViewport({width:1440,height:1100});await page.goto(origin+'/dashboard/v2.html');
    await page.waitForSelector('#optionHistoryTab');await page.click('#optionHistoryTab');
    await page.waitForFunction(()=>document.getElementById('optionHistoryTable')?.textContent?.includes('Closed'));
    expect(requests.some(q=>q.includes('view=trades'))).toBe(true);
    await page.click('#historyMore');await page.waitForFunction(()=>document.getElementById('optionHistoryTable')?.textContent?.includes('OLD<unsafe>'));
    expect(await page.$eval('#optionHistoryTable',n=>n.textContent)).toContain('Incomplete history');
    expect(await page.$$eval('#optionHistoryTable tbody tr',n=>n.length)).toBe(2);
    await page.click('[data-history-id="retained"]');
    expect(await page.$eval('#optionHistoryDetail',n=>n.textContent)).toContain('buy to close');
    expect(await page.$eval('#optionHistoryDetail',n=>n.textContent)).toContain('old-<unsafe>');
    expect(await page.$eval('#optionHistoryDetail',n=>n.textContent)).toContain('Unknown');
    expect(await page.$eval('#optionHistoryDetail',n=>n.textContent)).toContain('No saved position observations');
    expect(await page.$('#optionHistoryDetail unsafe')).toBeNull();
    await page.select('#historyStatus','incomplete');await expect.poll(()=>page.$$eval('#optionHistoryTable tbody tr',n=>n.length)).toBe(1);
    await page.screenshot({path:'/tmp/invage-dashboard-shared-history.png',fullPage:true});expect(errors).toEqual([]);
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
},30000);
