import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import puppeteer from 'puppeteer-core';

const ids={admin:'00000000-0000-4000-8000-000000000001',subscriber:'00000000-0000-4000-8000-000000000002',manager:'00000000-0000-4000-8000-000000000003'};
const disabledDates=new Set();
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
  if(path==='/api/admin/users'){json(res,{users:[subscriber,admin],billingEnabled:false,sharedAccounts:false,nextCursor:null,summary:{total:2,admins:1,beta:0,withRef:1,paid:0,comped:0,references:[]}});return;}
  if(path.startsWith('/api/domain/invage/management/roles/')){
   const id=path.split('/').at(-1);if(mode!=='admin'){json(res,{error:'Admin access required'},403);return;}
   if(req.method==='PATCH'){let body='';for await(const chunk of req)body+=chunk;assigned=JSON.parse(body).enabled;patches++;}
   json(res,{role:'velovest_manager',enabled:id===ids.subscriber&&assigned,eligible:id!==ids.admin});return;
  }
  if(path==='/api/domain/invage/management/signup-dates'){json(res,{disabledDates:[...disabledDates]});return;}
  if(path.startsWith('/api/domain/invage/management/signup-dates/')){
   let body='';for await(const chunk of req)body+=chunk;
   const date=path.split('/').at(-1);if(JSON.parse(body).enabled)disabledDates.delete(date);else disabledDates.add(date);
   json(res,{date,enabled:!disabledDates.has(date)});return;
  }
  if(path==='/api/domain/invage/management/users'){json(res,{users:[subscriber],billingEnabled:false});return;}
  if(path==='/api/domain/invage/management/users/'+ids.subscriber){json(res,{user:subscriber,billingEnabled:false});return;}
  if(path==='/api/domain/invage/management/invites'){
   if(req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;assert.deepEqual(JSON.parse(body),{comment:'Customer signup',recipientEmail:'customer@example.invalid'});issued++;await heldInvite;
    json(res,{code:'INV-MANAGER',createdAt:'2026-11-02',onboardUrl:'http://127.0.0.1:'+server.address().port+'/login?invite=INV-MANAGER'});return;
   }
   json(res,{codes:[{code:'INV-CUSTOMER',createdAt:'2026-11-02',comment:'Normal signup',recipientEmail:'customer@example.invalid',usedAt:null}]});return;
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
 mode='manager';await page.goto(origin+'/velovest-management',{waitUntil:'networkidle0'});
 const panel=await(await page.waitForSelector('iframe[src="/domain-assets/invage/management/index.html"]')).contentFrame();
 await panel.waitForSelector('#users button');
 assert.deepEqual(await panel.$$eval('nav button',buttons=>buttons.map(button=>button.textContent)),['Users','Access','Signup dates']);
 assert.doesNotMatch(await panel.$eval('#users',el=>el.innerText),/Full administrator|owner@example.invalid/);
 await panel.click('#users button');await panel.waitForSelector('#user-details:not([hidden])');
 assert.match(await panel.$eval('#details',el=>el.innerText),/Subscriber <img src=x>/);
 assert.equal(await panel.$('#details img'),null);
 await panel.click('#dates-tab');await panel.waitForFunction(()=>document.getElementById('message').textContent.includes('All dates are enabled'));
 await panel.$eval('#signup-date',input=>{input.value='2026-11-07';});await panel.click('#disable-date');
 await panel.waitForSelector('#disabled-dates button');assert.ok(disabledDates.has('2026-11-07'));
 await page.screenshot({path:'/tmp/velovest-manager-signup-dates.png',fullPage:true});
 await panel.click('#disabled-dates button');await panel.waitForFunction(()=>document.getElementById('disabled-dates').children.length===0);
 assert.ok(!disabledDates.has('2026-11-07'));
 await panel.click('#access-tab');await panel.waitForSelector('#invites tr');
 assert.match(await panel.$eval('#invites',el=>el.innerText),/customer@example.invalid/);
 assert.doesNotMatch(await panel.evaluate(()=>document.body.innerText),/Admin onboard codes|New admin code|ADM-/);
 await panel.type('#recipient-email','customer@example.invalid');await panel.type('#comment','Customer signup');await panel.click('#create-invite');
 await panel.waitForFunction(()=>document.getElementById('create-invite').disabled);
 await panel.$eval('#create-invite',button=>button.click());assert.equal(issued,1);
 releaseInvite();await panel.waitForSelector('#new-invite:not([hidden])');
 assert.match(await panel.$eval('#invite-link',link=>link.href),/login\?invite=INV-MANAGER/);
  assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/Failed to load settings|prefs failed to load/);
 await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/velovest-manager-access-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: role control renders in the real selected-user Admin drawer; assignment/revocation, admin exclusion, manager Users/Access/Signup dates tabs, date disable/enable, XSS-safe details and duplicate invite prevention.');
}finally{releaseInvite();await browser.close();await new Promise(resolve=>server.close(resolve));}
