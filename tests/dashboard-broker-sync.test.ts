import { expect, it, vi } from 'vitest';
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
    if (url.pathname === '/shell') {
      res.setHeader('Content-Type','text/html');
      return res.end(`<button id="headerSync">Sync brokers</button><iframe src="/dashboard/index.html"></iframe><script>
        const frame=document.querySelector('iframe');
        window.addEventListener('message',event=>{if(event.source===frame.contentWindow && event.origin===location.origin && event.data?.type==='utarus:header-sync:ready') frame.contentWindow.postMessage({type:'utarus:header-sync:available'},location.origin);});
        document.getElementById('headerSync').onclick=async()=>{await fetch('/broker-sync',{method:'POST'});frame.contentWindow.postMessage({type:'utarus:header-sync:activity'},location.origin);};
      </script>`);
    }
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
    expect(await page.$('#dashboardRefresh')).toBeNull();
    expect(await page.$('#status')).toBeNull();
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
    expect(await page.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).toBe('none');
    expect(await page.$eval('#brokerSyncPanel', n => getComputedStyle(n).display)).not.toBe('none');
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-dashboard-broker-sync.png' });

    failRefresh = true;
    await page.click('#dashboardSync');
    await page.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(await page.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).not.toBe('none');
    job!.accounts.forEach(a => { a.status = 'succeeded'; }); job!.status = 'completed';
    await page.waitForSelector('#dashboardSync:enabled');
    expect(await page.$eval('#brokerSyncStatus', n => n.textContent)).toContain('dashboard refresh failed');
    expect(await page.$eval('#brokerSyncProgress', n => (n as HTMLProgressElement).value)).toBeLessThan(100);
    expect(await page.$eval('#brokerSyncProgress', n => getComputedStyle(n).display)).toBe('none');

    failRefresh = false;
    await page.click('#dashboardSync');
    await page.waitForFunction(() => document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    job!.accounts.forEach(a => { a.status = 'succeeded'; }); job!.status = 'completed';
    await page.waitForFunction(() => document.getElementById('brokerSyncStatus')!.textContent!.startsWith('Refreshing dashboard'));
    await vi.waitFor(() => expect(refreshes).toBe(3));
    refresh!.end(frame({ type: 'result', payload }));
    await page.waitForSelector('#dashboardSync:enabled');
    expect(await page.$eval('#brokerSyncPanel', n => getComputedStyle(n).display)).toBe('none');
    await page.goto(origin + '/shell');
    const dashboard = page.frames().find(frame=>frame.url().endsWith('/dashboard/index.html'))!;
    await dashboard.waitForFunction(()=>document.getElementById('dashboardSync')?.hidden === true);
    expect(await dashboard.$eval('#dashboardSync',node=>getComputedStyle(node).display)).toBe('none');
    await page.click('#headerSync');
    await dashboard.waitForFunction(()=>document.getElementById('brokerSyncDetails')!.textContent!.includes('Main broker'));
    expect(posts).toBe(4);
    job!.accounts.forEach(account=>{account.status='succeeded';});job!.status='completed';
    await vi.waitFor(()=>expect(refreshes).toBe(4), {timeout:5000});
    refresh!.end(frame({type:'result',payload}));
    await dashboard.waitForFunction(()=>!(document.getElementById('dashboardSync') as HTMLButtonElement).disabled);
    expect(await dashboard.$eval('#brokerSyncPanel',node=>getComputedStyle(node).display)).toBe('none');
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 25000);
