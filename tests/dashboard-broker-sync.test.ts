import { expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome)).each(['index.html', 'v2.html'])('%s tracks header broker sync through refresh, failures, and reload', async (dashboardFile) => {
  const root = resolve('webui');
  let posts = 0;
  let slowPoll = false;
  let unavailablePoll = false;
  let refreshes = 0;
  let failRefresh = false;
  let refresh: ServerResponse | undefined;
  let job: { id: string; status: string; error?: string; accounts: { id: string; label: string; status: string }[] } | null = null;
  const payload = { empty: true, model: null, displayName: 'Sync test' };
  const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/shell') {
      res.setHeader('Content-Type','text/html');
      return res.end(`<button id="headerSync">Sync brokers</button><iframe src="/dashboard/${dashboardFile}"></iframe><script>
        const frame=document.querySelector('iframe');
        document.getElementById('headerSync').onclick=async()=>{await fetch('/broker-sync',{method:'POST'});frame.contentWindow.postMessage({type:'utarus:header-sync:activity'},location.origin);};
      </script>`);
    }
    if (url.pathname.endsWith('/broker-sync')) {
      if (req.method === 'GET' && slowPoll) {
        slowPoll = false;
        setTimeout(() => res.end(JSON.stringify(job)), 600);
        return;
      }
      if (req.method === 'GET' && unavailablePoll) {
        unavailablePoll = false;
        res.statusCode = 503; res.end('Temporarily unavailable'); return;
      }
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
    await page.evaluateOnNewDocument(() => {
      const timeout = AbortSignal.timeout.bind(AbortSignal);
      AbortSignal.timeout = ms => timeout(ms === 20000 ? 250 : ms);
    });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
    await page.goto(origin + '/shell');
    let dashboard = page.frames().find(frame=>frame.url().endsWith('/dashboard/' + dashboardFile))!;
    expect(await dashboard.$('#dashboardSync')).toBeNull();
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    await page.click('#headerSync');
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(await dashboard.$eval('#dashboardRetry', n => (n as HTMLButtonElement).disabled)).toBe(true);
    expect(await dashboard.$('#dashboardRefresh')).toBeNull();
    expect(await dashboard.$('#status')).toBeNull();
    expect(refreshes).toBe(0);
    slowPoll = true;
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncStatus')!.textContent!.includes('Reconnecting'));
    expect(await dashboard.$eval('#dashboardRetry', n => (n as HTMLButtonElement).disabled)).toBe(true);
    expect(await dashboard.$eval('#brokerSyncDetails', n => n.textContent)).toContain('do not need to start another sync');
    expect(posts).toBe(1);
    unavailablePoll = true;
    job!.accounts[0].status = 'succeeded'; job!.accounts[1].status = 'running';
    await dashboard.waitForFunction(() => (document.getElementById('brokerSyncProgress') as HTMLProgressElement).value === 40);
    await page.reload();
    dashboard = page.frames().find(frame=>frame.url().endsWith('/dashboard/' + dashboardFile))!;
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Second broker'));
    expect(posts).toBe(1);
    job!.accounts[1].status = 'failed'; job!.status = 'completed';
    await dashboard.waitForFunction(() => (document.getElementById('brokerSyncProgress') as HTMLProgressElement).value > 80);
    expect(refreshes).toBe(1);
    expect(await dashboard.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBeLessThan(100);
    refresh!.end(frame({ type: 'result', payload }));
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    expect(await dashboard.$eval('#brokerSyncStatus', n => n.textContent)).toContain('1 synced, 1 failed');
    expect(await dashboard.$eval('#brokerSyncDetails', n => n.textContent)).toContain('Second broker');
    expect(await dashboard.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBe(100);
    expect(await dashboard.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).toBe('none');
    expect(await dashboard.$eval('#brokerSyncPanel', n => getComputedStyle(n).display)).not.toBe('none');
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-dashboard-broker-sync.png' });

    failRefresh = true;
    await page.click('#headerSync');
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(await dashboard.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).not.toBe('none');
    job!.accounts.forEach(a => { a.status = 'succeeded'; }); job!.status = 'completed';
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    expect(await dashboard.$eval('#brokerSyncStatus', n => n.textContent)).toContain('dashboard refresh failed');
    expect(await dashboard.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBeLessThan(100);
    expect(await dashboard.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).toBe('none');

    failRefresh = false;
    await page.click('#headerSync');
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    job!.accounts.forEach(a => { a.status = 'succeeded'; }); job!.status = 'completed';
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncStatus')!.textContent!.startsWith('Refreshing dashboard'));
    await vi.waitFor(() => expect(refreshes).toBe(3));
    refresh!.end(frame({ type: 'result', payload }));
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    expect(await dashboard.$eval('#brokerSyncPanel', n => getComputedStyle(n).display)).toBe('none');
    await page.goto(origin + '/shell');
    dashboard = page.frames().find(frame=>frame.url().endsWith('/dashboard/' + dashboardFile))!;
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    expect(await dashboard.$('#dashboardSync')).toBeNull();
    await page.click('#headerSync');
    await dashboard.waitForFunction(()=>document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(posts).toBe(4);
    job!.accounts.forEach(account=>{account.status='succeeded';});job!.status='completed';
    await vi.waitFor(()=>expect(refreshes).toBe(4), {timeout:5000});
    refresh!.end(frame({type:'result',payload}));
    await dashboard.waitForFunction(()=>!(document.getElementById('dashboardRetry') as HTMLButtonElement).disabled);
    expect(await dashboard.$eval('#brokerSyncPanel',node=>getComputedStyle(node).display)).toBe('none');
    await page.click('#headerSync');
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    job!.accounts.forEach(account => { account.status = 'succeeded'; });
    await dashboard.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Saving portfolio totals and snapshot'));
    expect(refreshes).toBe(4);
    expect(await dashboard.$eval('#dashboardRetry', node => (node as HTMLButtonElement).disabled)).toBe(true);
    job!.error = 'Could not finish saving the portfolio snapshot and aggregates. Sync brokers again to retry.';
    job!.status = 'completed';
    await vi.waitFor(() => expect(refreshes).toBe(5), { timeout: 5000 });
    refresh!.end(frame({ type: 'result', payload }));
    await dashboard.waitForSelector('#dashboardRetry:enabled');
    expect(await dashboard.$eval('#brokerSyncStatus', node => node.textContent)).toContain('snapshot and aggregates');
    expect(await dashboard.$eval('#brokerSyncPanel', node => getComputedStyle(node).display)).not.toBe('none');
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 35000);
