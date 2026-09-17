// Local fixture-only browser regression. Run: node --import tsx tests/execution-journal-ui.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { buildExecutionJournal } from '../src/brokers/option-executions.ts';

const journal = buildExecutionJournal([{
  channel: 'ibkr', account_id: 'DEMO', execution_id: 'example-1', contract_id: '123', executed_at: '2026-09-09T10:30:15',
  underlying: 'PATH', right: 'call', expiry: '2027-03-19', strike: '20', multiplier: '100', contracts: '2',
  side: 'sell', effect: 'open', currency: 'USD', gross_premium: '5140.00', commission: '-1.23456789',
}]);
const files = new Map([
  ['/trades/', 'webui/trades/index.html'], ['/trades/app.js', 'webui/trades/app.js'],
  ['/report.js', 'webui/report.js'], ['/report.css', 'webui/report.css'],
]);
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/domain/invage/trades') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(journal)); return;
    }
    if (req.url === '/api/domain/invage/dashboard') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ empty: true, model: null, message: 'No open positions.' })); return;
    }
    const file = files.get(req.url);
    if (!file) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(file));
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith('http://127.0.0.1:') ? req.continue() : req.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/trades/`);
  await page.waitForFunction(() => document.getElementById('table').textContent.includes('5138.76543211'));
  const text = await page.$eval('#table', el => el.textContent);
  for (const value of ['2026-09-09 10:30:15', '19-MAR-2027', '-1.23456789', 'sell to open', '5140.00']) assert(text.includes(value), value);
  assert.equal(await page.$eval('details', el => el.open), false);
  await page.screenshot({ path: '/private/tmp/invage-execution-journal.png', fullPage: true });
  await page.click('#positions-view');
  await page.waitForFunction(() => document.getElementById('table').textContent.includes('No open positions.'));
  await page.click('#journal-view');
  await page.waitForFunction(() => document.getElementById('table').textContent.includes('5138.76543211'));
  assert.deepEqual(errors, []);
  console.log('Journal browser regression passed; screenshot: /private/tmp/invage-execution-journal.png');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
