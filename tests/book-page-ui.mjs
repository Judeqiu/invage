// Fixture browser regression for the read-only Book page.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const accounts = [
  { id: '1', kind: 'cash', channel: 'ibkr', currency: 'USD', external_key: '', label: 'Cash IBKR/USD',
    balance_minor: '1250000000', quantity: '0.0000000000', instrument: null, category: null,
    updated_at: '2026-10-06T09:00:00Z' },
  { id: '2', kind: 'position', channel: 'ibkr', currency: 'SGD', external_key: 'D05@ibkr', label: 'D05@ibkr',
    balance_minor: '60000000', quantity: '2.0000000000', instrument: 'equity', category: null,
    updated_at: '2026-10-06T09:02:00Z' },
  { id: '3', kind: 'equity', channel: '', currency: 'SGD', external_key: 'import', label: 'Import equity',
    balance_minor: '-60000000', quantity: '0.0000000000', instrument: null, category: null,
    updated_at: '2026-10-06T09:02:00Z' },
];
const entries = [
  { id: 'new', booked_at: '2026-10-06T09:02:00Z', value_date: '2026-10-06', entry_type: 'trade_import',
    external_ref: 'broker:ibkr:example', memo: 'Broker snapshot: open D05', created_by: 'demo',
    tool_name: 'broker_sync', request_id: 'book-demo-position', lines: [
      { entry_id: 'new', kind: 'position', channel: 'ibkr', currency: 'SGD', external_key: 'D05@ibkr',
        label: 'D05@ibkr', amount_minor: '60000000', quantity: '2.0000000000', unit_cost_minor: '30000000' },
      { entry_id: 'new', kind: 'equity', channel: '', currency: 'SGD', external_key: 'import',
        label: 'Import equity', amount_minor: '-60000000', quantity: null, unit_cost_minor: null },
    ] },
  { id: 'old', booked_at: '2026-10-06T09:00:00Z', value_date: '2026-10-06', entry_type: 'opening_balance',
    external_ref: null, memo: 'Broker cash snapshot', created_by: 'demo', tool_name: 'broker_sync',
    request_id: 'book-demo-cash', lines: [
      { entry_id: 'old', kind: 'cash', channel: 'ibkr', currency: 'USD', external_key: '',
        label: 'Cash IBKR/USD', amount_minor: '1250000000', quantity: null, unit_cost_minor: null },
      { entry_id: 'old', kind: 'equity', channel: '', currency: 'USD', external_key: 'opening',
        label: 'Opening equity', amount_minor: '-1250000000', quantity: null, unit_cost_minor: null },
    ] },
];

const files = new Map([
  ['/book/', 'webui/book/index.html'], ['/book/app.js', 'webui/book/app.js'],
  ['/book/page.css', 'webui/book/page.css'], ['/report.js', 'webui/report.js'],
  ['/report.css', 'webui/report.css'],
]);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/domain/invage/book') {
      const channel = url.searchParams.get('channel');
      const currency = url.searchParams.get('currency');
      const type = url.searchParams.get('type');
      const matches = entries.filter(entry =>
        (!type || entry.entry_type === type) &&
        (!currency || entry.lines.some(line => line.currency === currency)) &&
        (channel === null || entry.lines.some(line => line.channel === channel)));
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 25);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ summary: { journal_count: 2, active_accounts: 3,
        latest_booked_at: '2026-10-06T09:02:00Z' }, accounts,
        options: { channels: ['', 'ibkr'], currencies: ['SGD', 'USD'],
          entry_types: ['opening_balance', 'trade_import'] },
        updates: [{ created_at: '2026-10-06T09:03:00Z', request_id: 'portfolio-save-demo',
          revision: 7, journals: 0 }],
        journal: { total: matches.length, offset, limit, entries: matches.slice(offset, offset + limit) } }));
      return;
    }
    const file = files.get(url.pathname);
    if (!file) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  const chrome = process.env.CHROME_PATH ??
    ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  if (!chrome) throw new Error('No Chrome binary found');
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith('http://127.0.0.1:') ? request.continue() : request.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/book/`);
  await page.waitForFunction(() => document.getElementById('journal-count').textContent.includes('2 matching'));
  assert((await page.$eval('#accounts', el => el.textContent)).includes('D05@ibkr'));
  assert((await page.$eval('#updates', el => el.textContent)).includes('portfolio-save-demo'));
  assert.equal(await page.$$eval('.book-entry', nodes => nodes.length), 2);
  await page.click('.book-entry summary');
  assert((await page.$eval('.book-entry-body', el => el.textContent)).includes('60.00'));
  await page.screenshot({ path: '/tmp/velovest-book-preview.png', fullPage: true });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/velovest-book-mobile-preview.png', fullPage: true });
  await page.select('#currency', 'SGD');
  await page.click('.book-apply');
  await page.waitForFunction(() => document.getElementById('journal-count').textContent.includes('1 matching'));
  assert.equal(await page.$$eval('.book-entry', nodes => nodes.length), 1);
  assert.deepEqual(errors, []);
  console.log('Book page browser regression passed; preview: /tmp/velovest-book-preview.png');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
