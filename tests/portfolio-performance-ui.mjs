import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
import {buildDashboardModel,buildLivePositions} from '../src/report/dashboard-model.ts';
import {withPageProjections} from './helpers/portfolio-projection.ts';
import {portfolioWire} from '../src/webapp/portfolio-wire.ts';
const live=buildLivePositions({AAPL:{units:10,avg_price:100,currency:'USD',channel:'main'}},{AAPL:120},{},{amount:500,currency:'USD',updated_at:'2026-11-04',channel:'main'},null,undefined,{reportingCurrency:'USD',fxRates:{}},{allowEmpty:true});
const body=withPageProjections({slug:'fixture',displayName:'Fixture owner',generatedAt:'2026-11-04T13:00:00Z',empty:false,model:buildDashboardModel(live,[]),benchmark:null,productProfile:'consultant',productName:'Velovest',dashboardConfig:{},brokerAggregates:{}});
const wire=JSON.stringify(portfolioWire.encode(body));
const root=resolve('webui');
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/domain/invage/dashboard-cache'||url.pathname==='/api/domain/invage/dashboard'){
  if(url.searchParams.get('progress')==='1'){res.setHeader('Content-Type','text/event-stream');res.end('data: {"type":"result","payload":'+wire+'}\n\n');}
  else{res.setHeader('Content-Type','application/json');res.end(wire);}return;
 }
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available:false,connections:[],groups:[],coverage:[],gaps:[]}));return;}
 const file=resolve(root,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Page exception:',e.message);});
 await page.setRequestInterception(true);
 page.on('request',req=>{
  if(req.url().startsWith(origin))void req.continue();
  else if(req.url().includes('chart'))void req.respond({contentType:'application/javascript',body:'window.Chart=class {static defaults={font:{},plugins:{}};constructor(ctx,config){this.data=config.data;this.options=config.options;}destroy(){}resize(){}update(){}};'});
  else void req.abort();
 });
 for(const size of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewport(size);
  for(const path of ['/dashboard/index.html','/dashboard/v2.html','/positions/index.html','/positions/v2.html','/insights/index.html','/insights/v2.html']){
   await page.goto(origin+path,{waitUntil:'networkidle0'});
   try {await page.waitForFunction(()=>document.body.innerText.includes('AAPL')||document.body.innerText.includes('1,700'));}
   catch(error){console.error('Failed page:',path,await page.evaluate(()=>document.body.innerText.slice(0,1800)),errors);throw error;}
   const exact=await page.evaluate(expected=>JSON.stringify(PortfolioWire.decode(PortfolioWire.encode(expected)))===JSON.stringify(expected),body);
   assert(exact,'Every saved value must survive browser decoding');
   const error=await page.$eval('#error',e=>e.hidden||!e.getClientRects().length?'':e.textContent).catch(()=>null);
   assert(!error||!error.trim(),'Page must not report a loading error: '+path+' '+error);
   assert(await page.evaluate(()=>document.body.innerText.includes('1,700')||document.body.innerText.includes('1.7')||document.body.innerText.includes('1,200')||document.body.innerText.includes('1.2')),'Expected portfolio values on '+path);
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: lossless responses render Dashboard, Positions and Insights, both versions, on desktop and mobile with unchanged portfolio values.');
}catch(error){console.error(error);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));}
