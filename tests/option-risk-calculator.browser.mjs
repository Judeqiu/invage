import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

it('calculates, invalidates stale results and renders on mobile without browser errors', async () => {
  const root = resolve('webui');
  const server = createServer(async (req, res) => {
    try {
      const file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      const data = await readFile(file);
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}/option-risk/index.html`);
    assert.equal(await page.$eval('#output', e => e.hidden), true);
    await page.click('#example');
    await page.click('button[type=submit]');
    await page.waitForSelector('#output:not([hidden])');
    assert.match(await page.$eval('#score', e => e.textContent), /^\d+\.\d+%$/);
    assert.equal(await page.$$eval('#scenarios tr', rows => rows.length), 15);
    assert.match(await page.$eval('#warnings', e => e.textContent), /9,500\.00 USD/);
    assert.match(await page.$eval('#warnings', e => e.textContent), /Expected Shortfall: unavailable/);
    await page.screenshot({ path: '/tmp/velovest-option-risk-desktop.png', fullPage: true });
    await page.select('[name=right]', 'call');
    assert.equal(await page.$eval('#output', e => e.hidden), true);
    await page.click('button[type=submit]');
    assert.equal(await page.$eval('#maximum', e => e.textContent), 'Unbounded');
    assert.match(await page.$eval('#warnings', e => e.textContent), /loss is unbounded/);
    await page.select('[name=side]', 'long');
    await page.$eval('[name=symbol]', e => { e.value = '<img src=x onerror=alert(1)>'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('button[type=submit]');
    assert.equal(await page.$eval('#maximum', e => e.textContent), '136.00 USD');
    assert.equal(await page.$$eval('#interpretation img', e => e.length), 0);
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: '/tmp/velovest-option-risk-mobile.png', fullPage: true });
    await page.$eval('[name=equity]', e => { e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('button[type=submit]');
    assert.equal(await page.$eval('#output', e => e.hidden), true);
    assert.equal(await page.$eval('[name=equity]', e => e.validity.valid), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
