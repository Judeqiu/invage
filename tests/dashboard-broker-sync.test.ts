import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('tracks broker sync through refresh, reports failures, and reconnects after reload', async () => {
  const root = resolve('webui');
  let posts = 0;
  let refreshes = 0;
  let failRefresh = false;
  let refresh: ServerResponse | undefined;
  let job: { id: string; status: string; accounts: { id: string; label: string; status: string }[] } | null = null;
  const payload = { empty: true, model: null, displayName: 'Sync test' };
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname.endsWith('/broker-sync')) {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        posts++;
        job = { id: String(posts), status: 'running', accounts: [
          { id: 'a', label: 'Main broker', status: 'running' },
          { id: 'b', label: 'Second broker', status: 'pending' },
        ] };
      }
      return res.end(JSON.stringify(job));
    }
    if (url.pathname.endsWith('/dashboard')) {
      res.setHeader('Content-Type', 'text/event-stream');
      if (url.searchParams.has('refresh')) {
        refreshes++;
        if (failRefresh) return res.end(frame({ type: 'error', message: 'Refresh failed' }));
        res.write(frame({ type: 'progress', completedStages: 3 }));
        refresh = res;
        return;
      }
      return res.end(frame({ type: 'result', payload }));
    }
    if (url.pathname.endsWith('/option-history')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ episodes: [], connections: [], gaps: [], next_offset: null }));
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
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
    await page.goto(origin + '/dashboard/index.html');
    await page.waitForSelector('#dashboardSync:enabled');
    await page.click('#dashboardSync');
    await page.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(await page.$eval('#dashboardSync', n => (n as HTMLButtonElement).disabled)).toBe(true);
    expect(await page.$eval('#dashboardRefresh', n => (n as HTMLButtonElement).disabled)).toBe(true);
    expect(refreshes).toBe(0);
    job!.accounts[0].status = 'succeeded'; job!.accounts[1].status = 'running';
    await page.waitForFunction(() => (document.getElementById('brokerSyncProgress') as HTMLProgressElement).value === 40);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Second broker'));
    expect(posts).toBe(1);
    job!.accounts[1].status = 'failed'; job!.status = 'completed';
    await page.waitForFunction(() => (document.getElementById('brokerSyncProgress') as HTMLProgressElement).value > 80);
    expect(refreshes).toBe(1);
    expect(await page.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBeLessThan(100);
    refresh!.end(frame({ type: 'result', payload }));
    await page.waitForSelector('#dashboardSync:enabled');
    expect(await page.$eval('#brokerSyncStatus', n => n.textContent)).toContain('1 synced, 1 failed');
    expect(await page.$eval('#brokerSyncDetails', n => n.textContent)).toContain('Second broker');
    expect(await page.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBe(100);
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-dashboard-broker-sync.png' });

    failRefresh = true;
    await page.click('#dashboardSync');
    await page.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    job!.accounts.forEach(a => { a.status = 'succeeded'; }); job!.status = 'completed';
    await page.waitForSelector('#dashboardSync:enabled');
    expect(await page.$eval('#brokerSyncStatus', n => n.textContent)).toContain('dashboard refresh failed');
    expect(await page.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBeLessThan(100);
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 25000);
