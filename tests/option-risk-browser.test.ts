import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
const executable = process.env.CHROME_BINARY || '/usr/bin/chromium';
const contextId = 'a'.repeat(64);
function result(account = 'ibkr') {
  return { id: '00000000-0000-4000-8000-000000000001', status: 'ready', analysisContextId: contextId, portfolioRevision: '1', generatedAt: new Date().toISOString(),
    marketAsOf: new Date().toISOString(), marketSnapshotId: 'snapshot', metadataVersion: 'verified', model: { id: 'fixture', version: 'v1' },
    scope: { accountIds: [account], currencies: ['USD'], horizonTradingDays: 5 }, capabilities: { stress: true, greeks: true, forecast: false, actions: false },
    coverage: { totalContracts: 1, supportedContracts: 1, totalQuantity: 2, supportedQuantity: 2, exclusions: [] },
    metrics: { stressLoss: { value: 100, unit: 'USD' }, dollarDelta: { value: -200, unit: 'USD' }, expectedShortfall: { value: null, unit: 'USD', reason: 'Validated forecasts unavailable' } },
    scenarios: [{ id: 'down', spotShock: -.1, volatilityPointShock: 10, byCurrency: [{ currency: 'USD', optionPnl: -150, combinedPnl: -100 }] }],
    contributors: [], payoffBounds: [], funding: [], actions: [], assumptions: ['Conditional scenario'] };
}
it.skipIf(!existsSync(executable))('isolates tabs, loads lazily, rejects late account responses and handles live disabling', async () => {
  const root = resolve('webui'); let enabled = false, loads = 0, posts = 0, latest = 0, capabilities = 0, hold = false, failJobs = false;
  const waiting: (() => void)[] = [];
  let holdCapabilities = false;
  const capabilityWaiting: (() => void)[] = [];
  let missingInputs = false;
  const prompts: string[] = [];
  const option = { right: 'put' as const, side: 'long' as const, strike: 100, expiry: '2027-01-15', multiplier: 100, underlying: 'AAPL', settlement: 'physical' as const, mark: 300 };
  const model = buildDashboardModel(buildLivePositions({
    'AAPL-P@ibkr': { instrument: 'option', units: 2, avg_price: 200, currency: 'USD', channel: 'ibkr', option },
    'AAPL-P@moomoo': { instrument: 'option', units: 1, avg_price: 200, currency: 'USD', channel: 'moomoo', option },
  }, { AAPL: 100 }), []);
  const server = createServer(async (req,res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/chat/messages') { let raw=''; for await (const c of req) raw+=c; prompts.push(JSON.parse(raw).text); return json({ message:'Chat fixture unavailable' },503); }
    if (url.pathname.endsWith('/dashboard')) { loads++; return json({ empty: false, displayName: 'Test', productProfile: 'consultant', generatedAt: '2026-10-16T10:00:00Z', model, analysisContextId: contextId, dashboardConfig: { showOptionRiskModelView: enabled } }); }
    if (url.pathname.endsWith('/capabilities')) { capabilities++; if (holdCapabilities) await new Promise<void>(r => capabilityWaiting.push(r)); return json({ enabled, available: true }); }
    if (url.pathname.endsWith('/latest')) { latest++; const account = JSON.parse(url.searchParams.get('accountIds')!)[0] || 'merged'; if (hold) await new Promise<void>(r => waiting.push(r)); return json({ job: null, stale: false, account }); }
    if (url.pathname.endsWith('/jobs')) { posts++; if (failJobs) return json({ error:'Worker fixture unavailable' },503); let raw=''; for await (const chunk of req) raw+=chunk; const data=JSON.parse(raw); const value=result(data.accountScope.accountIds[0] || 'merged'); if (missingInputs) Object.assign(value,{status:'unavailable',marketSnapshotId:'unavailable',marketAsOf:null,scenarios:[],coverage:{totalContracts:24,supportedContracts:0,totalQuantity:45,supportedQuantity:0,exclusions:[{id:'AAPL-P',quantity:2,reason:'Validated contract metadata and market snapshot unavailable'}]}}); return json({ id:'job', status:'complete', result:value }); }
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], next_offset: null });
    const file=resolve(root,'.'+url.pathname);
    if (!file.startsWith(root+'/') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': extname(file)==='.js' ? 'text/javascript' : extname(file)==='.css' ? 'text/css' : 'text/html' }); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args:['--no-sandbox'] });
  try {
    const page=await browser.newPage(), errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/dashboard/index.html`);
    await page.waitForSelector('#loading.hidden');
    expect(await page.$eval('#section01ViewTabs',e=>e.classList.contains('hidden'))).toBe(true);
    expect(posts).toBe(0); expect(latest).toBe(0); expect(capabilities).toBe(0);
    enabled=true; holdCapabilities=true; await page.reload();
    await expect.poll(()=>capabilityWaiting.length).toBe(1);
    // Production renders a cached dashboard before its fresh streamed payload.
    // A fresh context can arrive while the first capability request is pending.
    await page.evaluate(({model, contextId}) => (window as any).OptionRiskView.update({
      payload: { productProfile:'consultant', generatedAt:'2026-10-16T10:00:01Z', model,
        analysisContextId:contextId, dashboardConfig:{showOptionRiskModelView:true} },
      hasOptions:true, channel:'merged', date:'live', isLive:true,
    }), {model, contextId});
    holdCapabilities=false; capabilityWaiting.splice(0).forEach(r=>r());
    await page.waitForSelector('#section01ViewTabs:not(.hidden)', {timeout:3000});
    expect(await page.$eval('#section01RiskTab',e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(76);
    expect(await page.$eval('#section01ExistingTab',e=>e.getAttribute('aria-selected'))).toBe('true'); expect(posts).toBe(0);
    await page.focus('#section01ExistingTab'); await page.keyboard.press('End');
    await page.waitForFunction(()=>document.getElementById('optionRiskStatus')!.textContent!.startsWith('Ready'));
    expect(await page.$eval('#section01RiskTab',e=>e.getAttribute('aria-selected'))).toBe('true');
    expect(await page.$eval('#optionRiskOutput',e=>e.textContent)).toContain('Validated forecasts unavailable');
    await page.click('[data-option-risk-discuss]');
    await page.waitForFunction(()=>document.getElementById('optionChatStatus')!.textContent!.includes('Chat fixture unavailable'));
    expect(prompts[0]).toContain('get_option_risk_result');
    expect(prompts[0]).toContain('00000000-0000-4000-8000-000000000001');
    failJobs=true; await page.click('#optionRiskRun');
    await page.waitForFunction(()=>document.getElementById('optionRiskStatus')!.textContent!.includes('Stale result retained'));
    await page.waitForFunction(()=>document.getElementById('optionRiskStatus')!.textContent!.includes('Worker fixture unavailable'));
    expect(await page.$eval('#optionRiskOutput',e=>e.textContent)).toContain('100 USD');
    failJobs=false;
    const dashboardLoads=loads, submissions=posts;
    await page.click('#section01ExistingTab'); await page.click('#section01RiskTab');
    expect(loads).toBe(dashboardLoads); expect(posts).toBe(submissions);
    await page.click('#optionTimelineTab');
    expect(await page.$eval('#section01RiskTab',e=>e.getAttribute('aria-selected'))).toBe('true');
    hold=true;
    await page.click('#channelPills [data-channel="ibkr"]');
    await expect.poll(()=>waiting.length).toBe(1);
    await page.click('#channelPills [data-channel="moomoo"]');
    await expect.poll(()=>waiting.length).toBe(2);
    hold=false; waiting.splice(0).forEach(r=>r());
    await page.waitForFunction(()=>document.getElementById('optionRiskOutput')!.textContent!.includes('Accounts: moomoo'));
    expect(await page.$eval('#optionRiskOutput',e=>e.textContent)).not.toContain('Accounts: ibkr');
    await page.setViewport({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:'/tmp/invage-option-risk-mobile.png',fullPage:true});
    await page.setViewport({width:1440,height:1000});
    await (await page.$('#expiryBlock'))!.screenshot({path:'/tmp/invage-option-risk-desktop.png'});
    missingInputs=true; await page.click('#optionRiskRun');
    await page.waitForSelector('[data-option-risk-empty]');
    expect(await page.$eval('#optionRiskOutput',e=>e.textContent)).toContain('Market data is not connected');
    expect(await page.$$eval('#optionRiskOutput table, #optionRiskOutput .metric-card',e=>e.length)).toBe(0);
    expect(await page.$eval('#optionRiskRun',e=>e.textContent)).toBe('Check data again');
    await (await page.$('#expiryBlock'))!.screenshot({path:'/tmp/invage-option-risk-empty-desktop.png'});
    await page.setViewport({width:390,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await (await page.$('#expiryBlock'))!.screenshot({path:'/tmp/invage-option-risk-empty-mobile.png'});
    await page.focus('#optionRiskRun'); enabled=false;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('#section01ViewTabs.hidden');
    expect(await page.$eval('#section01ExistingPanel',e=>e.classList.contains('hidden'))).toBe(false);
    expect(await page.$eval('#optionRiskOutput',e=>e.textContent)).toBe('');
    expect(await page.evaluate(()=>document.activeElement?.id)).toBe('expiryTitle');
    expect(errors).toEqual([]);
  } finally { waiting.splice(0).forEach(r=>r()); capabilityWaiting.splice(0).forEach(r=>r()); await browser.close(); server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
}, 20000);
