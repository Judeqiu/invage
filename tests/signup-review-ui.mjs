import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { accessEmail } from '../src/signup/review.ts';

const base='/api/domain/invage/academy-signup/admin/submissions';
const root='/domain-assets/invage/signup-submissions/';
const sample={id:'00000000-0000-4000-8000-000000000001',reference:'VV-UI0001',customer_name:'<img src=x onerror="window.injection=true">',customer_email:'new@example.invalid',customer_phone:'+65 12345678',
  package_id:'novice',package_name:'New to Options',amount_sgd:'1080',session_date:'2099-11-02',session_time:'10:00',bank_transaction_id:'BANK-123',proof_filename:'payment.png',status:'submitted',created_at:'2026-11-02T02:00:00Z',
  email_status:'not_queued',approved_at:null,approved_by:null,account_user_id:null,account_kind:null,confirmed_session_date:null,confirmed_session_time:null,email_attempted_at:null,email_accepted_at:null,email_message_id:null,email_error:null};
const rows=[structuredClone(sample),{...structuredClone(sample),id:'00000000-0000-4000-8000-000000000002',reference:'VV-UI0002',customer_name:'Existing customer',customer_email:'existing@example.invalid'}];
let configured=false,approvalCount=0,sendCount=0,releaseApproval, pdfBytes;
const holdApproval=new Promise(resolve=>{releaseApproval=resolve;});
function detail(row,date,time) {
  const copy={...row,...(date?{confirmed_session_date:date,confirmed_session_time:time}:{})};
  return {submission:copy,mailConfigured:configured,manualShareAvailable:row.status==='approved',accessMessageNotice:'',
    existingAccount:row.id===rows[1].id?{userId:'11111111-1111-4111-8111-111111111111',name:'Existing customer',email:row.customer_email,inactive:false}:null,
    relatedSubmissions:[{reference:'VV-DUP001',reason:'Same bank transaction ID'}],sessionConflicts:[],history:[],
    emailPreview:accessEmail(copy,'https://chat.velovest.lextok.com/login',row.id===rows[1].id?null:row.status==='approved'?'fixture-manual-share-password':'[Generated securely on approval]')};
}
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith(base)) {
      res.setHeader('Cache-Control','no-store');
      const suffix=url.pathname.slice(base.length);
      if(suffix.startsWith('/pdfjs/')){const asset=suffix.split('/').at(-1);if(!['pdf.mjs','pdf.worker.mjs'].includes(asset)){res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type','application/javascript');res.end(readFileSync('node_modules/pdfjs-dist/build/'+asset));return;}
      if(!suffix){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({submissions:rows,mailConfigured:configured}));return;}
      const [,id,action]=suffix.split('/');const row=rows.find(r=>r.id===id);
      if(!row){res.writeHead(404);res.end('{}');return;}
      if(action==='proof'){res.setHeader('Content-Type',row.id===rows[1].id?'application/pdf':'image/png');res.end(row.id===rows[1].id?pdfBytes:readFileSync('website/public/favicon.png'));return;}
      res.setHeader('Content-Type','application/json');
      if(req.method==='POST'){
        let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
        if(action==='approve'){
          approvalCount++;await holdApproval;
          Object.assign(row,{status:'approved',approved_at:new Date().toISOString(),approved_by:JSON.stringify({name:'Review operator'}),account_user_id:'22222222-2222-4222-8222-222222222222',account_kind:'new',
            confirmed_session_date:input.sessionDate,confirmed_session_time:input.sessionTime,email_status:'pending'});
        }else if(action==='send-email'){
          sendCount++;row.email_status='sent';row.email_accepted_at=new Date().toISOString();row.email_message_id='browser-receipt';
        }
      }
      res.end(JSON.stringify(detail(row,url.searchParams.get('sessionDate'),url.searchParams.get('sessionTime'))));return;
    }
    const file=url.pathname===root+'page.css'?'webui/signup-submissions/page.css':url.pathname===root+'app.js'?'webui/signup-submissions/app.js':url.pathname.endsWith('/report.css')?'webui/report.css':'webui/signup-submissions/index.html';
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));
  }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
  const pdfPage=await browser.newPage();
  await pdfPage.setContent('<h1>Payment evidence · page one</h1><p>SGD 1080 · bank transfer fixture</p><div style="break-before:page"><h1>Payment evidence · page two</h1><p>Reference details</p></div>');
  pdfBytes=Buffer.from(await pdfPage.pdf({format:'A4'}));await pdfPage.close();
  const page=await browser.newPage();
  await page.evaluateOnNewDocument(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedAccess=text;}}}));
  await page.setViewport({width:1440,height:1000});
  await page.goto(`http://127.0.0.1:${server.address().port}${root}index.html`,{waitUntil:'networkidle0'});
  await page.waitForSelector('#rows button');assert.equal(await page.$$eval('#rows tr',els=>els.length),2);
  assert.equal(await page.$eval('#mail-setup',el=>el.hidden),false);
  await page.click('#rows button');await page.waitForSelector('#review-content:not([hidden])');
  await page.waitForFunction(()=>document.querySelector('#proof-preview img')?.complete);
  assert.equal(await page.evaluate(()=>window.injection),undefined);
  assert.match(await page.$eval('#customer-details',el=>el.innerText),/<img src=x/);
  await page.screenshot({path:'/tmp/velovest-signup-review-top.png',fullPage:true});
  await page.click('#review-approval');assert.match(await page.$eval('#review-message',el=>el.innerText),/Confirm that you verified/);
  await page.click('#payment-verified');await page.click('#session-confirmed');
  await page.click('#review-approval');assert.match(await page.$eval('#review-message',el=>el.innerText),/acknowledge/);
  await page.click('#warnings-ack');await page.click('#review-approval');
  await page.waitForSelector('#approval-confirm:not([hidden])');
  assert.match(await page.$eval('#approve',el=>el.innerText),/queue/);
  assert.match(await page.$eval('#email-preview',el=>el.innerText),/Temporary password: \[Generated securely/);
  await page.screenshot({path:'/tmp/velovest-signup-review-desktop.png',fullPage:true});
  await page.click('#approve');await page.waitForFunction(()=>document.querySelector('#approve').disabled);
  await page.$eval('#approve',el=>el.click());assert.equal(approvalCount,1);
  releaseApproval();await page.waitForFunction(()=>document.querySelector('#review-message').innerText.includes('email setup is pending'));
  assert.equal(await page.$eval('#send-email',el=>el.disabled),true);
  assert.match(await page.$eval('#approved-details',el=>el.innerText),/Awaiting email setup/);
  assert.match(await page.$eval('#email-preview',el=>el.innerText),/Temporary password: fixture-manual-share-password/);
  await page.click('#copy-access');
  await page.waitForFunction(()=>document.querySelector('#copy-message').innerText.includes('copied'));
  const copied=await page.evaluate(()=>window.copiedAccess);
  assert.match(copied,/Subject: Your Velovest signup is approved/);
  assert.match(copied,/Username \(email\): new@example.invalid/);
  assert.match(copied,/Temporary password: fixture-manual-share-password/);
  assert.match(copied,/Sign in: https:\/\/chat.velovest.lextok.com\/login/);
  assert.equal(sendCount,0);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied');};document.execCommand=()=>true;});
  await page.click('#copy-access');await page.waitForFunction(()=>document.querySelector('#copy-message').innerText.includes('copied'));
  assert.equal(await page.$$eval('#review textarea',els=>els.length),0);

  await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/velovest-signup-review-mobile.png',fullPage:true});
  assert.equal(await page.$eval('#review',el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.click('#close-review');
  assert.equal(await page.$eval('#email-preview',el=>el.textContent),'');
  configured=true;await page.select('#status-filter','approved');await page.click('#refresh');
  await page.waitForFunction(()=>document.querySelector('#mail-setup').hidden);
  await page.click('#rows button');await page.waitForSelector('#approved-state:not([hidden])');
  assert.equal(await page.$eval('#send-email',el=>el.disabled),false);
  await page.click('#send-email');await page.waitForFunction(()=>document.querySelector('#approved-details').innerText.includes('Accepted by email provider'));
  assert.equal(sendCount,1);assert.equal(await page.$eval('#send-email',el=>el.hidden),true);
  assert.match(await page.$eval('#email-preview',el=>el.innerText),/Temporary password: fixture-manual-share-password/);
  await page.click('#copy-access');await page.waitForFunction(()=>document.querySelector('#copy-message').innerText.includes('copied'));
  await page.click('#close-review');await page.select('#status-filter','submitted');
  await page.click('#rows button');await page.waitForSelector('#link-existing-wrap:not([hidden])');
  assert.match(await page.$eval('#email-preview',el=>el.innerText),/Use your existing Velovest password/);
  await page.waitForSelector('#proof-preview canvas');
  assert.equal(await page.$eval('#pdf-page',el=>el.innerText),'Page 1 of 2');
  await page.click('#pdf-next');await page.waitForFunction(()=>document.querySelector('#pdf-page').innerText==='Page 2 of 2');
  assert.equal(await page.$eval('#pdf-next',el=>el.disabled),true);
  await page.click('#pdf-previous');await page.waitForFunction(()=>document.querySelector('#pdf-page').innerText==='Page 1 of 2');
  console.log('PASS: signup Management browser flow — private image and two-page PDF rendering, XSS-safe details, warning and approval confirmations, duplicate click prevention, queued/setup state, email retry, existing-account preview, responsive layout.');
}finally{releaseApproval();await browser.close();await new Promise(resolve=>server.close(resolve));}
