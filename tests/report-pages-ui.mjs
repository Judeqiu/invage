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
  brokerAsOf: { ibkr: '2026-09-16', moomoo: '2026-09-15' },
  premiumSupportedChannels: ['ibkr'],
  dashboardConfig: { showTotalPremium: true, showRecordedPnlByMonth: true },
  premiumJournal: { available: true, channels: ['ibkr'], daily: [
    { channel: 'ibkr', account_id: 'U1', date: '2026-09-16', currency: 'USD', gross_premium: '101', net_premium: '100' },
    { channel: 'ibkr', account_id: 'U1', date: '2026-09-09', currency: 'USD', gross_premium: '201', net_premium: '200' },
    { channel: 'ibkr', account_id: 'U1', date: '2026-08-09', currency: 'USD', gross_premium: '401', net_premium: '400' },
    { channel: 'ibkr', account_id: 'U1', date: '2026-08-10', currency: 'USD', gross_premium: '-49', net_premium: '-50' },
    { channel: 'ibkr', account_id: 'U1', date: '2026-10-09', currency: 'USD', gross_premium: '901', net_premium: '900' },
  ] },
  optionAnalytics: { executions: [
    { channel: 'ibkr', account_id: 'U1', underlying: 'AAPL', executed_at: '2026-08-09T10:00:00', gross_premium: '401', commission: '-1', currency: 'USD' },
    { channel: 'ibkr', account_id: 'U1', underlying: 'AAPL', executed_at: '2026-08-10T10:00:00', gross_premium: '-49', commission: null, currency: 'USD' },
    { channel: 'ibkr', account_id: 'U1', underlying: 'AAPL', executed_at: '2026-09-09T10:00:00', gross_premium: '201', commission: '-1', currency: 'USD' },
    { channel: 'ibkr', account_id: 'U1', underlying: 'AAPL', executed_at: '2026-09-16T10:00:00', gross_premium: '101', commission: null, currency: 'USD' },
  ], profits: [{ channel: 'ibkr', underlying: 'AAPL', date: '2026-08-10', currency: 'USD', gross: 352, net: null }], gaps: [] },
  optionTradeDetails: {
    'AAPL  260918P00140000': { openedFrom: '2026-09-09', openedTo: '2026-09-09', stoNetPremium: 499, stoGrossPremium: 500, entrySpot: { price: 150.25, date: '2026-09-09', basis: 'adjusted_close' }, currency: 'USD' },
    'AAPL  261016P00160000': { openedFrom: '2026-09-16', openedTo: '2026-09-16', stoNetPremium: 1699, stoGrossPremium: 1700, rollPremium: 900, rollDate: '2026-09-16', currency: 'USD' },
  },
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
          currency: 'USD',
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
          currency: 'USD',
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
  ['/trades/', 'webui/trades/index.html'],
  ['/trades/app.js', 'webui/trades/app.js'],
  ['/dashboard/', 'webui/dashboard/index.html'],
  ['/dashboard/index.html', 'webui/dashboard/index.html'],
  ['/dashboard/app.js', 'webui/dashboard/app.js'],
  ['/dashboard/option-timeline.js', 'webui/dashboard/option-timeline.js'],
  ['/dashboard/page.css', 'webui/dashboard/page.css'],
  ['/positions/', 'webui/positions/index.html'],
  ['/positions/app.js', 'webui/positions/app.js'],
  ['/insights/', 'webui/insights/index.html'],
  ['/insights/app.js', 'webui/insights/app.js'],
  ['/report.js', 'webui/report.js'],
  ['/report.css', 'webui/report.css'],
]);

