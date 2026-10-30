import { withPageProjections } from './helpers/portfolio-projection.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('fits the desk overview and tables, filters risk, and discusses contracts from either table', async () => {
  const root = resolve('webui');
  const prompts: string[] = [];
  const channels = ['custom-ibkr-account','moomoo-main','tiger-main','webull-main'];
  const holding = (channel: string, right: string, strike: number, mark: number, expiry = '2027-10-22', underlying = 'AAPL') => ({
    instrument:'option', units:1, avg_price:3000, currency:'USD', channel,
    option:{side:'short',right,strike,mark:mark*100,expiry,underlying,multiplier:100,settlement:'physical'},
  });
  const holdings: any = {
    AAPL:{units:10000,avg_price:80,currency:'USD',channel:channels[0]},
    danger:holding(channels[0],'call',80,23.906163665204062),
    caution:holding(channels[1],'call',100,9.925053717274437),
    comfortable:holding(channels[2],'call',110,3),
    unscored:holding(channels[3],'put',100,1,'2026-10-29','MISS'),
    distantUnscored:holding(channels[3],'put',110,1,'2027-10-22','MISS'),
  };
  for (let i=0;i<36;i++) holdings['extra-'+i]=holding(channels[i%4],'call',120,2.9999485151236165);
  const dashboard: any = {
    empty:false,displayName:'Feedback test',productProfile:'consultant',generatedAt:'2026-10-22T10:00:00Z',equityPrices:{AAPL:100},
    dashboardConfig:{dashboardVersion:'v2',showTotalPremium:true,showRealizedPnl:true},
    brokerAsOf:Object.fromEntries(channels.map(channel=>[channel,'2026-10-22'])),
    brokerChannels:Object.fromEntries(channels.map((channel,i)=>[channel,{brokerId:['ibkr','moomoo','tiger','webull'][i],label:channel}])),
    model:buildDashboardModel(buildLivePositions(holdings,{AAPL:100}),[]),
    premiumJournal:{channels,available:true,daily:[{date:'2026-10-22',channel:channels[0],currency:'USD',gross_premium:3487}]},
    optionAnalytics:{executions:[],gaps:[],profits:[{date:'2026-10-22',channel:channels[0],currency:'USD',net:5875,gross:5900}]},
  };
  for (const p of dashboard.model.live.positions) if (p.option?.underlying === 'AAPL') {
    p.probabilityQuote = { mark: p.option.mark, spot: 100, optionAsOf: '2026-10-22T19:59:00Z', spotAsOf: '2026-10-22T20:00:00Z' };
  }
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url!,'http://localhost');
    const json=(body:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(withPageProjections(body)));};
    if(url.pathname==='/shell') {res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0"><style>.domain-page-frame{height:calc(100dvh - 68px)}.trading-brand{display:inline-flex;align-items:center}.trading-brand img{display:block;width:220px;height:61px;object-fit:cover}@media(max-width:700px){.trading-brand img{width:165px;height:46px}}</style><div class="trading-shell" style="height:100dvh;overflow:hidden;display:flex;flex-direction:column;--shell-header-height:68px"><header class="trading-header" style="min-height:68px;flex-shrink:0;background:#090e16;color:#ddd"><a class="trading-brand"><img src="/velovest-logo-dark.webp" alt="Velovest.ai Intelligent Investment Technology"></a></header><iframe class="domain-page-frame" src="/dashboard/v2.html" style="display:block;width:100%;border:0;flex-shrink:0"></iframe></div>');}
    if(url.pathname.endsWith('/dashboard')) return json(dashboard);
    if(url.pathname.endsWith('/broker-sync')) return json(null);
    if(url.pathname.endsWith('/option-history')) return json({episodes:[],connections:[],gaps:[],next_offset:null});
    if(url.pathname==='/api/chat/messages') {let body='';for await(const chunk of req) body+=chunk;prompts.push(JSON.parse(body).text);return json({conversationId:'contract-discussion-'+prompts.length});}
    const file=resolve(root,'.'+url.pathname);
    if(!file.startsWith(root+'/')||!existsSync(file)){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'} as Record<string,string>)[extname(file)] || 'application/octet-stream');res.end(readFileSync(file));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(origin)?req.continue():req.abort());
    await page.setViewport({width:1366,height:768});await page.goto(origin+'/shell');
    const frame=page.frames().find(frame=>frame.url().endsWith('/dashboard/v2.html'))!;
    await frame.waitForFunction(()=>document.getElementById('loadProgress')?.getAttribute('aria-valuenow')==='8');
    expect(await frame.$$('#channelPills img')).toHaveLength(0);
    expect(await frame.$$eval('#channelPills button', nodes => nodes.map(node => node.textContent))).toEqual(['All accounts', 'IBKR', 'moomoo', 'Tiger Brokers', 'Webull']);
    for(const [width,height] of [[1366,768],[1440,900],[1920,1080]]) {
      await page.setViewport({width,height});
      expect(await frame.evaluate(()=>document.getElementById('expiryRow')!.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
      for(const selector of ['.risk-card .table-scroll','.option-ledger-card .table-scroll']) {
        expect(await frame.$eval(selector,node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
      }
    }
    expect(await frame.$$eval('.risk-table th',nodes=>nodes.map(n=>n.textContent!.replace(/[?i]$/g,'').replace(/\?/g,'').trim()))).toEqual(['FIN INSTRUMENT (Discuss)','Pos','Days','Spot','Strike','Moneyness %','IV','If Assigned','Prob. ITM','Last ($)','Avg Px','Market Value','Unrealized P&L (%)','Broker']);
    expect(await frame.$$eval('.option-ledger th',nodes=>nodes.map(n=>n.textContent!.replace(/[?i]$/g,'').replace(/\?/g,'').trim()))).toEqual(['FIN INSTRUMENT','Pos','Last ($)','PREMIUM / ROLL','Avg Px','MKT Value','Unrealized P&L (%)','Days','Opened','Spot','Entry Spot','Assignment','Broker']);
    expect(await frame.$eval('.risk-method',node=>node.textContent)).toContain('r = 4%, q = 0, T = DTE/365');
    await page.setViewport({width:1440,height:900});
    expect(await frame.$$('.risk-row')).toHaveLength(5);
    expect(await frame.$eval('[data-risk-level="all"]', node => node.getAttribute('aria-pressed'))).toBe('true');
    expect(await frame.$eval('.risk-filter-count', node => node.textContent)).toContain('Prob. ITM >30%');
    expect(await frame.$$eval('.risk-row td:nth-child(9)', nodes => nodes.map(node => node.textContent).join(' '))).toContain('31.3%');
    await frame.click('[data-risk-level="ok"]');
    for (const [selector, count] of [['.risk-card .table-scroll',15],['.option-ledger-card .table-scroll',10]] as const) {
      const capacity = await frame.$eval(selector, node => {
        const row = node.querySelector('tbody tr:not(.option-month-total)')!;
        return Math.floor((node.clientHeight - node.querySelector('thead')!.getBoundingClientRect().height) / row.getBoundingClientRect().height);
      });
      expect(capacity).toBeGreaterThanOrEqual(count);
    }
    await frame.click('[data-risk-level="all"]');
    expect(await frame.$$('.risk-row')).toHaveLength(5); // Low probabilities stay filtered; both missing-input contracts remain visible.
    await frame.click('[data-risk-level="danger"]');expect(await frame.$$('.risk-row')).toHaveLength(1);
    expect(await frame.$eval('.risk-row',node=>node.textContent)).toContain('88.8%');
    await frame.click('[data-risk-level="warning"]');expect(await frame.$$('.risk-row')).toHaveLength(3);
    expect(await frame.$eval('.risk-table tbody',node=>node.textContent)).toContain('54.0%');
    await frame.click('[data-risk-level="ok"]');expect(await frame.$$('.risk-row')).toHaveLength(37);
    await frame.click('[data-risk-level="all"]');
    await frame.click('[data-risk-broker="custom-ibkr-account"]');expect(await frame.$$('.risk-row')).toHaveLength(1);
    await frame.click('[data-risk-broker="all"]');
    await frame.type('#riskSearch','MISS');await frame.waitForFunction(()=>document.querySelectorAll('.risk-row').length===2);
    const missingCells = await frame.$$eval('.risk-row td:nth-child(9)', nodes => nodes.map(node => node.textContent));
    expect(missingCells.every(text => text?.includes('Caution') && !text.includes('%') && !text.includes('unknown'))).toBe(true);
    // Missing-input contracts remain visible in Section 01 and discussable in Section 03.
    await frame.type('#optionSearch','MISS PUT $100');
    await frame.waitForFunction(()=>document.querySelectorAll('.option-ledger-row').length===1);
    await frame.click('.option-ledger-row .option-instrument-link');await expect.poll(()=>prompts.length).toBe(1);
    expect(prompts[0]).toContain('MISS short put, strike 100 USD, expiry 2026-10-29');
    expect(await frame.$eval('.option-ledger-row .option-instrument-link',node=>node.textContent)).toContain('MISS PUT $100 29-OCT-2026');
    await frame.$eval('#optionSearch',node=>{(node as HTMLInputElement).value='';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await frame.click('#channelPills [data-channel="custom-ibkr-account"]');
    expect(await frame.$$eval('.option-ledger-row td:last-child',nodes=>nodes.every(node=>node.textContent==='IBKR'))).toBe(true);
    await frame.click('#channelPills [data-channel="merged"]');
    await frame.$eval('[data-option-broker="moomoo-main"]', node => node.scrollIntoView({block:'center'}));
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await frame.click('[data-option-broker="moomoo-main"]');expect(await frame.$$('.option-ledger-row')).toHaveLength(10);
    await frame.click('[data-option-broker="all"]');await frame.type('#optionSearch','CALL $80');
    await frame.waitForFunction(()=>document.querySelectorAll('.option-ledger-row').length===1);
    expect(await frame.$eval('.option-ledger-row td:nth-child(3)',node=>node.textContent)).toBe('23.91');
    expect(await frame.$eval('.option-ledger-row td:nth-child(4)',node=>node.textContent)).toBe('—'); // No reconciled fills: never substitute book cost.
    await frame.click('.option-ledger-row .option-instrument-link');await expect.poll(()=>prompts.length).toBe(2);
    expect(prompts[1]).toContain('AAPL short call, strike 80 USD, expiry 2027-10-22');
    await frame.$eval('#optionSearch',node=>{(node as HTMLInputElement).value='';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await frame.waitForFunction(()=>document.querySelectorAll('.option-ledger-row').length===41);
    // Restore risk rows before capturing desktop and mobile states.
    await frame.$eval('#riskSearch',node=>{(node as HTMLInputElement).value='';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await frame.waitForFunction(()=>document.querySelectorAll('.risk-row').length===5);
    await page.setViewport({width:1366,height:768});await frame.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'/tmp/velovest-feedback-desktop.png'});
    await frame.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.trading-header')!).visibility === 'hidden');
    expect(await page.$eval('.trading-header',node=>getComputedStyle(node).visibility)).toBe('hidden');
    expect(await page.$eval('iframe',node=>node.getBoundingClientRect().height)).toBe(768);
    await page.screenshot({path:'/tmp/velovest-feedback-bottom.png'});
    for(const width of [320,390,768]) {
      await page.setViewport({width,height:844});await frame.evaluate(()=>window.scrollTo(0,0));
      expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.setViewport({width:390,height:844});await page.screenshot({path:'/tmp/velovest-feedback-mobile.png'});
    expect(errors).toEqual([]);
  } finally {await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
},30000);
