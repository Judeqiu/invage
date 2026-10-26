import { withPageProjections } from './helpers/portfolio-projection.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { positionsFixture } from './helpers/positions-fixture.js';
import { dashboardConfig, readDashboardConfig } from '../src/webapp/dashboard-config.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';

it('switches Positions independently from the dashboard through management config', () => {
  const dir = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
  const file = join(dir, dashboardConfig.id + '.json'); mkdirSync(dir, { recursive:true });
  const routes = () => createInvageWebUi().routes!;
  try {
    expect(readDashboardConfig().positionsVersion).toBe('v1');
    expect(routes().find(r => r.path === '/positions')?.iframeSrc).toContain('/positions/index.html');
    writeFileSync(file, JSON.stringify({ positions_version:'v2', dashboard_version:'v1' }));
    expect(routes().find(r => r.path === '/positions')?.iframeSrc).toContain('/positions/v2.html');
    expect(routes().find(r => r.path === '/dashboard')?.iframeSrc).toContain('/dashboard/index.html');
    writeFileSync(file, JSON.stringify({ positions_version:'v1', dashboard_version:'v2' }));
    expect(routes().find(r => r.path === '/positions')?.iframeSrc).toContain('/positions/index.html');
    expect(routes().find(r => r.path === '/dashboard')?.iframeSrc).toContain('/dashboard/v2.html');
  } finally { rmSync(file, { force:true }); }
});

const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('matches every mockup column, filters both tables, revalidates snapshots and recovers on mobile', async () => {
  const root = resolve('webui'), dashboard = positionsFixture();
  dashboard.model.live.issues = [{ message:'München data note: <img src=x onerror=alert(1)>' }];
  let stream: ServerResponse | undefined, mode = 'held', requests = 0;
  const event = (type: string, body: any) => 'data: ' + JSON.stringify({ type, ...body, ...(body.payload ? {payload: withPageProjections(body.payload)} : {}) }) + '\n\n';
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.endsWith('/dashboard')) {
      requests++; res.setHeader('Content-Type', 'text/event-stream');
      if (mode === 'cut') return res.end(event('progress', { stage:'records', completedStages:0 }));
      if (mode === 'fail') return res.end(event('error', { message:'Quote provider temporarily unavailable.' }));
      if (mode === 'fresh') return res.end(event('result', { payload:dashboard }));
      const snapshot = Buffer.from(event('snapshot', { payload:dashboard }));
      const split = snapshot.indexOf(Buffer.from('ü')) + 1;
      res.write(snapshot.subarray(0, split)); res.write(snapshot.subarray(split));
      res.write(event('progress', { stage:'market', completedStages:1, totalStages:6 }));
      stream = res; return;
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath, headless:true, args:['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith(origin) ? req.continue() : req.abort());
    await page.setViewport({ width:1440, height:1100 });
    await page.goto(origin + '/positions/v2.html', { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('positionsStatus')?.textContent?.startsWith('Snapshot'));
    expect(await page.$eval('#positionsContent', node => node.getAttribute('aria-busy'))).toBe('false');
    expect(await page.$('#positionsWarnings')).toBeNull();
    expect(await page.$('#positionsRefresh')).toBeNull();
    const columnLabels = (selector: string) => page.$$eval(selector + ' .col-label', nodes => nodes.map(node => { const copy = node.cloneNode(true) as Element; copy.querySelectorAll('button').forEach(b => b.remove()); return copy.textContent!.trim(); }));
    expect(await columnLabels('#stocksTable')).toEqual(['Ticker','Shares','Avg cost','Total cost','Last','Market value','Unrealized P&L','Return','% of NAV','Covered','Broker']);
    expect(await columnLabels('#obligationsTable')).toEqual(['Ticker','Last','Shares held','Put contracts','Cash if assigned','Call contracts','Shares if called','Premium','Open P&L','Nearest expiry','High risk']);
    expect(await page.$$eval('#stocksTable tbody tr, #obligationsTable tbody tr', rows => rows.every(row => row.children.length === 11))).toBe(true);
    expect(await page.$eval('#stocksTable tbody', node => node.textContent)).toContain('100 / 300');
    expect(await page.$eval('#obligationsTable tbody', node => node.textContent)).toContain('2 above 60%');
    await page.click('#positionsFilters [data-channel="tiger"]');
    expect(await page.$eval('#positionsCash', node => node.textContent)).toContain('$2,000.00');
    expect(await page.$eval('#obligationsTable tbody', node => node.textContent)).toContain('No recorded positions');
    expect(await page.$eval('#stocksTable tbody', node => node.textContent)).toContain('0 / 200');
    expect(new URL(page.url()).searchParams.get('channel')).toBe('tiger');
    await page.click('#positionsFilters [data-channel="all"]');
    stream!.end(event('result', { payload:dashboard }));
    await page.waitForSelector('#positionsRetry:enabled');
    await page.screenshot({ path:'/tmp/invage-positions-v2-desktop.png', fullPage:true });
    for (const width of [390, 768, 1100]) {
      await page.setViewport({ width, height:900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewport({ width:390, height:844 });
    await page.$eval('#obligationsTable', node => { node.scrollLeft = node.scrollWidth; });
    expect(await page.$eval('#obligationsTable', node => node.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({ path:'/tmp/invage-positions-v2-mobile.png', fullPage:true });
    mode = 'fail'; await page.reload(); await page.waitForSelector('#positionsError:not([hidden])');
    expect(await page.$eval('#positionsStatus', node => node.textContent)).toContain('could not be loaded');
    expect(await page.$eval('#stocksTable', node => node.textContent)).toContain('unavailable');
    mode = 'fresh'; await page.click('#positionsRetry');
    await page.waitForFunction(() => document.getElementById('positionsStatus')?.textContent?.startsWith('Portfolio valued'));
    expect(await page.$eval('#positionsError', node => node.hasAttribute('hidden'))).toBe(true);
    expect(requests).toBe(3);
    mode = 'cut'; await page.reload();
    await page.waitForSelector('#positionsError:not([hidden])');
    expect(await page.$eval('#positionsError', node => node.textContent)).toContain('Loading stopped');
    expect(await page.$eval('#stocksTable', node => node.textContent)).toContain('Positions are unavailable');
    expect(await page.$eval('#positionsRetry', node => (node as HTMLButtonElement).disabled)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}, 25000);
