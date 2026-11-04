import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';
import {dashboardConfig} from '../src/webapp/dashboard-config.ts';

const ids={admin:'00000000-0000-4000-8000-000000000001',subscriber:'00000000-0000-4000-8000-000000000002',manager:'00000000-0000-4000-8000-000000000003'};
let configValues=Object.fromEntries(dashboardConfig.fields.map(field=>[field.id,field.default]));
let configSaves=0;
const disabledDates=new Set();
let dateReads=0,dateWrites=0,dateDelay=0,failDate=false,userDelay=0,dateReadDelay=0,invitesRead=0,denyManager=false;
let mode='admin',assigned=false,patches=0,issued=0,releaseInvite;
const heldInvite=new Promise(resolve=>{releaseInvite=resolve;});
const subscriber={userId:ids.subscriber,displayName:'Subscriber <img src=x>',email:'subscriber@example.invalid',createdAt:'2026-11-02',reference:'REF-1',beta:false,admin:false,
  subscription:null,billing:null,usage:{period_credits:0,lifetime_credits:0,credit_cap:null,periodCredits:0,lifetimeCredits:0},resetHistory:[]};
const admin={...subscriber,userId:ids.admin,displayName:'Full administrator',email:'owner@example.invalid',admin:true};
const catalog={...JSON.parse(readFileSync('node_modules/utarus/src/l10n/en.json','utf8')),...JSON.parse(readFileSync('l10n/en.json','utf8'))};
const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  if(path==='/api/chat/agent'){json(res,{type:mode==='admin'?'admin':'user',userId:ids[mode],displayName:mode,agentName:'Velovest',version:'fixture',isStreaming:false,hasContext:false});return;}
  if(path==='/api/onboard/profile/l10n'){json(res,{language:'en',location:null,needsLanguagePick:false,languages:['en'],defaultLanguage:'en',catalogs:{en:catalog},countries:[],languageByCountry:{}});return;}
  if(path==='/api/onboard/profile/preferences'){json(res,{conversation_font_size:'sm',product_tour_completed:true,product_tour_version:1});return;}
  if(path==='/api/webui/manifest'){
   const manager=mode==='manager';json(res,{agentKey:'invage',productName:'Velovest',sessionKey:'test-session',defaultPath:'/dashboard',
    nav:[{id:'dashboard',label:'Dashboard',path:'/dashboard'},...(manager?[{id:'velovest-management',label:'Management',path:'/velovest-management'}]:[])],
    routes:[{path:'/dashboard',pageKind:'iframe',iframeSrc:'/domain-assets/invage/management/index.html'},
      ...(manager?[{path:'/velovest-management',pageKind:'iframe',iframeSrc:'/domain-assets/invage/management/index.html',title:'Management'}]:[])],
    settingsSections:[],managementSections:[],managementUserSections:[{id:'velovest-manager-role',title:'Velovest manager',iframeSrc:'/domain-assets/invage/management/role.html',iframeHeightPx:230}],widgets:[],brand:{}});return;
  }
  if(path==='/api/admin/agent-config'){json(res,{configurations:[{definition:dashboardConfig,values:configValues}]});return;}
  if(path==='/api/admin/agent-config/'+dashboardConfig.id){let body='';for await(const chunk of req)body+=chunk;configValues=JSON.parse(body);configSaves++;json(res,{values:configValues});return;}
  if(path==='/api/admin/users'){json(res,{users:[subscriber,admin],billingEnabled:false,sharedAccounts:false,nextCursor:null,summary:{total:2,admins:1,beta:0,withRef:1,paid:0,comped:0,references:[]}});return;}
  if(path.startsWith('/api/domain/invage/management/roles/')){
   const id=path.split('/').at(-1);if(mode!=='admin'){json(res,{error:'Admin access required'},403);return;}
   if(req.method==='PATCH'){let body='';for await(const chunk of req)body+=chunk;assigned=JSON.parse(body).enabled;patches++;}
   json(res,{role:'velovest_manager',enabled:id===ids.subscriber&&assigned,eligible:id!==ids.admin});return;
  }
  if(denyManager&&path.startsWith('/api/domain/invage/management/')){json(res,{error:'Manager access revoked'},403);return;}
  if(path==='/api/domain/invage/management/signup-dates'){dateReads++;const snapshot=[...disabledDates];await new Promise(resolve=>setTimeout(resolve,dateReadDelay||dateDelay));json(res,{disabledDates:snapshot});return;}
  if(path.startsWith('/api/domain/invage/management/signup-dates/')){
   dateWrites++;await new Promise(resolve=>setTimeout(resolve,dateDelay));
   if(failDate){json(res,{error:'Synthetic save failure'},503);return;}
   let body='';for await(const chunk of req)body+=chunk;
   const date=path.split('/').at(-1);if(JSON.parse(body).enabled)disabledDates.delete(date);else disabledDates.add(date);
   json(res,{date,enabled:!disabledDates.has(date)});return;
  }
  if(path==='/api/domain/invage/management/users'){await new Promise(resolve=>setTimeout(resolve,userDelay));json(res,{users:[subscriber],billingEnabled:false});return;}
  if(path==='/api/domain/invage/management/users/'+ids.subscriber){json(res,{user:subscriber,billingEnabled:false});return;}
  if(path==='/api/domain/invage/management/invites'){
   if(req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),{comment:'Customer signup',recipientEmail:'customer@example.invalid'});issued++;await heldInvite;
    json(res,{code:'PARTNER-1234ABCD',createdAt:'2026-11-02',comment:'Customer signup',recipientEmail:'customer@example.invalid',onboardUrl:'http://127.0.0.1:'+server.address().port+'/login?invite=PARTNER-1234ABCD'});return;
   }
   invitesRead++;json(res,{codes:[{code:'INV-CUSTOMER',createdAt:'2026-11-02',comment:'Normal signup',recipientEmail:'customer@example.invalid',usedAt:null}]});return;
  }
  if(path.startsWith('/api/')){json(res,{count:0});return;}
  const domain='/domain-assets/invage/management/';
  const file=path.startsWith(domain)?resolve('webui/management',path.slice(domain.length)):resolve('node_modules/utarus/web/dist',path.replace(/^\//,''));
  const chosen=existsSync(file)&&extname(file)?file:resolve('node_modules/utarus/web/dist/index.html');
  const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.json':'application/json'}[extname(chosen)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type});res.end(readFileSync(chosen));
 }catch(error){json(res,{error:String(error)},500);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/admin',{waitUntil:'networkidle0'});await page.waitForSelector('tbody tr');
 await page.evaluate(()=>{[...document.querySelectorAll('tbody tr')].find(row=>row.innerText.includes('subscriber@example.invalid')).click();});
 const iframe=await page.waitForSelector('aside iframe[title^="Velovest manager"]');const roleFrame=await iframe.contentFrame();
 await roleFrame.waitForSelector('#toggle-role:not([disabled])');
 assert.equal(new URL(roleFrame.url()).searchParams.get('userId'),ids.subscriber);
 await roleFrame.click('#toggle-role');await roleFrame.waitForFunction(()=>document.getElementById('role-status').textContent==='Role assigned.');
 assert.equal(assigned,true);assert.equal(patches,1);
 await roleFrame.click('#toggle-role');await roleFrame.waitForFunction(()=>document.getElementById('role-status').textContent==='Role not assigned.');
 assert.equal(assigned,false);assert.equal(patches,2);
 await page.screenshot({path:'/tmp/velovest-manager-role-drawer.png',fullPage:true});
 await page.click('aside button[aria-label="Close"]');
 await page.evaluate(()=>{[...document.querySelectorAll('tbody tr')].find(row=>row.innerText.includes('owner@example.invalid')).click();});
 const adminFrame=await(await page.waitForSelector('aside iframe')).contentFrame();
 await adminFrame.waitForFunction(()=>document.getElementById('role-status').textContent.includes('non-admin'));
 assert.equal(await adminFrame.$eval('#toggle-role',button=>button.disabled),true);
 await page.click('aside button[aria-label="Close"]');
 await page.evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Agent configuration').click());
 const prefixInput='#agent-config-invage-dashboard-invitation_code_prefix';
 await page.waitForSelector(prefixInput);
 assert.equal(await page.$eval(prefixInput,input=>input.value),'IC');
 await page.$eval(prefixInput,input=>input.select());await page.type(prefixInput,'PARTNER');
 await page.$eval(prefixInput,input=>input.closest('form').querySelector('button[type="submit"]').click());
 await page.waitForFunction(()=>document.body.innerText.includes('Configuration saved.'));
 assert.equal(configSaves,1);assert.equal(configValues.invitation_code_prefix,'PARTNER');
 await page.screenshot({path:'/tmp/velovest-admin-invitation-prefix.png',fullPage:true});
 mode='manager';await page.goto(origin+'/velovest-management',{waitUntil:'networkidle0'});
 const panel=await(await page.waitForSelector('iframe[src="/domain-assets/invage/management/index.html"]')).contentFrame();
 await panel.waitForSelector('#users button');
 assert.deepEqual(await panel.$$eval('nav button',buttons=>buttons.map(button=>button.textContent)),['Users','Access','Signup dates']);
 assert.doesNotMatch(await panel.$eval('#users',el=>el.innerText),/Full administrator|owner@example.invalid/);
 await page.screenshot({path:'/tmp/velovest-manager-users.png',fullPage:true});
 await panel.click('#users button');await panel.waitForSelector('#user-details[open]');
 assert.match(await panel.$eval('#details-title',el=>el.innerText),/Subscriber <img src=x>/);
 assert.equal(await panel.$('#details img'),null);
 await page.screenshot({path:'/tmp/velovest-manager-subscriber-drawer.png',fullPage:true});
 await page.keyboard.press('Tab');assert.ok(await panel.evaluate(()=>document.getElementById('user-details').contains(document.activeElement)));
 await page.keyboard.press('Escape');assert.equal(await panel.$eval('#user-details',dialog=>dialog.open),false);
 assert.equal(await panel.evaluate(()=>document.activeElement.textContent),'View');
 await panel.click('#dates-tab');await panel.waitForFunction(()=>document.getElementById('dates-status').textContent.includes('All dates are enabled'));
 const date=await panel.$eval('.day[data-date]',button=>button.dataset.date);
 const selector='.day[data-date="'+date+'"]';
 dateDelay=400;const readsBeforeSave=dateReads,saveStart=performance.now();
 await panel.click(selector);await panel.waitForSelector(selector+'[data-pending="true"]');
 const feedbackTime=Math.round(performance.now()-saveStart);
 assert.ok(feedbackTime<400,'Pending feedback must appear before the delayed response');
 assert.equal(disabledDates.has(date),false,'The displayed pending change precedes persistence');
 await panel.waitForSelector(selector+'[data-pending="false"][data-disabled="true"]');
 const completionTime=Math.round(performance.now()-saveStart);
 assert.ok(disabledDates.has(date));assert.equal(dateReads,readsBeforeSave,'Date save must not reload the date list');
 console.log('400 ms delayed API: pending feedback '+feedbackTime+' ms; saved '+completionTime+' ms; no follow-up GET.');
 await page.screenshot({path:'/tmp/velovest-manager-signup-dates.png',fullPage:true});
 await panel.click('#disabled-dates button');await panel.waitForSelector(selector+'[data-disabled="false"][data-pending="false"]');
 assert.ok(!disabledDates.has(date));
 // A failed save restores the confirmed state and keeps the error visible.
 failDate=true;await panel.click(selector);await panel.waitForSelector(selector+'[data-pending="true"]');
 await panel.waitForFunction(()=>document.getElementById('dates-status').dataset.error==='true');
 assert.equal(await panel.$eval(selector,button=>button.dataset.disabled),'false');assert.ok(!disabledDates.has(date));
 assert.match(await panel.$eval('#dates-status',el=>el.textContent),/Refresh to confirm/);
 failDate=false;await panel.click('#refresh-dates');await panel.waitForFunction(()=>!document.getElementById('refresh-dates').disabled);
 assert.equal(await panel.$eval('#dates-status',el=>el.dataset.error),'false');
 // A stale refresh started before a mutation cannot revert the saved result.
 dateReadDelay=800;const staleRead=dateReads;await panel.click('#refresh-dates');
 await panel.click(selector);
 await panel.waitForSelector(selector+'[data-pending="false"][data-disabled="true"]');
 await panel.waitForFunction(()=>!document.getElementById('refresh-dates').disabled);
 assert.equal(dateReads,staleRead+1);assert.equal(await panel.$eval(selector,button=>button.dataset.disabled),'true');
 dateReadDelay=0;await panel.click(selector);await panel.waitForSelector(selector+'[data-disabled="false"][data-pending="false"]');
 // Different dates can save concurrently; double-clicking one date cannot duplicate its request.
 const dates=await panel.$$eval('.day[data-date]',buttons=>buttons.slice(0,2).map(button=>button.dataset.date));
 const beforeWrites=dateWrites;
 await panel.click(selector);await panel.$eval(selector,button=>button.click());
 await panel.click('.day[data-date="'+dates[1]+'"]');
 assert.equal(await panel.$$eval('.day[data-pending="true"]',buttons=>buttons.length),2);
 await panel.waitForFunction(()=>!document.querySelector('.day[data-pending="true"]'));
 assert.equal(dateWrites-beforeWrites,2);assert.ok(disabledDates.has(dates[0])&&disabledDates.has(dates[1]));
 // Month navigation and keyboard focus survive toggles and tab changes.
 assert.equal(await panel.$$eval('.day[tabindex="0"]',buttons=>buttons.length),1);
 const month=await panel.$eval('#calendar-month',el=>el.textContent);
 await panel.click('#next-month');assert.notEqual(await panel.$eval('#calendar-month',el=>el.textContent),month);
 await panel.click('#previous-month');assert.equal(await panel.$eval('#calendar-month',el=>el.textContent),month);
 await panel.focus(selector);await page.keyboard.press('ArrowRight');
 assert.equal(await panel.evaluate(()=>document.activeElement.dataset.date),dates[1]);
 // Revalidation keeps existing rows on screen and leaves search text intact.
 userDelay=400;await panel.click('#users-tab');assert.equal(await panel.$$eval('#users button',buttons=>buttons.length),1);
 await panel.type('#search','Subscriber');await panel.click('#search-form button');
 await panel.waitForFunction(()=>!document.getElementById('refresh-users').disabled);
 await panel.click('#dates-tab');await panel.click('#users-tab');assert.equal(await panel.$eval('#search',el=>el.value),'Subscriber');
 await panel.click('#dates-tab');await page.setViewport({width:390,height:844});
 assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Calendar must fit a mobile viewport');
 await page.screenshot({path:'/tmp/velovest-manager-dates-mobile.png',fullPage:true});
 await page.setViewport({width:1440,height:1000});
 await panel.click('#access-tab');await panel.waitForSelector('#invites tr');
 assert.match(await panel.$eval('#invites',el=>el.innerText),/customer@example.invalid/);
 assert.doesNotMatch(await panel.evaluate(()=>document.body.innerText),/Admin onboard codes|New admin code|ADM-/);
 assert.equal(await panel.$('#invite-prefix'),null,'Managers must not configure the invitation prefix');
 await panel.type('#recipient-email','customer@example.invalid');await panel.type('#comment','Customer signup');await panel.click('#create-invite');
 await panel.waitForFunction(()=>document.getElementById('create-invite').disabled);
 await panel.$eval('#create-invite',button=>button.click());assert.equal(issued,1);
 const inviteReadsBefore=invitesRead;releaseInvite();await panel.waitForSelector('#new-invite:not([hidden])');
 assert.equal(invitesRead,inviteReadsBefore,'Invite creation must not issue a follow-up GET');
 assert.match(await panel.$eval('#invites',el=>el.innerText),/PARTNER-1234ABCD/);
 assert.match(await panel.$eval('#invite-link',link=>link.href),/login\?invite=PARTNER-1234ABCD/);
  assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/Failed to load settings|prefs failed to load/);
 await page.screenshot({path:'/tmp/velovest-manager-access-desktop.png',fullPage:true});
 await page.setViewport({width:390,height:844});
 assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Invitation prefix form must fit a mobile viewport');
 await page.screenshot({path:'/tmp/velovest-manager-access-mobile.png',fullPage:true});
 denyManager=true;await panel.click('#refresh-invites');await panel.waitForSelector('#message:not([hidden])');
 assert.equal(await panel.$$eval('section:not([hidden])',sections=>sections.length),0);
 assert.equal(await panel.$eval('#users',el=>el.children.length),0);assert.equal(await panel.$eval('#new-invite',el=>el.hidden),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: admin role controls; manager calendar optimistic saves, failure recovery, stale refresh protection, concurrent dates, duplicate prevention, tab retention, keyboard drawer/calendar, mobile layouts, immediate invite results and revoked-access clearing.');
}finally{releaseInvite();await browser.close();await new Promise(resolve=>server.close(resolve));}
