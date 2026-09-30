// Local fixture browser regression for restyled report pages.
// Run: CHROME_PATH=/usr/bin/chromium node tests/report-pages-ui.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const chrome =
  process.env.CHROME_PATH ??
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find(
    (p) => existsSync(p),
  );
if (!chrome) throw new Error('CHROME_PATH not set and no Chrome binary found');

const payload = {
  slug: 'demo',
  displayName: 'Demo',
  generatedAt: '2026-09-16T12:00:00.000Z',
  empty: false,
  productProfile: 'consultant',
  productName: 'Victor Consultant',
  equityPrices: { AAPL: 150 },
  connectionMetrics: { ibkr: { currency: 'USD', buying_power: 20000 } },
  warnings: [],
  model: {
    live: {
      positions: [
        {
          ticker: 'AAPL',
          label: 'AAPL',
          units: 100,
          avgCost: 100,
          price: 150,
          cost: 10000,
          value: 15000,
          pl: 5000,
          plPct: 50,
          weightPct: 60,
          instrument: 'equity',
          channel: 'ibkr',
          premiumAbsolute: 0,
          contingentCashObligation: 0,
          contingentShareObligation: 0,
          category: 'us',
        },
        {
          ticker: 'BABA',
          label: 'BABA',
          units: 20,
          avgCost: 80,
          price: 90,
          cost: 1600,
          value: 1800,
          pl: 200,
          plPct: 12.5,
          weightPct: 7,
          instrument: 'equity',
          channel: 'moomoo',
          premiumAbsolute: 0,
          contingentCashObligation: 0,
          contingentShareObligation: 0,
          category: 'us',
        },
        {
          ticker: 'AAPL  260918P00140000',
          label: 'AAPL 19-SEP-26 140 Put',
          units: 1,
          avgCost: 500,
          price: 300,
          brokerMark: 200,
          cost: -500,
          value: -300,
          pl: 200,
          plPct: 40,
          weightPct: 1,
          instrument: 'option',
          channel: 'ibkr',
          premiumAbsolute: 500,
          contingentCashObligation: 14000,
          contingentShareObligation: 0,
          category: 'us',
          option: {
            right: 'put',
            side: 'short',
            strike: 140,
            expiry: '2026-09-18',
            multiplier: 100,
            underlying: 'AAPL',
            settlement: 'physical',
            mark: 200,
          },
        },
        {
          ticker: 'AAPL  261016P00160000',
          label: 'AAPL 16-OCT-26 160 Put',
          units: 1,
          avgCost: 1700,
          price: 1500,
          brokerMark: 1500,
          cost: -1700,
          value: -1500,
          pl: 200,
          instrument: 'option',
          channel: 'ibkr',
          premiumAbsolute: 1700,
          contingentCashObligation: 16000,
          contingentShareObligation: 0,
          option: {
            right: 'put', side: 'short', strike: 160, expiry: '2026-10-16',
            multiplier: 100, underlying: 'AAPL', settlement: 'physical', mark: 1500,
          },
        },
      ],
      totalValue: 25000,
      totalCost: 10500,
      totalPL: 14500,
      totalPLPct: 138,
      positionCount: 2,
      equityValue: 15000,
      equityCount: 1,
      optionCount: 1,
      fundCount: 0,
      cashAmount: 5000,
      cashCurrency: 'USD',
      cashChannel: 'ibkr',
      positionsValue: 14800,
      cashWeightPct: 20,
      optionsPremiumCollected: 500,
      optionsPremiumPaid: 0,
      contingentCashObligation: 14000,
      contingentShareObligation: 0,
      deposits: [],
      depositsAmount: 0,
      depositCount: 0,
      channels: ['ibkr', 'moomoo'],
      byChannel: [
        {
          channel: 'ibkr',
          positionCount: 2,
          equityCount: 1,
          optionCount: 1,
          fundCount: 0,
          positionsValue: 14800,
          totalCost: 10500,
          totalPL: 4300,
          totalPLPct: 41,
          cashAmount: 5000,
          cashCurrency: 'USD',
          depositsAmount: 0,
          depositCount: 0,
          totalValue: 19800,
          cashWeightPct: 25,
          equityValue: 15000,
          equityCost: 10000,
          optionsPremiumCollected: 500,
          optionsPremiumPaid: 0,
          contingentCashObligation: 14000,
          contingentShareObligation: 0,
        },
        {
          channel: 'moomoo',
          positionCount: 1,
          equityCount: 1,
          optionCount: 0,
          fundCount: 0,
          positionsValue: 1800,
          totalCost: 1600,
          totalPL: 200,
          totalPLPct: 12.5,
          cashAmount: null,
          cashCurrency: null,
          depositsAmount: 0,
          depositCount: 0,
          totalValue: 1800,
          cashWeightPct: null,
          equityValue: 1800,
          equityCost: 1600,
          optionsPremiumCollected: 0,
          optionsPremiumPaid: 0,
          contingentCashObligation: 0,
          contingentShareObligation: 0,
        },
      ],
      issues: [],
    },
    history: [],
    periodChange: null,
    lastSnapshot: null,
  },
};

const files = new Map([
  ['/dashboard/', 'webui/dashboard/index.html'],
  ['/dashboard/index.html', 'webui/dashboard/index.html'],
  ['/dashboard/app.js', 'webui/dashboard/app.js'],
  ['/dashboard/page.css', 'webui/dashboard/page.css'],
  ['/positions/', 'webui/positions/index.html'],
  ['/positions/app.js', 'webui/positions/app.js'],
  ['/insights/', 'webui/insights/index.html'],
  ['/insights/app.js', 'webui/insights/app.js'],
  ['/report.js', 'webui/report.js'],
  ['/report.css', 'webui/report.css'],
]);

