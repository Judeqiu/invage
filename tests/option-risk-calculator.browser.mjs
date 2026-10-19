import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { fixture, symbol } from './helpers/option-index-fixture.mjs';

it('takes only a contract, fetches an index, handles hidden/error states and discards stale responses', async () => {
  const data = await mkdtemp(join(tmpdir(), 'velovest-index-browser-'));
  process.env.UTARUS_LOADED_BY_HOST = '1'; process.env.UTARUS_DATA_ROOT = data;
  const { generateOptionIndex } = await import('../src/risk/option-index.ts');
  const result = await generateOptionIndex({ contract: symbol }, fixture().deps);
  const root = resolve('webui'); let enabled = true, fail = false, hold = false, posts = [], waiting = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.includes('/api/domain/invage/option-index')) {
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname.endsWith('/capabilities')) return res.end(JSON.stringify({ enabled }));
        let raw = ''; for await (const chunk of req) raw += chunk;
        posts.push(JSON.parse(raw));
        if (hold) await new Promise(resolve => waiting.push(resolve));
        if (fail) { res.writeHead(503); return res.end(JSON.stringify({ error: 'Market-data lookup unavailable. No index was calculated.' })); }
        return res.end(JSON.stringify(result));
      }
      const file = resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      const bytes = await readFile(file);
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
      res.end(bytes);
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/option-risk/index.html`);
    await page.waitForSelector('#lookup:not([hidden])');
    assert.equal(await page.$$eval('input', rows => rows.length), 1);
    await page.type('#contract', symbol); await page.click('#run');
    await page.waitForSelector('#output:not([hidden])');
    assert.deepEqual(posts[0], { contract: symbol });
    assert.equal(await page.$$eval('#scores .score', rows => rows.length), 2);
    assert.match(await page.$eval('#scores', e => e.textContent), /Buyer/);
    assert.match(await page.$eval('#scores', e => e.textContent), /Seller/);
    assert.equal(await page.$$eval('#scenarios tr', rows => rows.length), 15);
    await page.screenshot({ path: '/tmp/velovest-option-index-desktop.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/velovest-option-index-mobile.png', fullPage: true });
    fail = true; await page.click('#run');
    await page.waitForSelector('#error:not([hidden])');
    assert.equal(await page.$eval('#output', e => e.hidden), true);
    assert.match(await page.$eval('#error', e => e.textContent), /No index/);
    fail = false; hold = true; await page.click('#run');
    while (!waiting.length) await new Promise(resolve => setTimeout(resolve, 10));
    await page.type('#contract', 'X');
    hold = false; waiting.splice(0).forEach(resolve => resolve());
    assert.equal(await page.$eval('#output', e => e.hidden), true);
    enabled = false; await page.reload();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('hidden in Management'));
    assert.equal(await page.$eval('#lookup', e => e.hidden), true);
    assert.equal(posts.length, 3);
    assert.deepEqual(errors, []);
  } finally {
    waiting.splice(0).forEach(resolve => resolve());
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(data, { recursive: true, force: true });
  }
});
