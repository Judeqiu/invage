import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';

let mode='normal';
const server=createServer((req,res)=>{
  if(req.url==='/api/domain/invage/credits') {
    res.setHeader('Content-Type','application/json');
    if(mode==='error'){res.statusCode=503;res.end(JSON.stringify({message:'Your credit balance is temporarily unavailable. Please try again.'}));return;}
    res.end(JSON.stringify(mode==='admin'?{unlimited:true}:{used:mode==='blocked'?1000:120,remaining:mode==='blocked'?0:880,limit:1000,blocked:mode==='blocked',resetsAt:'2026-11-08T16:00:00.000Z'}));return;
  }
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=resolve('webui','.'+pathname);
  if(!file.startsWith(resolve('webui')+'/')){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}
  catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage();
  for(const width of [1024,390]) {
    mode='normal'; await page.setViewport({width,height:640});
    await page.goto(`http://127.0.0.1:${server.address().port}/settings/credits/index.html`);
    await page.waitForFunction(()=>document.getElementById('remaining').textContent==='880'&&!document.getElementById('balance').hidden);
    assert.match(await page.$eval('#used',e=>e.textContent),/120 of 1,000/);
    assert.match(await page.$eval('#reset',e=>e.textContent),/Monday,? 9 Nov 2026.*00:00/);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`/tmp/velovest-credits-${width}.png`,fullPage:true});
  }
  mode='blocked';await page.click('#refresh');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('AI chat will resume'));
  assert.equal(await page.$eval('#remaining',e=>e.textContent),'0');
  mode='error';await page.click('#refresh');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('temporarily unavailable'));
  assert(await page.$eval('#balance',e=>e.hidden));
  mode='admin';await page.click('#refresh');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('unlimited'));
  assert(await page.$eval('#balance',e=>e.hidden));
  console.log('Credits UI verified: desktop, mobile, used/remaining/reset, blocked, unavailable and admin states.');
} catch(error){console.error(error);process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));}