const discussionRequests = [];
let discussionFailure = false;
let cachedSnapshot = null;
let dashboardRequests = 0;
const server = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/api/domain/invage/dashboard-cache') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(cachedSnapshot));
      return;
    }
    if (url === '/api/domain/invage/trades') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ available: true, executions: [], daily: [], coverage: [] }));
      return;
    }
    if (url === '/api/domain/invage/dashboard') dashboardRequests++;

    if (url === '/discussion-shell') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<iframe title="Dashboard" src="/dashboard/" style="width:100%;height:900px;border:0"></iframe><script>
        window.panelMessages = [];
        addEventListener('message', event => {
          if (event.origin === location.origin && event.source === document.querySelector('iframe').contentWindow)
            panelMessages.push(event.data);
        });
      </script>`);
      return;
    }
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<h1>Focused option chat</h1>');
      return;
    }
    if (url === '/api/chat/messages' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      discussionRequests.push(JSON.parse(raw));
      await new Promise(resolve => setTimeout(resolve, 150));
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = discussionFailure ? 503 : 200;
      res.end(JSON.stringify(discussionFailure
        ? { message: 'Chat is temporarily unavailable.' }
        : { kind: 'run', conversationId: 'option-chat-123', messageId: 'run-123' }));
      return;
    }
    if (url === '/api/domain/invage/dashboard') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
      return;
    }
    if (url === '/api/domain/invage/option-open-close') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ underlying: 'AAPL', date: '2026-09-09', adjusted_close: 150.25 }));
      return;
    }
    if (url === '/api/domain/invage/option-history') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        episodes: [{ id: 'past-option', broker_id: 'ibkr', connection_id: 'ibkr', channel: 'ibkr',
          account_id: 'U1', contract: { underlying: 'MSFT', side: 'short', right: 'call',
            strike: 400, expiry: '2026-08-21', units: 1, mark: 50, currency: 'USD' },
          first_seen: '2026-08-19', last_seen_open: '2026-08-20', first_seen_absent: '2026-08-24',
          status: 'no_longer_observed', observations: [{ as_of: '2026-08-20', observed_at: '2026-08-21T01:00:00Z',
            source: 'broker', units: 1, avg_price: 100, mark: 50 }], executions: [] },
          { id: 'matched-option', broker_id: 'ibkr', connection_id: 'ibkr', channel: 'ibkr',
            account_id: 'U1', contract: { underlying: 'META', side: 'short', right: 'put',
              strike: 605, expiry: '2026-10-09', units: 1, mark: 18.01, currency: 'USD' },
            first_seen: '2026-09-30', last_seen_open: '2026-09-30', first_seen_absent: '2026-10-01',
            status: 'closed_by_fills', matched_trade_pl: { amount: '297.919641', currency: 'USD',
              opened: '1', closed: '1', fees: '-2.080359' },
            observations: [{ as_of: '2026-09-30', observed_at: '2026-10-01T01:00:00Z',
              source: 'broker', units: 1, avg_price: 315, mark: 18.01 }],
            executions: [{ executed_at: '2026-09-18T09:33:53', side: 'sell', effect: 'open',
              contracts: '1', gross_premium: '315', commission: '-1.040079', currency: 'USD' },
              { executed_at: '2026-10-01T09:54:28', side: 'buy', effect: 'close', contracts: '1',
                gross_premium: '-15', commission: '-1.04028', currency: 'USD' }] },
          { id: 'expired-option', broker_id: 'ibkr', connection_id: 'ibkr', channel: 'ibkr',
            account_id: 'U1', contract: { underlying: 'AAPL', side: 'short', right: 'put',
              strike: 150, expiry: '2026-10-09', units: 1, mark: 0, currency: 'USD' },
            first_seen: '2026-10-08', last_seen_open: '2026-10-08', first_seen_absent: '2026-10-10',
            status: 'expired', broker_event_pl: { amount: '298.50', currency: 'USD' },
            observations: [{ as_of: '2026-10-08', observed_at: '2026-10-08T12:00:00Z',
              source: 'broker', units: 1, avg_price: 300, mark: 0 }], executions: [],
            events: [{ id: 'e1', date: '2026-10-09', kind: 'expiration', settlement: 'unknown',
              contracts: '1', currency: 'USD', broker_realized_pl: '298.50' }] },
          { id: 'webull-option', broker_id: 'webull', connection_id: 'webull', channel: 'webull',
            account_id: 'W1', contract: { underlying: 'WEBULL', side: 'short', right: 'put',
              strike: 10, expiry: '2026-10-09', units: 1, mark: 2, currency: 'USD' },
            first_seen: '2026-09-30', last_seen_open: '2026-09-30', first_seen_absent: '2026-10-01',
            status: 'no_longer_observed', observations: [], executions: [] }],
        total: 4, next_offset: null, history_started: true,
        connections: [{ id: 'ibkr', broker_id: 'ibkr', channel: 'ibkr', label: 'IBKR', account_id: 'U1',
          schedule: 'daily', position_as_of: '2026-09-15', last_success_at: '2026-09-16T01:00:00Z',
          last_attempt: { ok: true, at: '2026-09-16T01:00:00Z' } },
          { id: 'webull', broker_id: 'webull', channel: 'webull', label: 'Webull', account_id: 'W1',
            schedule: 'daily', position_as_of: '2026-09-30', last_success_at: '2026-10-01T01:00:00Z',
            last_attempt: { ok: true, at: '2026-10-01T01:00:00Z' } }],
      }));
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
  // Help must work on static and dynamically rendered cards, without clipping.
  const helpButtons = await page.$$('.help-dot[data-help]');
  assert(helpButtons.length >= 10, 'dashboard help buttons are available');
  for (const button of helpButtons) {
    await button.hover();
    await page.waitForSelector('#reportHelpTooltip:not([hidden])');
    assert.equal(await page.$eval('#reportHelpTooltip', node => node.textContent),
      await button.evaluate(node => node.dataset.help));
    assert.equal(await button.evaluate(node => node.getAttribute('aria-describedby')), 'reportHelpTooltip');
    const fits = await page.$eval('#reportHelpTooltip', node => {
      const b = node.getBoundingClientRect();
      return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
    });
    assert(fits, 'help bubble stays inside the viewport');
    await page.keyboard.press('Escape');
    assert(await page.$eval('#reportHelpTooltip', node => node.hidden));
  }
  await page.$eval('.help-dot[data-help]', node => node.focus());
  await page.waitForSelector('#reportHelpTooltip:not([hidden])');
  await page.screenshot({ path: '/tmp/velovest-help-tooltip.png' });
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 375, height: 700 });
  await page.click('.help-dot[data-help]');
  await page.waitForSelector('#reportHelpTooltip:not([hidden])');
  assert(await page.$eval('#reportHelpTooltip', node => node.getBoundingClientRect().right <= innerWidth));
  await page.click('#heroDate');
  assert(await page.$eval('#reportHelpTooltip', node => node.hidden));
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const dashText = await page.evaluate(() => document.body.innerText);
  assert(/Portfolio snapshot/i.test(dashText), 'dashboard h1');
  const heroLead = await page.$eval('#heroLead', node => node.textContent);
  assert(/2 positions — 1 equity, 1 option, 0 fund/.test(heroLead), `hero position count includes open options: ${heroLead}`);
  assert(/Net premium\s*·\s*Daily/i.test(dashText), 'daily premium kpi');
  assert(/Net premium\s*·\s*MTD/i.test(dashText), 'MTD premium kpi');
  assert(/Max assignment obligation/i.test(dashText), 'cash-after-assignment kpi');
  assert(/Net asset value/i.test(dashText), 'NAV hero card');
  assert(/Open options positions · broker view/i.test(dashText), 'open options section');
  assert(/Assignment exposure/i.test(dashText), 'assignment exposure column');
  assert(/STO Credit ·\s+Before Fees/i.test(dashText), 'STO credit column');
  assert(/Opened/i.test(dashText), 'opening date column');
  assert(/% of max/i.test(dashText), 'premium capture column');
  assert(/Prob\. ITM/i.test(dashText), 'risk probability column');
  assert(/Recorded P&L by Month/.test(dashText), 'realized monthly chart label');
  assert(/Known fees only/.test(dashText), 'unreported fees remain visible');
  assert.equal(await page.$eval('[data-pnl-month="2026-08"] td:nth-child(2)', node => node.textContent), '$352.00', 'P&L uses closing month, not expiry');
  assert.equal(await page.$('#premiumEngine .monthly-values'), null, 'old unlabelled result list removed');
  assert(!/Trade coverage/.test(dashText), 'coverage is a compact note, not a separate card');
  assert(/P&L \(USD\)/.test(await page.$eval('.pnl-card svg', node => node.textContent)), 'chart labels its value axis');
  assert.equal(await page.$eval('#expiryTable .risk-row td:nth-child(9)', node => node.textContent.trim()), '$900.00Latest roll · Before fees', 'radar uses latest roll cash, not opening basis');
  assert(/Partial history/.test(await page.$eval('#kpiRow', node => node.textContent)), 'merged premium does not silently omit moomoo');
  assert(/Partial history/.test(await page.$eval('#totalPremiumMeta', node => node.textContent)), 'total does not silently omit unsupported brokers');
  await page.click('#channelPills [data-channel="ibkr"]');
  assert.equal(await page.$eval('#totalPremiumValue', node => node.textContent), '$654.00', 'total includes older opens and closing debits, excludes future fills');
  await page.screenshot({ path: '/tmp/velovest-dashboard-desktop.png', fullPage: true });
  const metricBoxes = await page.$$eval('.hero-metrics .nav-card', nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right }; }));
  assert.equal(metricBoxes[0].y, metricBoxes[1].y, 'premium sits beside NAV on desktop');
  assert(metricBoxes[1].x >= metricBoxes[0].right, 'hero cards do not overlap');
  payload.dashboardConfig.showTotalPremium = false;
  payload.dashboardConfig.showRecordedPnlByMonth = false;
  await page.reload();
  await page.waitForFunction(() => document.getElementById('totalPremiumCard').classList.contains('hidden'));
  await page.waitForFunction(() => document.getElementById('premiumHead').textContent.includes('Option premium'));
  assert.equal(await page.$('#premiumEngine .pnl-card'), null, 'monthly P&L is hidden when disabled');
  assert(/Option premium/.test(await page.$eval('#premiumHead', node => node.textContent)), 'section heading reflects disabled P&L');
  assert(/Net Option Premium by Month/.test(await page.$eval('#premiumEngine', node => node.textContent)), 'premium charts remain visible');
  delete payload.dashboardConfig.showRecordedPnlByMonth;
  await page.reload();
  await page.waitForSelector('#premiumEngine .metric-card');
  assert.equal(await page.$('#premiumEngine .pnl-card'), null, 'monthly P&L defaults to hidden without configuration');
  payload.dashboardConfig.showTotalPremium = true;
  payload.dashboardConfig.showRecordedPnlByMonth = true;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('totalPremiumCard').classList.contains('hidden'));
  await page.waitForSelector('#premiumEngine .pnl-card');
  assert(/\$101/.test(await page.$eval('#kpiRow', node => node.textContent)), 'IBKR daily premium uses recorded fills');
  assert(/\$302/.test(await page.$eval('#kpiRow', node => node.textContent)), 'IBKR MTD premium uses recorded fills');
  await page.click('#channelPills [data-channel="merged"]');
  assert(await page.$('#expiryTable .risk-row'), 'scored risk contract');
  assert(/\$16,000/.test(await page.$eval('#expiryRow', (node) => node.textContent)), 'radar exposure uses scored contracts');
  assert.equal(await page.$$eval('#expiryTable .risk-row', (rows) => rows.length), 1, 'radar keeps only contracts above threshold');
  await page.type('#riskSearch', 'TSLA');
  await page.waitForFunction(() => !document.querySelector('#expiryTable .risk-row'));
  await page.$eval('#riskSearch', input => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('#expiryTable .risk-row');
  await page.click('#expiryTable [data-risk-right="call"]');
  assert(!(await page.$('#expiryTable .risk-row')), 'risk right filter hides puts');
  await page.click('#expiryTable [data-risk-right="all"]');
  await page.click('#expiryTable .risk-row');
  assert(await page.$('#openOptions .option-underlying-highlight'), 'risk row highlights same underlying in Section 03');
  const discussionPage = await browser.newPage();
  discussionPage.on('pageerror', error => errors.push(String(error)));
  await discussionPage.setViewport({ width: 390, height: 844 });
  await discussionPage.goto(`http://127.0.0.1:${port}/discussion-shell`);
  const dashboardFrame = discussionPage.frames().find(frame => frame.url().endsWith('/dashboard/'));
  await dashboardFrame.waitForSelector('[data-option-discuss]');
  assert.equal(await dashboardFrame.$$eval('[data-option-discuss]', buttons => buttons.length), 1, 'each visible option has a discussion action');
  const discussionButtons = await dashboardFrame.$$eval('[data-option-discuss]', buttons => buttons.map(button => ({
    label: button.getAttribute('aria-label'), prompt: button.dataset.optionDiscuss,
  })));
  assert(discussionButtons[0].label.includes('2026-10-16'), 'accessible action identifies exact contract');
  discussionFailure = true;
  await dashboardFrame.focus('[data-option-discuss]');
  await discussionPage.keyboard.press('Enter');
  await dashboardFrame.waitForFunction(() => document.querySelector('[data-option-discuss]')?.textContent === 'Opening…');
  assert(await dashboardFrame.$$eval('[data-option-discuss]', buttons => buttons.every(button => button.disabled)), 'duplicate clicks are disabled during chat launch');
  await dashboardFrame.waitForFunction(() => document.getElementById('optionChatStatus')?.textContent.includes('temporarily unavailable'));
  assert(discussionPage.url().endsWith('/discussion-shell'), 'failed chat leaves dashboard in place');
  assert.equal(await dashboardFrame.$$eval('.option-underlying-highlight', rows => rows.length), 0, 'Discuss does not trigger row highlight');
  assert(await dashboardFrame.$eval('[data-option-discuss]', button => !button.disabled), 'failed chat can be retried');
  await dashboardFrame.$eval('[data-option-discuss]', button => button.scrollIntoView());
  await discussionPage.screenshot({ path: '/tmp/invage-option-discuss-mobile.png' });
  discussionFailure = false;
  await discussionPage.evaluate(() => {
    const failed = window.panelMessages.find(message => message.type === 'utarus:chat-panel:open');
    document.querySelector('iframe').contentWindow.postMessage({ type: 'utarus:chat-panel:retry', requestId: failed.requestId }, location.origin);
  });
  await discussionPage.waitForFunction(() => window.panelMessages.some(message => message.type === 'utarus:chat-panel:ready'));
  assert(discussionPage.url().endsWith('/discussion-shell'), 'discussion keeps dashboard shell in place');
  assert.equal(discussionPage.frames().length, 2, 'dashboard iframe stays mounted');
  const panelMessages = await discussionPage.evaluate(() => window.panelMessages);
  assert(panelMessages.some(message => message.type === 'utarus:chat-panel:open' && message.title.includes('160 PUT')), 'panel gets exact contract header');
  assert(panelMessages.some(message => message.type === 'utarus:chat-panel:error'), 'failed launch reports error to panel');
  assert(panelMessages.at(-1).conversationId === 'option-chat-123', 'panel opens created conversation');
  assert(await dashboardFrame.$eval('[data-option-discuss]', button => button.getAttribute('aria-expanded') === 'true'), 'selected discussion is highlighted');
  const discussion = discussionRequests.at(-1);
  assert.equal(discussion.conversationId, undefined, 'discussion starts a new focused chat');
  assert(discussion.text.includes('AAPL  261016P00160000'), 'chat gets full contract identifier');
  assert(discussion.text.includes('strike 160 USD') && discussion.text.includes('expiry 2026-10-16'), 'chat gets strike, currency and expiry');
  assert(discussion.text.includes('Broker/channel: ibkr') && discussion.text.includes('Quantity: 1 contracts. Multiplier: 100'), 'chat gets broker and position size');
  assert(discussion.text.includes('as of 2026-09-16') && discussion.text.includes('verify the current holding'), 'snapshot date and freshness preserved');
  assert.equal(discussionRequests.length, 2, 'one request per deliberate attempt');
  await discussionPage.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'utarus:chat-panel:closed' }, location.origin));
  await dashboardFrame.waitForFunction(() => document.querySelector('[data-option-discuss]')?.getAttribute('aria-expanded') === 'false');
  await dashboardFrame.click('[data-option-discuss]');
  assert.equal(discussionRequests.length, 2, 'reopening the same option reuses its conversation');
  await discussionPage.setViewport({ width: 1280, height: 844 });
  await dashboardFrame.click('[data-option-discuss]');
  assert.equal(discussionRequests.length, 2, 'resizing preserves discussion association');
  await discussionPage.close();
  const archivedDiscussion = await page.evaluate(() => {
    const position = payload.model.live.positions.find(p => p.instrument === 'option');
    payload.model.history.push({ date: '2026-09-01', brokerAsOf: { ibkr: '2026-08-31' } });
    const prompt = optionDiscussionPrompt(position, { isLive: false, label: '2026-09-01' }, '2026-09-01');
    payload.model.history.pop();
    return prompt;
  });
  assert(archivedDiscussion.includes('historical snapshot as of 2026-09-01'), 'historical discussion preserves selected date');
  assert(archivedDiscussion.includes('Broker positions as of 2026-08-31'), 'historical discussion uses archived broker date');
  assert(await page.$('#openOptions .option-month-total'), 'expiry month total row');
  assert(await page.$('#openOptions .option-ledger-row'), 'option contract row');
  await page.waitForSelector('#dashboard:not(.hidden)');
  await page.click('#optionHistoryTab');
  await page.waitForFunction(() => document.getElementById('optionHistoryTable')?.textContent?.includes('MSFT'));
  assert(/WEBULL/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'merged history includes Webull');
  await page.click('#channelPills [data-channel="ibkr"]');
  await page.waitForFunction(() => document.getElementById('historyBroker')?.value === 'ibkr');
  assert(!/WEBULL/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'IBKR dashboard selection excludes Webull history');
  await page.click('#channelPills [data-channel="merged"]');
  await page.waitForFunction(() => document.getElementById('historyBroker')?.value === '');
  assert(/WEBULL/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'merged dashboard selection restores Webull history');
  assert(/No longer observed/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'historical option status');
  await page.click('#optionHistoryTable [data-history-id]');
  assert(/first observed absent 24-Aug-2026/.test(await page.$eval('#optionHistoryDetail', node => node.textContent)), 'history detail preserves absence date');
  assert(/Closed by fills/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'matched status appears');
  assert(/\$297\.92/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'matched trade P&L appears');
  await page.click('#optionHistoryTable [data-history-id="matched-option"]');
  assert(/297\.919641 USD/.test(await page.$eval('#optionHistoryDetail', node => node.textContent)), 'exact matched trade P&L appears in detail');
  assert(/Expired/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'broker expiry status appears');
  await page.click('#optionHistoryTable [data-history-id="expired-option"]');
  assert(/298\.50 USD/.test(await page.$eval('#optionHistoryDetail', node => node.textContent)), 'broker event P&L appears in detail');
  await page.click('#optionOpenTab');
  await page.click('#channelPills [data-channel="ibkr"]');
  await page.click('#optionHistoryTab');
  await page.waitForFunction(() => document.getElementById('historyBroker')?.value === 'ibkr');
  assert(!/WEBULL/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'IBKR dashboard selection carries into history');
  await page.click('#optionOpenTab');
  const optionCells = await page.$$eval('#openOptions .option-ledger-row td', (cells) => cells.map((cell) => cell.textContent.trim()));
  assert.equal(optionCells[1], '-1', 'short position is signed');
  assert(optionCells[2].includes('09-Sep-2026'), 'opening date uses requested format');
  assert.equal(optionCells[4], '$150.00', 'Current Spot uses the current underlying quote');
  assert.equal(optionCells[7], '$500.00Before fees', 'STO credit comes from matched fills');
  assert.equal(optionCells[8], '$500.00', 'open cost basis remains distinct');
  assert.equal(optionCells[9], '$200.00', 'broker mark per contract wins over live option price');
  assert.equal(optionCells[10], '-$200.00', 'market value uses broker mark');
  assert.equal(optionCells[11], '$300.00', 'P&L uses broker mark');
  assert.equal(await page.$$eval('#openOptions .option-ledger th', cells => cells.length), 14, 'Current Spot column is restored');
  assert(await page.$$eval('#openOptions .option-month-total', rows => rows.every(row => row.children.length === 14)), 'month totals align with columns');
  assert.equal(await page.$eval('#openOptions .option-ledger td:first-child', node => getComputedStyle(node).position), 'sticky', 'contract stays visible on horizontal scroll');
  const ledgerLayout = await page.$eval('#openOptions .table-scroll', async scroll => {
    const header = scroll.querySelector('th:nth-child(8)');
    const labels = header.querySelectorAll('.option-column-label');
    const twoLines = labels.length === 2 && labels[1].getBoundingClientRect().top > labels[0].getBoundingClientRect().top;
    const body = scroll.querySelector('tbody');
    const originalBody = body.innerHTML;
    const originalHeight = scroll.style.maxHeight;
    body.innerHTML = originalBody.repeat(12);
    scroll.style.maxHeight = '180px';
    scroll.scrollTop = 100;
    scroll.scrollLeft = 180;
    await new Promise(resolve => requestAnimationFrame(resolve));
    const top = scroll.getBoundingClientRect().top;
    const result = {
      twoLines,
      scrolled: scroll.scrollTop > 0 && scroll.scrollLeft > 0,
      headerPinned: Math.abs(header.getBoundingClientRect().top - top) < 2,
      cornerPinned: Math.abs(scroll.querySelector('th').getBoundingClientRect().top - top) < 2,
      headerAboveContract: Number(getComputedStyle(header).zIndex) > Number(getComputedStyle(body.querySelector('td')).zIndex),
    };
    body.innerHTML = originalBody;
    scroll.style.maxHeight = originalHeight;
    scroll.scrollTop = 0;
    scroll.scrollLeft = 0;
    return result;
  });
  assert(ledgerLayout.twoLines, 'long STO credit header uses two lines');
  assert(ledgerLayout.scrolled && ledgerLayout.headerPinned && ledgerLayout.cornerPinned, 'header stays pinned during vertical and horizontal scrolling');
  assert(ledgerLayout.headerAboveContract, 'frozen contract cells cannot cover the header');
  assert(optionCells[3].includes('$150.25') && optionCells[3].includes('Adj. close'), 'Entry Spot explicitly identifies adjusted-close fallback');
  await page.click('#openOptions [data-option-right="call"]');
  assert(!(await page.$('#openOptions .option-ledger-row')), 'right filter removes put row');
  await page.click('#openOptions [data-option-right="all"]');
  await page.click('#openOptions [data-option-month="2026-09"]');
  assert(!(await page.$eval('#openOptions', (node) => node.textContent.includes('AAPL Short Put $140 · 18-Sep-2026'))), 'month row collapses');
  await page.click('#openOptions [data-option-month="2026-09"]');
  assert(await page.$eval('#openOptions', (node) => node.textContent.includes('AAPL Short Put $140 · 18-Sep-2026')), 'month row expands');
  for (const label of ['Allocation', 'Performance by position', 'Performance over time', 'Key insights', 'Channel details', 'Holdings detail', 'Fixed deposits', 'Methodology']) {
    assert(!(await page.$(`section[aria-label="${label}"]`)), `${label} section removed`);
  }
  assert(await page.$('#channelPills [data-channel="moomoo"]'), 'dashboard moomoo chip');
  await page.click('#channelPills [data-channel="moomoo"]');
  await page.waitForFunction(() => /moomoo desk/i.test(document.getElementById('deskEyebrow')?.textContent || ''));
  assert(!dashText.includes('#0d1117'), 'no github hex in text');
  const css = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(css !== 'rgb(13, 17, 23)', `body not github dark, got ${css}`);

  const savedTrade = payload.optionTradeDetails['AAPL  260918P00140000'];
  const savedDaily = payload.premiumJournal.daily;
  payload.optionTradeDetails['AAPL  260918P00140000'] = { ...savedTrade, stoNetPremium: null, stoGrossPremium: 500 };
  payload.premiumJournal.daily = savedDaily.map(row => ({ ...row, net_premium: null }));
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#channelPills [data-channel="ibkr"]');
  await page.click('#channelPills [data-channel="ibkr"]');
  const grossCells = await page.$$eval('#openOptions .option-ledger-row td', cells => cells.map(cell => cell.textContent.trim()));
  assert.equal(grossCells[7], '$500.00Before fees', 'gross proceeds cannot masquerade as net credit');
  assert(grossCells[2].includes('09-Sep-2026'), 'opening date survives unavailable fees');
  assert(/Before fees/.test(await page.$eval('#kpiRow', node => node.textContent)), 'premium stays available before fees across all brokers');
  assert.equal(await page.$eval('#totalPremiumValue', node => node.textContent), '$654.00', 'total uses recorded premium before fees when fees are missing');
  assert.match(await page.$eval('#totalPremiumMeta', node => node.textContent), /Before fees/, 'gross total clearly states its basis');
  payload.optionTradeDetails['AAPL  260918P00140000'] = savedTrade;
  payload.premiumJournal.daily = savedDaily;

  payload.equityPrices = { AAPL: 151.23 };
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#openOptions .option-ledger-row');
  await page.click('#channelPills [data-channel="ibkr"]');
  assert.equal(await page.$eval('#openOptions .option-ledger-row td:nth-child(5)', cell => cell.textContent.trim()), '$151.23', 'Current Spot updates from the refreshed share quote without contract scaling');

  payload.equityPrices = {};
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('expiryTable')?.textContent?.includes('could not be scored'));
  assert.equal(await page.$$eval('#expiryTable .risk-row', (rows) => rows.length), 0, 'unscored contracts are excluded from the radar');
  assert.equal(await page.$$eval('#openOptions .option-ledger-row', rows => rows.length), 2, 'unscored contracts remain in Section 03');
  assert(await page.$$eval('#openOptions .option-ledger-row td:nth-child(5)', cells => cells.every(cell => cell.textContent.trim() === '—')), 'missing spot quotes display as unavailable');
  assert(/0 of 2 flagged/.test(await page.$eval('#expiryTable', (node) => node.textContent)), 'radar count stays honest');

  payload.generatedAt = '2026-10-06T10:00:00.000Z';
  payload.brokerAsOf.ibkr = '2026-09-22';
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.querySelector('#openOptions .option-freshness-warning'));
  assert(/last confirmed 22-Sep-2026/.test(await page.$eval('#openOptions .option-freshness-warning', node => node.textContent)), 'stale broker positions are visibly unverified');
  assert(/Put positions need a fresh broker sync/.test(await page.$eval('#kpiRow', node => node.textContent)), 'stale put positions do not produce a cash scenario');

  const savedModel = payload.model;
  payload.model = { ...savedModel, live: { ...savedModel.live, positions: [], channels: [], byChannel: [],
    optionCount: 0, equityCount: 0, fundCount: 0 } };
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('totalPremiumValue')?.textContent === '$654.00');
  await page.screenshot({ path: '/tmp/velovest-dashboard-mobile.png', fullPage: true });
  const mobileBoxes = await page.$$eval('.hero-metrics .nav-card', nodes => nodes.map(n => {
    const b = n.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }));
  assert(mobileBoxes.every(b => b.left >= 0 && b.right <= 390), 'NAV and total fit on mobile');
  assert(mobileBoxes[1].top >= mobileBoxes[0].bottom, 'mobile hero cards stack without overlap');
  await page.setViewport({ width: 1280, height: 900 });
  payload.empty = true;
  payload.model = null;
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#dashboard:not(.hidden)');
  await page.click('#optionHistoryTab');
  await page.waitForFunction(() => document.getElementById('optionHistoryTable')?.textContent?.includes('MSFT'));
  assert(/No longer observed/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'history survives an empty current portfolio');
  payload.empty = false;
  payload.model = savedModel;

  const previousAnalytics = payload.optionAnalytics;
  const previousGeneratedAt = payload.generatedAt;
  payload.generatedAt = '2026-10-13T10:00:00.000Z';
  payload.optionAnalytics = { executions: previousAnalytics.executions,
    profits: Array.from({ length: 13 }, (_, i) => {
      const date = new Date(Date.UTC(2025, 9 + i, 10)).toISOString().slice(0, 10);
      const gross = (i % 3 - 1) * 1200 + (i + 1) * 120;
      return { channel: 'ibkr', underlying: 'AMD', date, currency: 'USD', gross, net: gross - 3 };
    }).filter(row => !row.date.startsWith('2026-06')),
    gaps: [
      { channel: 'ibkr', date: '2026-05-12', reason: 'Closing quantity has no complete matching opening fills' },
      { channel: 'ibkr', date: '2026-06-12', reason: 'Closing quantity has no complete matching opening fills' },
    ] };
  payload.optionAnalytics.profits.find(row => row.date.startsWith('2026-09')).gross = null;
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('[data-pnl-month="2026-05"]');
  assert.match(await page.$eval('[data-pnl-month="2026-05"] td:nth-child(2)', node => node.textContent), /Partial subtotal/);
  assert.match(await page.$eval('[data-pnl-month="2026-06"]', node => node.textContent), /Not available/);
  assert.match(await page.$eval('[data-pnl-month="2026-09"] td:nth-child(2)', node => node.textContent), /\$/);
  assert(await page.$('.pnl-card line[stroke-dasharray]'), 'partial results use dashed connections');
  assert(await page.$('.pnl-card .pnl-point-partial'), 'partial results have hollow markers');
  await page.click('[data-pnl-month="2026-05"] summary');
  assert.match(await page.$eval('[data-pnl-month="2026-05"] details', node => node.textContent), /AMD · IBKR/);
  await page.click('.pnl-coverage-details summary');
  assert.match(await page.$eval('.pnl-coverage-details', node => node.textContent), /Earlier opening trades are missing/);
  await page.$eval('.pnl-card', node => node.scrollIntoView());
  await (await page.$('.pnl-card')).screenshot({ path: '/tmp/velovest-monthly-pnl-desktop.png' });
  await page.setViewport({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'P&L chart and table do not widen the mobile page');
  assert(await page.$$eval('.pnl-table td', cells => cells.every(cell => cell.getBoundingClientRect().right <= innerWidth)), 'all monthly explanations fit on mobile');
  assert(await page.$eval('.pnl-card .table-scroll', node => getComputedStyle(node).maxHeight === 'none'), 'latest month is not clipped by a fixed-height table');
  await (await page.$('.pnl-card')).screenshot({ path: '/tmp/velovest-monthly-pnl-mobile.png' });
  await page.setViewport({ width: 1280, height: 900 });
  payload.optionAnalytics = { ...previousAnalytics, executions: ['AMD', 'AMZN', 'BABA', 'GOOG', 'META', 'MSFT', 'NVDA', 'TSLA'].map((underlying, i) => ({ channel: 'ibkr', underlying, executed_at: '2026-09-10T10:00:00', currency: 'USD', gross_premium: String([100, 900, 400, 800, 600, 700, 1000, -50][i]) })) };
  payload.optionAnalytics.executions.push({ channel: 'ibkr', underlying: 'XYZ', executed_at: '2026-09-10T10:00:00', currency: 'EUR', gross_premium: '2000' });
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#underlyingPremiumCard .bar-more');
  const visibleUnderlyingRows = () => page.$$eval('#underlyingPremiumCard .bar-row', rows => rows.filter(row => row.getClientRects().length).length);
  assert.equal(await visibleUnderlyingRows(), 5, 'underlying card initially shows five rows');
  assert.deepEqual(await page.$$eval('#underlyingPremiumCard > .bar-list .bar-meta > span:first-child', nodes => nodes.map(node => node.textContent)), ['NVDA', 'AMZN', 'GOOG', 'MSFT', 'META'], 'five highest premium amounts appear first');
  assert.equal(await page.$('#premiumEngine > div > .chart-help'), null, 'note is no longer outside the card');
  assert.match(await page.$eval('#underlyingPremiumCard > :last-child', node => node.textContent), /Before fees/);
  assert(await page.$('#underlyingPremiumCard > :last-child .help-dot'), 'help stays with the footer note');
  await page.hover('#underlyingPremiumCard .help-dot');
  await page.waitForSelector('#reportHelpTooltip:not([hidden])');
  await page.keyboard.press('Escape');
  await page.$eval('#underlyingPremiumCard summary', node => node.focus());
  await page.keyboard.press('Enter');
  assert.equal(await visibleUnderlyingRows(), 9, 'keyboard expands all remaining rows');
  assert.deepEqual(await page.$$eval('#underlyingPremiumCard .bar-meta > span:first-child', nodes => nodes.map(node => node.textContent)), ['NVDA', 'AMZN', 'GOOG', 'MSFT', 'META', 'BABA', 'AMD', 'TSLA', 'XYZ'], 'expanded rows stay descending, with negative then unknown amounts');
  await page.click('#underlyingPremiumCard summary');
  assert.equal(await visibleUnderlyingRows(), 5, 'card collapses back to five rows');
  await (await page.$('#underlyingPremiumCard')).screenshot({ path: '/tmp/velovest-underlying-card.png' });
  await page.setViewport({ width: 390, height: 844 });
  await page.click('#underlyingPremiumCard summary');
  assert.equal(await visibleUnderlyingRows(), 9, 'mobile can expand all rows');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'expanded card fits mobile');
  await page.setViewport({ width: 1280, height: 900 });
  payload.optionAnalytics = previousAnalytics;
  payload.generatedAt = previousGeneratedAt;

  const dailyBeforeWindowCheck = payload.premiumJournal.daily;
  payload.generatedAt = '2026-10-13T12:00:00Z';
  payload.premiumJournal.daily = [
    { channel: 'ibkr', date: '2026-10-01', currency: 'USD', gross_premium: '1150' },
    { channel: 'ibkr', date: '2026-10-12', currency: 'USD', gross_premium: '15059' },
  ];
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#dashboard:not(.hidden)');
  assert.match(await page.$eval('#kpiRow > :first-child .metric-value', node => node.textContent), /15,059/, 'T-1 premium is shown');
  assert.match(await page.$eval('#kpiRow > :first-child', node => node.textContent), /12-Oct-2026.*13-Oct-2026/, 'daily card names its actual window');
  payload.premiumJournal.daily = payload.premiumJournal.daily.slice(0, 1);
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#dashboard:not(.hidden)');
  assert.equal(await page.$eval('#kpiRow > :first-child .metric-value', node => node.textContent), '$0', 'October 1 premium cannot appear as daily on October 13');
  payload.premiumJournal.daily = dailyBeforeWindowCheck;
  payload.generatedAt = previousGeneratedAt;

  const beforeRisk = structuredClone(payload.model.live.positions);
  const beforeRiskPrices = payload.equityPrices;
  payload.generatedAt = '2026-10-13T12:00:00Z';
  payload.equityPrices = { TSLA: 380, SLV: 50 };
  const template = beforeRisk.find(p => p.option);
  payload.model.live.positions = ['TSLA', 'SLV'].map((underlying, index) => ({ ...template,
    ticker: underlying + '-test', units: index ? 3 : 1, price: 0,
    option: { ...template.option, underlying, side: 'short', right: 'put', strike: index ? 55 : 390, expiry: '2026-10-16' } }));
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForSelector('#loading.hidden');
  await page.waitForSelector('#expiryTable .risk-row');
  assert.equal(await page.$$eval('#expiryTable .risk-row', rows => rows.length), 2, 'confirmed near-expiry TSLA and SLV ITM puts remain without usable marks');
  assert.match(await page.$eval('#expiryTable', node => node.textContent), /TSLA/);
  assert.match(await page.$eval('#expiryTable', node => node.textContent), /SLV/);
  payload.model.live.positions = beforeRisk;
  payload.equityPrices = beforeRiskPrices;
  payload.generatedAt = previousGeneratedAt;

  payload.model.live.positions[0].ticker = 'AAPL@ibkr';
  payload.model.live.positions.push({ ...payload.model.live.positions.find(p => p.option), ticker: 'AAPL-call', option: { ...payload.model.live.positions.find(p => p.option).option, underlying: 'AAPL', right: 'call', side: 'short' }, contingentShareObligation: 100 });
  await page.goto(`http://127.0.0.1:${port}/positions/`);
  await page.waitForSelector('#table2 tbody');
  const posText = await page.evaluate(() => document.body.innerText);
  assert(await page.$eval('#table2 tbody', node => /AAPL\s+100/.test(node.textContent)), 'broker suffix does not lose recorded shares');
  assert(!await page.$eval('#table1 tbody', node => node.textContent.includes('@ibkr')), 'broker suffix hidden in stock ticker');
  assert(posText.includes('Assignment obligations'), posText.slice(0, 400));
  assert(!posText.includes('Watchlist'), 'watchlist removed from positions');
  assert(await page.$('#filters [data-channel="moomoo"]'), 'positions broker chips');
  await page.click('#filters [data-channel="moomoo"]');
  await page.waitForFunction(() => /BABA/.test(document.body.innerText) && !/AAPL 19-SEP/.test(document.body.innerText));

  await page.goto(`http://127.0.0.1:${port}/insights/`);
  await page.waitForFunction(() => document.getElementById('hello')?.textContent?.includes('Where the book stands'));
  const ins = await page.evaluate(() => document.body.innerText);
  assert(!ins.includes('Recommended actions') && !ins.includes('Premium and P&L by underlying'), 'unfinished Insights sections hidden');
  assert(ins.includes('Book statistics'), ins.slice(0, 500));
  assert(!ins.includes('Your personal edge'), ins.slice(0, 500));
  assert(!ins.includes('Hello, Demo'), 'no Hello H1');
  assert(await page.$('#filters [data-channel="ibkr"]'), 'insights broker chips');
  await page.click('#filters [data-channel="ibkr"]');
  await page.waitForFunction(() => /ibkr/i.test(document.getElementById('summary')?.textContent || ''));

  cachedSnapshot = structuredClone(payload);
  const beforeNavigation = dashboardRequests;
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Snapshot'));
  await page.goto(`http://127.0.0.1:${port}/positions/`);
  await page.waitForSelector('#table2 tbody');
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Snapshot'));
  assert.equal(dashboardRequests, beforeNavigation, 'navigation reuses snapshot without valuation reloads');
  await page.click('#dashboardRefresh');
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.includes('Loaded in'));
  assert.equal(dashboardRequests, beforeNavigation + 1, 'explicit refresh fetches new valuation');

  await page.goto(`http://127.0.0.1:${port}/trades/`);
  await page.waitForSelector('#table tbody details');
  assert.deepEqual(await page.$$eval('#table thead th', nodes => nodes.map(n => n.textContent)), ['ID', 'Ticker', 'Strategy', 'Strike', 'Expiry', 'Contracts', 'Premium', 'Broker']);
  await page.select('#tradeTicker', 'AAPL');
  await page.click('#table details summary');
  assert.match(await page.$eval('#table details[open]', node => node.textContent), /Mark \/ contract/);
  await page.setViewport({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'trades table scrolls within mobile page');
  await page.screenshot({ path: '/tmp/invage-trades-feedback.png', fullPage: true });

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('Report pages browser regression passed');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
