import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dashboardConfig, readDashboardConfig } from '../src/webapp/dashboard-config.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';
import { insightsFixture } from './helpers/insights-fixture.js';
it('switches Insights independently and keeps the other versions and settings',() => {
  const dir = join(process.env.UTARUS_DATA_ROOT!,'config','agent-config'),file = join(dir,dashboardConfig.id+'.json');mkdirSync(dir,{recursive:true});
  const route = (path: string) => createInvageWebUi().routes!.find(r => r.path === path)?.iframeSrc;
  try {
    expect(readDashboardConfig().insightsVersion).toBe('v1');expect(route('/insights')).toContain('/insights/index.html');
    writeFileSync(file,JSON.stringify({insights_version:'v2',dashboard_version:'v2',positions_version:'v1',trades_version:'v2',show_realized_pnl:false}));
    expect(route('/insights')).toContain('/insights/v2.html');expect(route('/positions')).toContain('/positions/index.html');
    expect(route('/dashboard')).toContain('/dashboard/v2.html');expect(route('/trades')).toContain('/trades/v2.html');
    expect(readDashboardConfig().showRealizedPnl).toBe(false);
    writeFileSync(file,JSON.stringify({insights_version:'v1',positions_version:'v2'}));expect(route('/insights')).toContain('/insights/index.html');
  }finally{rmSync(file,{force:true});}
});
const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('renders cached five-section insights, all columns and eight statistics, filters, mobile and retry states',async () => {
  const root = resolve('webui'),payload = insightsFixture();
  payload.model.live.issues = [{message:'München note: <img src=x onerror=alert(1)>'}];
  let stream: ServerResponse | undefined,mode = 'held',requests = 0;
  const event = (type: string,body: unknown) => 'data: '+JSON.stringify({type,...body as any})+'\n\n';
  const server = createServer((req,res) => {
    const url = new URL(req.url!,'http://localhost');
    if (url.pathname.endsWith('/dashboard')) {
      requests++;res.setHeader('Content-Type','text/event-stream');
      if (mode === 'fail') return res.end(event('error',{message:'Quote provider unavailable.'}));
      if (mode === 'cut') return res.end(event('progress',{stage:'records',completedStages:0}));
      if (mode === 'fresh') return res.end(event('result',{payload}));
      const b = Buffer.from(event('snapshot',{payload})),split = b.indexOf(Buffer.from('ü'))+1;
      res.write(b.subarray(0,split));res.write(b.subarray(split));res.write(event('progress',{stage:'market',completedStages:1}));stream = res;return;
    }
    const file = resolve(root,'.'+url.pathname);
    if (!file.startsWith(root+'/') || !existsSync(file)) {res.statusCode = 404;return res.end();}
    res.setHeader('Content-Type',extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0,'127.0.0.1',r));
  const browser = await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage(),errors: string[] = [];page.on('pageerror',e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);page.on('request',r => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.setViewport({width:1440,height:1100});await page.goto(origin+'/insights/v2.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Snapshot'));
    expect(await page.$eval('#content',n => n.getAttribute('aria-busy'))).toBe('false');
    expect(await page.$$eval('section h2',ns => ns.map(n => n.textContent))).toEqual(["Today's risks",'Book patterns','Recommended actions','Book statistics','Premium and P&L by underlying']);
    expect(await page.$$eval('#underlyings thead th',ns => ns.map(n => n.textContent))).toEqual(['Underlying','Contract lines','Premium received','Open P&L','Signal']);
    expect(await page.$$eval('#underlyings tbody tr',ns => ns.every(n => n.children.length === 5))).toBe(true);
    expect(await page.$$('#statistics > .metric-card')).toHaveLength(8);
    expect(await page.$eval('#actions',n => n.textContent)).toContain('90%');
    expect(await page.$eval('#availability',n => n.textContent)).toContain('München');expect(await page.$('#availability img')).toBeNull();
    await page.click('[data-channel="tiger"]');expect(await page.$eval('#metrics',n => n.textContent)).toContain('$2,000.00');
    expect(await page.$eval('#underlyings',n => n.textContent)).toContain('No recorded option');
    expect(await page.$eval('#summary',n => n.textContent)).toContain('0 open option lines');
    expect(new URL(page.url()).searchParams.get('channel')).toBe('tiger');
    await page.click('[data-channel="all"]');stream!.end(event('result',{payload}));await page.waitForSelector('#refresh:enabled');
    await page.screenshot({path:'/tmp/invage-insights-v2-desktop.png',fullPage:true});
    for (const width of [390,768,1100]) {await page.setViewport({width,height:900});expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);}
    await page.setViewport({width:390,height:844});await page.$eval('#underlyings',n => {n.scrollLeft = n.scrollWidth;});expect(await page.$eval('#underlyings',n => n.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({path:'/tmp/invage-insights-v2-mobile.png',fullPage:true});
    mode = 'fail';await page.click('#refresh');await page.waitForSelector('#error:not([hidden])');expect(await page.$eval('#status',n => n.textContent)).toContain('Showing snapshot');expect(await page.$eval('#actions',n => n.textContent)).toContain('90%');
    mode = 'fresh';await page.click('#retry');await page.waitForSelector('#refresh:enabled');expect(await page.$eval('#error',n => n.hasAttribute('hidden'))).toBe(true);
    expect(requests).toBe(3);
    mode = 'cut';await page.reload();await page.waitForSelector('#error:not([hidden])');expect(await page.$eval('#risks',n => n.textContent)).toContain('unavailable');expect(await page.$eval('#content',n => n.getAttribute('aria-busy'))).toBe('false');
    expect(errors).toEqual([]);
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r => server.close(() => r()));}
},30000);