const server = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/api/domain/invage/dashboard') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
      return;
    }
    const file = files.get(url);
    if (!file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html';
    res.setHeader('Content-Type', type);
    res.end(await readFile(file));
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(`http://127.0.0.1:${port}`) || u.includes('cdn.jsdelivr.net') || u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) {
      req.continue();
    } else {
      req.abort();
    }
  });

  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('navValue')?.textContent?.includes('$'));
  const dashText = await page.evaluate(() => document.body.innerText);
  assert(/Portfolio snapshot/i.test(dashText), 'dashboard h1');
  assert(/Premium\s*·\s*open/i.test(dashText), 'premium kpi');
  assert(/Open options positions · broker view/i.test(dashText), 'open options section');
  assert(/Assignment exposure/i.test(dashText), 'assignment exposure column');
  assert(/Cst bss \(premium received\)/i.test(dashText), 'premium column');
  assert(/% of max/i.test(dashText), 'premium capture column');
  assert(/Prob\. ITM/i.test(dashText), 'risk probability column');
  assert(await page.$('#expiryTable .risk-row'), 'scored risk contract');
  assert(/\$16,000/.test(await page.$eval('#expiryRow', (node) => node.textContent)), 'radar exposure uses scored contracts');
  await page.click('#expiryTable [data-risk-right="call"]');
  assert(!(await page.$('#expiryTable .risk-row')), 'risk right filter hides puts');
  await page.click('#expiryTable [data-risk-right="all"]');
  await page.click('#expiryTable .risk-row');
  assert(await page.$('#openOptions .option-underlying-highlight'), 'risk row highlights same underlying in Section 03');
  assert(await page.$('#openOptions .option-month-total'), 'expiry month total row');
  assert(await page.$('#openOptions .option-ledger-row'), 'option contract row');
  const optionCells = await page.$$eval('#openOptions .option-ledger-row td', (cells) => cells.map((cell) => cell.textContent.trim()));
  assert.equal(optionCells[1], '-1', 'short position is signed');
  assert.equal(optionCells[5], '$500.00', 'average premium is per contract');
  assert.equal(optionCells[6], '$200.00', 'broker mark per contract wins over live option price');
  assert.equal(optionCells[7], '-$200.00', 'market value uses broker mark');
  assert.equal(optionCells[8], '$300.00', 'P&L uses broker mark');
  await page.click('#openOptions [data-option-right="call"]');
  assert(!(await page.$('#openOptions .option-ledger-row')), 'right filter removes put row');
  await page.click('#openOptions [data-option-right="all"]');
  await page.click('#openOptions [data-option-month="2026-09"]');
  assert(!(await page.$eval('#openOptions', (node) => node.textContent.includes('AAPL SHORT PUT $140 2026-09-18'))), 'month row collapses');
  await page.click('#openOptions [data-option-month="2026-09"]');
  assert(await page.$eval('#openOptions', (node) => node.textContent.includes('AAPL SHORT PUT $140 2026-09-18')), 'month row expands');
  for (const label of ['Allocation', 'Performance by position', 'Performance over time', 'Key insights', 'Channel details', 'Holdings detail', 'Fixed deposits', 'Methodology']) {
    assert(!(await page.$(`section[aria-label="${label}"]`)), `${label} section removed`);
  }
  assert(await page.$('#channelPills [data-channel="moomoo"]'), 'dashboard moomoo chip');
  await page.click('#channelPills [data-channel="moomoo"]');
  await page.waitForFunction(() => /moomoo desk/i.test(document.getElementById('deskEyebrow')?.textContent || ''));
  assert(!dashText.includes('#0d1117'), 'no github hex in text');
  const css = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(css !== 'rgb(13, 17, 23)', `body not github dark, got ${css}`);

  await page.goto(`http://127.0.0.1:${port}/positions/`);
  await page.waitForFunction(() => document.getElementById('hello')?.textContent?.includes('Shares you own'));
  const posText = await page.evaluate(() => document.body.innerText);
  assert(posText.includes('Assignment obligations'), posText.slice(0, 400));
  assert(!posText.includes('Watchlist'), 'watchlist removed from positions');
  assert(await page.$('#filters [data-channel="moomoo"]'), 'positions broker chips');
  await page.click('#filters [data-channel="moomoo"]');
  await page.waitForFunction(() => /BABA/.test(document.body.innerText) && !/AAPL 19-SEP/.test(document.body.innerText));

  await page.goto(`http://127.0.0.1:${port}/insights/`);
  await page.waitForFunction(() => document.getElementById('hello')?.textContent?.includes('Where the book stands'));
  const ins = await page.evaluate(() => document.body.innerText);
  assert(ins.includes('Book statistics'), ins.slice(0, 500));
  assert(!ins.includes('Your personal edge'), ins.slice(0, 500));
  assert(!ins.includes('Hello, Demo'), 'no Hello H1');
  assert(await page.$('#filters [data-channel="ibkr"]'), 'insights broker chips');
  await page.click('#filters [data-channel="ibkr"]');
  await page.waitForFunction(() => /ibkr/i.test(document.getElementById('summary')?.textContent || ''));

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('Report pages browser regression passed');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
