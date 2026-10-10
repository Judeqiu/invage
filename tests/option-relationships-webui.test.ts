import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildOptionRelationships, groupOptionRelationships, type RollFill } from '../src/brokers/option-relationships.js';

const executable = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executable))('renders live foldable groups, nested evidence, filters, paging, retry and keyboard controls with empty books', async () => {
  const connections = [{ channel: 'ibkr', broker_id: 'ibkr', account_id: 'A', label: 'IBKR' }];
  const contract = { underlying: 'AMD', right: 'call' as const, expiry: '2026-11-20', strike: '200', multiplier: '100', currency: 'USD' };
  const fs: RollFill[] = [
    { id: 'c', order: 'c', parent: 'parent', prefix: '', account: 'A', contract, quantity: '2', side: 'buy', effect: 'close',
      at: '2026-10-01T10:00:00', clock: 'Broker-reported clock', cash: '-100', basis: 'net', terminal: false, source: { id: '<script>bad()</script>.xml', version: 'v1' } },
    { id: 'o', order: 'o', parent: 'parent', prefix: '', account: 'A', contract: { ...contract, expiry: '2027-01-15', strike: '220' }, quantity: '2', side: 'sell', effect: 'open',
      at: '2026-10-01T10:00:00', clock: 'Broker-reported clock', cash: '200', basis: 'net', terminal: false, source: { id: 'safe.xml', version: 'v1' } },
  ];
  const group = groupOptionRelationships(buildOptionRelationships('ibkr', 'ibkr', 'A', fs), fs)[0];
  const allGroups = [group, { ...group, id: 'second' }, { ...group, id: 'third' }];
  const root = resolve('webui'); const queries: URLSearchParams[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith('/dashboard') && url.pathname.startsWith('/api/')) return json({ empty: true, displayName: 'Test', productProfile: 'consultant' });
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], history_started: true, total: 0, next_offset: null });
    if (url.pathname.endsWith('/option-relationships')) {
      queries.push(url.searchParams);
      if (url.searchParams.get('q') === 'ERR') return json({ message: 'Temporary archive error' }, 503);
      const q = url.searchParams.get('q'); const rows = q && q !== 'AMD' ? [] : allGroups;
      const offset = Number(url.searchParams.get('offset') || 0);
      return json({ groups: rows.slice(offset, offset + 2), total: rows.length, next_offset: offset + 2 < rows.length ? offset + 2 : null,
        coverage: [], connections, gaps: [] });
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html' });
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 950 }); await page.goto(`http://127.0.0.1:${port}/dashboard/index.html`);
    await page.waitForFunction(() => !document.getElementById('dashboard')!.classList.contains('hidden'));
    await page.click('#optionRollsTab'); await page.waitForSelector('.roll-folder');
    expect(await page.$$eval('.roll-folder', ds => ds.length)).toBe(2);
    await page.click('#rollExpand'); expect(await page.$$eval('.roll-folder', ds => ds.every(d => (d as HTMLDetailsElement).open))).toBe(true);
    await page.click('.roll-node > summary'); await page.click('.roll-evidence > summary');
    expect(await page.$eval('.roll-sources', el => el.textContent)).toContain('<script>bad()</script>');
    expect(await page.$eval('.roll-node-body', el => el.textContent)).toContain('reported net cash');
    await page.click('[data-history-from-roll]');
    expect(await page.$eval('#optionHistoryPanel', el => el.classList.contains('hidden'))).toBe(false);
    expect(await page.$eval('#historySearch', el => (el as HTMLInputElement).value)).toBe('AMD');
    await page.click('#optionRollsTab');
    await page.click('#rollMore'); await page.waitForFunction(() => document.querySelectorAll('.roll-folder').length === 3);
    await page.screenshot({ path: '/tmp/live-option-relationships-desktop.png', fullPage: true });
    await page.click('#rollCollapse'); expect(await page.$$eval('#rollGroups details', ds => ds.some(d => (d as HTMLDetailsElement).open))).toBe(false);
    await page.focus('.roll-folder > summary'); await page.keyboard.press('Enter');
    expect(await page.$eval('.roll-folder', d => (d as HTMLDetailsElement).open)).toBe(true);
    await page.type('#rollSearch', 'MISSING'); await page.waitForFunction(() => document.getElementById('rollGroups')!.textContent!.includes('No linked rolls'));
    await page.$eval('#rollSearch', el => { (el as HTMLInputElement).value = 'ERR'; el.dispatchEvent(new Event('input')); });
    await page.waitForFunction(() => !document.getElementById('rollRetry')!.classList.contains('hidden'));
    await page.$eval('#rollSearch', el => { (el as HTMLInputElement).value = ''; }); await page.click('#rollRetry'); await page.waitForSelector('.roll-folder');
    await page.select('#rollBroker', 'ibkr'); await page.waitForFunction(() => document.getElementById('rollStatus')!.textContent!.includes('3 contract groups'));
    expect(queries.some(q => q.get('channel') === 'ibkr')).toBe(true);
    for (const width of [320, 375, 768, 1180]) {
      await page.setViewport({ width, height: 900 });
      expect(await page.$eval('#optionRollsPanel', el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.setViewport({ width: 375, height: 900 }); await page.click('#rollExpand');
    await page.screenshot({ path: '/tmp/live-option-relationships-mobile.png', fullPage: true });
    await page.click('#optionOpenTab'); expect(await page.$eval('#optionRollsPanel', el => el.classList.contains('hidden'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 30_000);
