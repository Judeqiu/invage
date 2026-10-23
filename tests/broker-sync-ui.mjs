import assert from 'node:assert/strict';
import {createServer}from'node:http';
import {readFile,mkdir}from'node:fs/promises';
import puppeteer from'puppeteer-core';
const ids=['ibkr','tiger','moomoo','webull','futubull'];
const payload={catalog:ids.map(id=>({id,display_name:id,fields:[],help_steps:[],help_notes:[]})),sources:ids.map(id=>({id:`s-${id}`,broker_id:id,credentials:{}})),connections:ids.map(id=>({id:`${id}-A`,broker_id:id,source_id:`s-${id}`,label:`${id} account`,channel:`${id}-A`,account_id:'A',enabled:true,sync_schedule:{frequency:'hourly',next_run_at:'2026-10-23T06:00:00Z'},status:'verified',config:{},last_sync:{ok:true,as_of:'2026-10-13'},history_sync:{historical_imported:true,status:'partial'}}))};
const requests=[];
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/report.css'){res.setHeader('Content-Type','text/css');res.end(await readFile('webui/report.css'));return;}
 if(path==='/accounts.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile('webui/settings/brokers/accounts.js'));return;}
 if(path.startsWith('/api/')){res.setHeader('Content-Type','application/json');
  if(req.method==='POST'||req.method==='PATCH'){let text='';for await(const part of req)text+=part;requests.push({path,body:JSON.parse(text)});res.end(JSON.stringify({applied:{}}));return;}
  res.end(JSON.stringify(path.endsWith('sync-history')?{runs:[],next_offset:null}:payload));return;}
 res.setHeader('Content-Type','text/html');res.end(await readFile('webui/settings/brokers/index.html'));
 }catch(e){res.writeHead(500);res.end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1100,height:1100});
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
 assert.equal(await page.$$eval('[data-action="full-sync"]',nodes=>nodes.length),5);assert.equal(await page.$$eval('[data-action="sync"]',nodes=>nodes.length),5);
 await page.click('[data-action="full-sync"][data-id="tiger-A"]');await page.waitForFunction(()=>!document.querySelector('[data-action="full-sync"][data-id="tiger-A"]').disabled);
 assert.deepEqual(requests[0],{path:'/api/domain/invage/broker-accounts/tiger-A/sync',body:{full_sync:true}});
 await page.click('[data-action="sync"][data-id="moomoo-A"]');await page.waitForFunction(()=>!document.querySelector('[data-action="sync"][data-id="moomoo-A"]').disabled);
 assert.deepEqual(requests[1],{path:'/api/domain/invage/broker-accounts/moomoo-A/sync',body:{full_sync:false}});
 await page.click('[data-action="manage"][data-id="webull-A"]');await page.waitForSelector('#account-label');assert.equal(await page.$('#sync-frequency'),null);assert.match(await page.$eval('#account-label',node=>node.closest('.manage').textContent),/2 pm Singapore time/);await page.type('#account-label',' changed');
 assert.equal(await page.$eval('[data-action="full-sync"][data-id="webull-A"]',node=>node.disabled),true);
 assert.equal(await page.$eval('[data-action="sync"][data-id="webull-A"]',node=>node.disabled),true);
 await page.click('[data-action="save-account"][data-id="webull-A"]');await page.waitForFunction(()=>!document.querySelector('[data-action="save-account"]').disabled);
 assert.equal(requests[2].path,'/api/domain/invage/broker-accounts/webull-A');assert.equal(Object.hasOwn(requests[2].body,'sync_frequency'),false);assert.equal(requests[2].body.enabled,true);
 assert.deepEqual(errors,[]);await mkdir('/tmp/invage-full-sync-ui',{recursive:true});await page.screenshot({path:'/tmp/invage-full-sync-ui/brokers.png',fullPage:true});
 await page.setViewport({width:420,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/invage-full-sync-ui/brokers-mobile.png',fullPage:true});
 console.log('Broker UI passed: retired schedule controls absent, account saves omit schedule fields, and manual sync modes work.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
