import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome)).each(['index.html', 'v2.html'])('%s shows streamed progress, becomes usable before history finishes, and recovers from failures', async (dashboardFile) => {
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
    await page.goto(origin + '/dashboard/' + dashboardFile);
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
    await page.waitForSelector('#loading.hidden');
    expect(await page.$eval('#dashboard', node => node.getAttribute('aria-busy'))).toBe('false');
    await page.waitForFunction(() => document.getElementById('optionFreshness')!.textContent!.includes('Loading option history'));
    history!.end(JSON.stringify(historyBody));
    expect(await page.$eval('#loadProgress', node => node.getAttribute('aria-valuenow'))).toBe('8');
    expect(await page.$('#status')).toBeNull();
    expect(await page.$('#dashboardRefresh')).toBeNull();
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

it.skipIf(!existsSync(chrome)).each(['index.html', 'v2.html'])('%s renders the saved snapshot during revalidation and keeps it visible if refresh fails', async (dashboardFile) => {
  const root = resolve('webui');
  const cached = { empty: false, displayName: 'Cached account', generatedAt: '2026-10-14T10:00:00Z',
    model: buildDashboardModel(buildLivePositions({ AAPL: { units: 2, avg_price: 100, currency: 'USD', channel: 'ibkr' } }, { AAPL: 110 }), []) };
  let stream: ServerResponse | undefined;
  let previewAvailable = true;
  const historyChannels: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/api/domain/invage/dashboard') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      if (previewAvailable && url.searchParams.get('preview') === '1') res.write(`data: ${JSON.stringify({ type: 'snapshot', payload: cached })}\n\n`);
      stream = res; return;
    }
    if (url.pathname.endsWith('/option-history')) {
      historyChannels.push(url.searchParams.get('channel') || '');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ episodes: [], connections: [{ channel: 'ibkr', broker_id: 'ibkr', enabled: true }], gaps: [], history_started: false, next_offset: null }));
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
    await page.goto(origin + '/dashboard/' + dashboardFile);
    await page.waitForFunction(() => document.getElementById('subtitle')!.textContent!.includes('Cached account'));
    expect(await page.$eval('#subtitle', node => node.textContent)).toContain('Cached account');
    expect(await page.$('#status')).toBeNull();
    expect(await page.$eval('#loading', node => node.classList.contains('hidden'))).toBe(true);
    expect(await page.$eval('#dashboard', node => node.getAttribute('aria-busy'))).toBe('false');
    await page.click('[data-channel="ibkr"]');
    await page.click('#optionHistoryTab');
    await waitForStream();
    stream!.end(`data: ${JSON.stringify({ type: 'error', message: 'Please retry.' })}\n\n`);
    await page.waitForSelector('#error:not(.hidden)');
    expect(await page.$eval('#dashboardErrorMessage', node => node.textContent)).toContain('showing the previous figures');
    expect(await page.$eval('#subtitle', node => node.textContent)).toContain('Cached account');
    stream = undefined;
    await page.click('#dashboardRetry');
    await waitForStream();
    stream!.end(`data: ${JSON.stringify({ type: 'result', payload: { ...cached, displayName: 'Fresh account', generatedAt: '2026-10-15T10:00:00Z' } })}\n\n`);
    await page.waitForFunction(() => document.getElementById('subtitle')!.textContent!.includes('Fresh account'));
    expect(await page.$('#status')).toBeNull();
    expect(await page.$eval('#subtitle', node => node.textContent)).toContain('Channel: ibkr');
    expect(await page.$eval('#optionHistoryTab', node => node.getAttribute('aria-pressed'))).toBe('true');
    // A cache miss still finishes through the same streamed request.
    previewAvailable = false; stream = undefined; historyChannels.length = 0;
    await page.goto(origin + '/dashboard/' + dashboardFile + '?channel=ibkr');
    await waitForStream();
    stream!.end(`data: ${JSON.stringify({ type: 'result', payload: cached })}\n\n`);
    await page.waitForFunction(() => document.getElementById('loadProgress')!.getAttribute('aria-valuenow') === '8');
    await page.waitForFunction(() => (document.getElementById('historyBroker') as HTMLSelectElement).value === 'ibkr');
    expect(historyChannels).toContain('ibkr');
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

  async function waitForStream() {
    const deadline = Date.now() + 3000;
    while (!stream) {
      if (Date.now() >= deadline) throw new Error('Dashboard refresh did not start');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}, 20000);
