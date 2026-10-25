import {it} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
import {buildAccountRisk} from '../src/webapp/account-risk-data.ts';

it('reviews account evidence, funding arithmetic, mobile layout, and personal opt-in/off/error states',async()=>{
  const now=new Date(),asOf=now.toISOString().slice(0,10),expiry=new Date(now.getTime()+7*86400000).toISOString().slice(0,10);
  const state={user:{id:'demo'},profile:{display_name:'Demo'},log:[],broker_sources:{source:{broker_id:'futubull',credentials:{}}},broker_connections:{a:{broker_id:'futubull',source_id:'source',label:'Futu · Main',channel:'a',enabled:true,config:{},metrics:{as_of:asOf,currency:'USD',excess_liquidity:5389.61,buying_power:0}},b:{broker_id:'futubull',source_id:'source',label:'Futu · Second account',channel:'b',enabled:true,config:{}}}};
  const pos=(key,channel,strike,units)=>({ticker:key,currency:'USD',channel,instrument:'option',units,option:{underlying:'SOXL',strike,expiry,side:'short',right:'put',multiplier:100,settlement:'physical'}});
  const payload={generatedAt:now.toISOString(),brokerAsOf:{a:asOf,b:asOf},model:{live:{reportingCurrency:'USD',channels:['a','b'],positions:[pos('a1','a',60,5),pos('a2','a',52,5),pos('a3','a',50,5),pos('b1','b',40,5)],byChannel:[{channel:'a',cashAmount:46200,cashCurrency:'USD'},{channel:'b',cashAmount:125743,cashCurrency:'USD'}]}}};
  const data=buildAccountRisk(state,payload,now);let enabled=false,fail=false,revision=1,saveFail=false,readFail=false;
  const app=express();app.use(express.json());
  app.get('/api/domain/invage/account-risk',(_req,res)=>{if(fail)return res.status(503).json({message:'Please sync and retry.'});if(!enabled)return res.status(403).json({error:'page_disabled'});res.json(data);});
  app.get('/api/domain/invage/experience-settings',(_req,res)=>readFail?res.status(503).json({message:'Settings are temporarily unavailable.'}):res.json({account_risk:enabled,revision}));
  app.put('/api/domain/invage/experience-settings',(req,res)=>{if(saveFail)return res.status(409).json({message:'Your account changed. Reload settings and try again.'});enabled=req.body.account_risk;revision++;res.json({account_risk:enabled,revision});});
  app.use(express.static(resolve('webui')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`;let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1440,height:1080});await page.goto(origin+'/account-risk/index.html');
    await page.waitForSelector('#disabled:not([hidden])');assert.equal(await page.$eval('#content',e=>e.hidden),true);
    await page.goto(origin+'/settings/experience/index.html');await page.waitForFunction(()=>!document.getElementById('enabled').disabled);
    assert.equal(await page.$eval('#enabled',e=>e.checked),false);assert.equal(await page.$eval('#save',e=>e.disabled),true);
    await page.click('#enabled');await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').textContent.startsWith('Saved.'));assert.equal(enabled,true);
    await page.screenshot({path:'/tmp/velovest-experience-desktop.png',fullPage:true});
    await page.goto(origin+'/account-risk/index.html');await page.waitForSelector('#content:not([hidden])');
    assert.match(await page.$eval('#headline',e=>e.textContent),/No reported buying power/);
    await page.click('.finding summary');assert.match(await page.$eval('.finding .detail',e=>e.textContent),/equity with loan value/);
    await page.$eval('#funding',e=>{e.value='10000';e.dispatchEvent(new Event('input'));});assert.match(await page.$eval('#funding-result',e=>e.textContent),/15,390/);
    assert.equal(await page.$$eval('#account-table tr',rows=>rows.length),2);
    await page.screenshot({path:'/tmp/velovest-risk-desktop.png',fullPage:true});
    await page.click('[data-channel="b"]');assert.equal(await page.$eval('#funding',e=>e.disabled),true);assert.match(await page.$eval('#headline',e=>e.textContent),/Short options/);
    await page.click('[data-channel="a"]');await page.setViewport({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/velovest-risk-mobile.png',fullPage:true});
    fail=true;await page.click('#refresh');await page.waitForSelector('#failed:not([hidden])');assert.equal(await page.$eval('#content',e=>e.hidden),true);
    fail=false;enabled=false;await page.click('#retry');await page.waitForSelector('#disabled:not([hidden])');
    await page.goto(origin+'/settings/experience/index.html');await page.waitForFunction(()=>!document.getElementById('enabled').disabled);
    await page.click('#enabled');saveFail=true;await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').classList.contains('error'));assert.equal(enabled,false);assert.equal(await page.$eval('#enabled',e=>e.checked),true);
    saveFail=false;await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').textContent.startsWith('Saved.'));assert.equal(enabled,true);
    await page.click('#enabled');await page.click('#save');await page.waitForFunction(()=>document.getElementById('message').textContent.startsWith('Saved.'));assert.equal(enabled,false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/velovest-experience-mobile.png',fullPage:true});
    readFail=true;await page.reload();await page.waitForFunction(()=>document.getElementById('message').classList.contains('error'));assert.equal(await page.$eval('#enabled',e=>e.disabled),true);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
