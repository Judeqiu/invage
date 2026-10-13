import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('shows real streamed progress, waits for history, and recovers from failures and truncated streams', async () => {
  const root = resolve('webui');
  let mode = 'held';
  let stream: ServerResponse | undefined;
  let history: ServerResponse | undefined;
  const body = { empty: true, model: null, displayName: 'München', productProfile: 'consultant' };
  const historyBody = { episodes: [], connections: [], gaps: [], history_started: false, next_offset: null };
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/api/domain/invage/dashboard') {
      if (mode === 'json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); }
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(frame({ type: 'progress', stage: 'market', completedStages: 1, totalStages: 6, positions: 0, tradeRecords: 1577, snapshots: 12 }));
      if (mode === 'fail') return res.end(frame({ type: 'error', message: 'Unable to fetch saved records. Please retry.' }));
      if (mode === 'cut') return res.end();
      stream = res; return;
    }
    if (url.pathname.endsWith('/option-history')) {
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'held') { history = res; return; }
      return res.end(JSON.stringify(historyBody));
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
    await page.goto(origin + '/dashboard/index.html');
    await page.waitForFunction(() => document.getElementById('loadProgress')!.getAttribute('aria-valuenow') === '1');
    expect(await page.$eval('#loadInsights', node => node.textContent)).toContain('1,577 option trade records');
    await page.waitForFunction(() => document.getElementById('loadElapsed')!.textContent!.includes('1s'));
    expect(await page.$eval('#loadProgress', node => node.getAttribute('aria-valuenow'))).toBe('1');
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/velovest-loading-progress.png' });
    const next = frame({ type: 'progress', stage: 'entry-prices', completedStages: 4, totalStages: 6, processed: 1, total: 4 });
    stream!.write(next.slice(0, 18));
    await new Promise(resolve => setTimeout(resolve, 20));
    stream!.write(next.slice(18));
    await page.waitForFunction(() => document.getElementById('loadProgress')!.getAttribute('aria-valuenow') === '4.25');
    expect(await page.$eval('#loadInsights', node => node.textContent)).toContain('1 of 4 stocks');
    const result = Buffer.from(frame({ type: 'result', payload: body }));
    const split = result.indexOf(Buffer.from('ü')) + 1;
    stream!.write(result.subarray(0, split));
    await new Promise(resolve => setTimeout(resolve, 20));
    stream!.end(result.subarray(split));
    await page.waitForSelector('#dashboard:not(.hidden)');
    expect(await page.$eval('#subtitle', node => node.textContent)).toContain('München');
    await page.waitForFunction(() => document.getElementById('loadProgress')!.getAttribute('aria-valuenow') === '7');
    expect(await page.$eval('#loading', node => node.classList.contains('hidden'))).toBe(false);
    history!.end(JSON.stringify(historyBody));
    await page.waitForSelector('#loading.hidden');
    expect(await page.$eval('#loadProgress', node => node.getAttribute('aria-valuenow'))).toBe('8');
    expect(await page.$eval('#status', node => node.textContent)).toContain('Loaded in');
    for (const failure of ['fail', 'cut']) {
      mode = failure;
      await page.reload();
      await page.waitForSelector('#error:not(.hidden)');
      expect(Number(await page.$eval('#loadProgress', node => node.getAttribute('aria-valuenow')))).toBeLessThan(8);
      expect(await page.$eval('#dashboard', node => node.getAttribute('aria-busy'))).toBe('false');
      mode = 'json';
      await page.click('#dashboardRetry');
      await page.waitForSelector('#loading.hidden');
      expect(await page.$eval('#error', node => node.classList.contains('hidden'))).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 20000);
