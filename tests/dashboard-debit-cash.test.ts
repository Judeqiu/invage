import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync,readFileSync } from 'node:fs';
import { resolve,extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel,buildLivePositions } from '../src/report/dashboard-model.js';
import { withPageProjections } from './helpers/portfolio-projection.js';

const chrome=process.env.CHROME_BINARY||'/usr/bin/chromium';
it.skipIf(!existsSync(chrome)).each(['index.html','v2.html'])('%s shows the original currency debit even with positive net cash',async file=>{
  const root=resolve('webui');
  const payload=withPageProjections({empty:false,displayName:'Test',productProfile:'consultant',generatedAt:'2026-10-27T07:06:00Z',
    model:buildDashboardModel(buildLivePositions({AAPL:{units:10,avg_price:100,currency:'USD',channel:'tiger'}},{AAPL:200},{},
      [{amount:10000,currency:'USD',channel:'tiger'},{amount:-4955.41,currency:'SGD',channel:'tiger'}],[],
      '2026-10-27',{reportingCurrency:'USD',fxRates:{SGD:0.75}}),[]),dashboardConfig:{showDailyChanges:false}});
  const server=createServer((req,res)=>{
    const url=new URL(req.url!,'http://localhost');
    const json=(body:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    if(url.pathname.endsWith('/dashboard'))return json(payload);
    if(url.pathname.endsWith('/dashboard-cache')||url.pathname.endsWith('/broker-sync'))return json(null);
    if(url.pathname.endsWith('/option-risk/capabilities'))return json({enabled:false,available:false});
    const path=resolve(root,'.'+url.pathname);
    if(!path.startsWith(root+'/')||!existsSync(path)){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(readFileSync(path));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try{
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const origin=`http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)?r.continue():r.abort());
    await page.setViewport({width:390,height:844});await page.goto(origin+'/dashboard/'+file);
    const scope=file==='v2.html'?'#v2Summary ':'';
    await page.waitForSelector(scope+'.cash-debit-note');
    expect(await page.$eval(scope+'.cash-debit-note',n=>n.textContent)).toContain('4,955.41');
    expect(await page.$eval(scope+'.cash-debit-note',n=>n.textContent)).toContain('SGD');
    expect(await page.$eval('#navValue',n=>n.textContent)).toBe('$8,283.44');
    await page.select('#channelSelect','tiger');
    expect(await page.$eval(scope+'.cash-debit-note',n=>n.textContent)).toContain('SGD');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'/tmp/velovest-debit-cash-'+file+'.png',fullPage:true});
    expect(errors).toEqual([]);
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
},30000);
