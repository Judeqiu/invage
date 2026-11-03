import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';
import {bookableDates} from '../src/signup/catalog.ts';
const disabledDate=bookableDates(new Date(),1)[0];

const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const app=spawn(process.execPath,['website/.output/server/index.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';app.stdout.on('data',data=>{logs+=data;});app.stderr.on('data',data=>{logs+=data;});
let browser;
try{
  let ready=false;
  for(let i=0;i<100;i++){
    if(app.exitCode!==null)throw new Error('Website exited: '+logs);
    try{const response=await fetch(origin+'/signup?package=novice');if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Website did not become ready: '+logs);
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();await page.setViewport({width:390,height:844});
  let submitted;
  await page.setRequestInterception(true);
  page.on('request',req=>{
    const url=new URL(req.url());
    if(url.pathname==='/api/signup/dates'){void req.respond({status:200,contentType:'application/json',body:JSON.stringify({disabledDates:[disabledDate]})});return;}
    if(url.pathname==='/api/signup/submissions'){
      submitted=JSON.parse(req.postData());
      void req.respond({status:201,contentType:'application/json',body:JSON.stringify({reference:submitted.reference})});return;
    }
    if(url.origin!==origin&&url.protocol!=='data:'&&url.protocol!=='blob:'){void req.abort();return;}
    void req.continue();
  });
  await page.goto(origin+'/signup?package=novice',{waitUntil:'networkidle0'});
  await page.waitForSelector('[aria-label="Available dates"] button:not([disabled])');
  assert.equal(await page.$eval('[aria-label="Available dates"] button',button=>button.disabled),true);
  const initialLabels=await page.$$eval('[aria-label="Available dates"] button',buttons=>buttons.map(button=>button.getAttribute('aria-label')));
  await(await page.$('button::-p-text(Later dates)')).click();
  await page.waitForFunction(first=>document.querySelector('[aria-label="Available dates"] button').getAttribute('aria-label')!==first,{},initialLabels[0]);
  await(await page.$('button::-p-text(Earlier dates)')).click();
  await page.waitForFunction(first=>document.querySelector('[aria-label="Available dates"] button').getAttribute('aria-label')===first,{},initialLabels[0]);
  await page.screenshot({path:'/tmp/velovest-signup-date-availability.png',fullPage:true});
  await page.click('[aria-label="Available dates"] button:not([disabled])');
  const times=await page.$$eval('[aria-label="Available times"] button',buttons=>buttons.map(button=>({text:button.innerText,disabled:button.disabled})));
  assert.ok(times.length>0);assert.ok(times.every(slot=>!slot.disabled&&slot.text.includes('confirmed after review')));
  await page.click('[aria-label="Available times"] button');await (await page.$('button::-p-text(Continue to payment)')).click();
  await page.waitForSelector('input[autocomplete="name"]');
  await page.waitForFunction(()=>{const image=document.querySelector('img[src="/velovest-paynow.jpg"]');return image?.complete&&image.naturalWidth===300;});
  await page.type('input[autocomplete="name"]','Checkout test customer');await page.type('input[type="email"]','checkout@example.invalid');
  await (await page.$('input[type="file"]')).uploadFile('website/public/favicon.png');
  await page.click('input[type="checkbox"]');
  await page.click('button[type="submit"]');
  await page.waitForFunction(()=>location.pathname==='/confirmation'&&document.body.innerText.includes('signup and payment evidence have been saved for review'));
  await page.waitForFunction(()=>window.scrollY===0);
  const text=await page.evaluate(()=>document.body.innerText);
  assert.match(text,/signup and payment evidence have been saved for review/);
  assert.doesNotMatch(text,/acknowledgement email has been sent|Prototype preview|no file was stored/);
  assert.match(text,/New customers receive a temporary password/);
  assert.ok(submitted.proofBase64);assert.equal(submitted.email,'checkout@example.invalid');assert.equal(submitted.packageId,'novice');
  assert.equal(submitted.amountSgd,undefined);
  await page.screenshot({path:'/tmp/velovest-signup-customer-confirmation.png',fullPage:true});
  // Renewal deep links go directly to payment, without a date/time or receipt appointment.
  await page.goto(origin+'/signup?package=renewal',{waitUntil:'networkidle0'});
  await page.waitForSelector('input[autocomplete="name"]');
  assert.equal(await page.$('[aria-label="Available dates"]'),null);
  assert.equal(await page.$$eval('[aria-label="Sign-up progress"] li',els=>els.length),3);
  assert.match(await page.evaluate(()=>document.body.innerText),/228.00 SGD/);
  await page.type('input[autocomplete="name"]','Renewal test customer');
  await page.type('input[type="email"]','renewal@example.invalid');
  await (await page.$('input[type="file"]')).uploadFile('website/public/favicon.png');
  await page.click('input[type="checkbox"]');await page.click('button[type="submit"]');
  await page.waitForFunction(()=>location.pathname==='/confirmation'&&document.body.innerText.includes('signup and payment evidence have been saved for review'));
  assert.equal(submitted.packageId,'renewal');
  assert.equal(submitted.sessionDate,undefined);assert.equal(submitted.sessionTime,undefined);
  const renewalText=await page.evaluate(()=>document.body.innerText);
  assert.match(renewalText,/Velovest system access · 12 months/);
  assert.doesNotMatch(renewalText,/Requested session|Requested onboarding session|Your onboarding session|appointment confirmation email|Invalid Date|undefined|null/);
  assert.equal(new URL(page.url()).searchParams.has('date'),false);
  await page.waitForFunction(()=>window.scrollY===0);
  await page.screenshot({path:'/tmp/velovest-renewal-confirmation.png',fullPage:true});
  // Selecting renewal after a guided-package booking clears stale selections.
  await page.goto(origin+'/signup?package=novice',{waitUntil:'networkidle0'});
  await page.waitForSelector('[aria-label="Available dates"] button:not([disabled])');
  assert.equal(await page.$eval('[aria-label="Available dates"] button',button=>button.disabled),true);
  await page.click('[aria-label="Available dates"] button:not([disabled])');await page.click('[aria-label="Available times"] button');
  await (await page.$('button::-p-text(Change package)')).click();
  await (await page.$('button::-p-text(Choose Yearly Renewal)')).click();
  await page.waitForSelector('input[autocomplete="name"]');
  assert.equal(await page.$('[aria-label="Available dates"]'),null);
  assert.doesNotMatch(await page.$eval('[aria-label="Order summary"]',el=>el.innerText),/Requested onboarding|Not selected yet/);
  console.log('PASS: guided signup retains booking; renewal deep link and package switch skip booking, submit proof without slots, and show a subscription-only receipt. No external API or email calls.');
}finally{
  if(browser)await browser.close();
  if(app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}
}
