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
  premiumJournal: { available: true, channels: ['ibkr'], daily: [
    { channel: 'ibkr', account_id: 'U1', date: '2026-09-16', currency: 'USD', net_premium: '100' },
    { channel: 'ibkr', account_id: 'U1', date: '2026-09-09', currency: 'USD', net_premium: '200' },
  ] },
  optionTradeDetails: {
    'AAPL  260918P00140000': { openedFrom: '2026-09-09', openedTo: '2026-09-09', stoNetPremium: 499, currency: 'USD' },
    'AAPL  261016P00160000': { openedFrom: '2026-09-16', openedTo: '2026-09-16', stoNetPremium: 1699, currency: 'USD' },
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

const discussionRequests = [];
let discussionFailure = false;
const server = createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (url === '/discussion-shell') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<iframe title="Dashboard" src="/dashboard/" style="width:100%;height:900px;border:0"></iframe>');
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
  const dashText = await page.evaluate(() => document.body.innerText);
  assert(/Portfolio snapshot/i.test(dashText), 'dashboard h1');
  const heroLead = await page.$eval('#heroLead', node => node.textContent);
  assert(/2 positions — 1 equity, 1 option, 0 fund/.test(heroLead), `hero position count includes open options: ${heroLead}`);
  assert(/Net premium\s*·\s*Daily/i.test(dashText), 'daily premium kpi');
  assert(/Net premium\s*·\s*MTD/i.test(dashText), 'MTD premium kpi');
  assert(/Cash after all puts assigned/i.test(dashText), 'cash-after-assignment kpi');
  assert(/Net asset value/i.test(dashText), 'NAV hero card');
  assert(/Open options positions · broker view/i.test(dashText), 'open options section');
  assert(/Assignment exposure/i.test(dashText), 'assignment exposure column');
  assert(/STO net credit/i.test(dashText), 'STO credit column');
  assert(/Opened/i.test(dashText), 'opening date column');
  assert(/% of max/i.test(dashText), 'premium capture column');
  assert(/Prob\. ITM/i.test(dashText), 'risk probability column');
  assert(/Complete trade history unavailable/.test(await page.$eval('#kpiRow', node => node.textContent)), 'merged premium does not silently omit moomoo');
  await page.click('#channelPills [data-channel="ibkr"]');
  assert(/\$100/.test(await page.$eval('#kpiRow', node => node.textContent)), 'IBKR daily premium uses recorded fills');
  assert(/\$300/.test(await page.$eval('#kpiRow', node => node.textContent)), 'IBKR MTD premium uses recorded fills');
  await page.click('#channelPills [data-channel="merged"]');
  assert(await page.$('#expiryTable .risk-row'), 'scored risk contract');
  assert(/\$16,000/.test(await page.$eval('#expiryRow', (node) => node.textContent)), 'radar exposure uses scored contracts');
  await page.click('#expiryTable [data-risk-scope="all"]');
  assert.equal(await page.$$eval('#expiryTable .risk-row', (rows) => rows.length), 2, 'all-open view includes lower-risk contracts');
  await page.click('#expiryTable [data-risk-scope="high"]');
  assert.equal(await page.$$eval('#expiryTable .risk-row', (rows) => rows.length), 1, 'radar view keeps only contracts above threshold');
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
  await dashboardFrame.click('[data-risk-scope="all"]');
  assert.equal(await dashboardFrame.$$eval('[data-option-discuss]', buttons => buttons.length), 2, 'each visible option has a discussion action');
  const discussionButtons = await dashboardFrame.$$eval('[data-option-discuss]', buttons => buttons.map(button => ({
    label: button.getAttribute('aria-label'), prompt: button.dataset.optionDiscuss,
  })));
  assert.notEqual(discussionButtons[0].prompt, discussionButtons[1].prompt, 'same underlying with different expiry gets distinct context');
  assert(discussionButtons[0].label.includes('2026-09-18'), 'accessible action identifies exact contract');
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
  await dashboardFrame.click('[data-option-discuss]');
  await discussionPage.waitForFunction(() => location.search === '?c=option-chat-123');
  assert.equal(discussionPage.frames().length, 1, 'discussion navigates app shell out of iframe');
  const discussion = discussionRequests.at(-1);
  assert.equal(discussion.conversationId, undefined, 'discussion starts a new focused chat');
  assert(discussion.text.includes('AAPL  260918P00140000'), 'chat gets full contract identifier');
  assert(discussion.text.includes('strike 140 USD') && discussion.text.includes('expiry 2026-09-18'), 'chat gets strike, currency and expiry');
  assert(discussion.text.includes('Broker/channel: ibkr') && discussion.text.includes('Quantity: 1 contracts. Multiplier: 100'), 'chat gets broker and position size');
  assert(discussion.text.includes('as of 2026-09-16') && discussion.text.includes('verify the current holding'), 'snapshot date and freshness preserved');
  assert.equal(discussionRequests.length, 2, 'one request per deliberate attempt');
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
  assert(/first observed absent 2026-08-24/.test(await page.$eval('#optionHistoryDetail', node => node.textContent)), 'history detail preserves absence date');
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
  assert.equal(optionCells[5], '$499.00', 'STO credit comes from matched fills');
  assert.equal(optionCells[6], '$500.00', 'open cost basis remains distinct');
  assert.equal(optionCells[7], '$200.00', 'broker mark per contract wins over live option price');
  assert.equal(optionCells[8], '-$200.00', 'market value uses broker mark');
  assert.equal(optionCells[9], '$300.00', 'P&L uses broker mark');
  assert.equal(await page.$eval('#openOptions .option-ledger td:first-child', node => getComputedStyle(node).position), 'sticky', 'contract stays visible on horizontal scroll');
  await page.click('#openOptions [data-option-price]');
  await page.waitForFunction(() => document.querySelector('#openOptions [data-option-price]')?.textContent?.includes('Adjusted close'));
  assert(/150\.25/.test(await page.$eval('#openOptions [data-option-price]', node => node.textContent)), 'opening-day adjusted close is labelled');
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
  assert.equal(grossCells[5], '$500.00 before fees', 'gross proceeds cannot masquerade as net credit');
  assert(grossCells[2].includes('09-Sep-2026'), 'opening date survives unavailable fees');
  assert(/Broker fill fees are unavailable/.test(await page.$eval('#kpiRow', node => node.textContent)), 'net premium remains unknown rather than zero');
  payload.optionTradeDetails['AAPL  260918P00140000'] = savedTrade;
  payload.premiumJournal.daily = savedDaily;

  payload.equityPrices = {};
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.getElementById('expiryTable')?.textContent?.includes('No spot quote'));
  assert.equal(await page.$$eval('#expiryTable .risk-row', (rows) => rows.length), 2, 'unscored open contracts remain visible');
  assert(/0 of 2 above 30%/.test(await page.$eval('#expiryTable', (node) => node.textContent)), 'radar count stays honest');

  payload.generatedAt = '2026-10-06T10:00:00.000Z';
  payload.brokerAsOf.ibkr = '2026-09-22';
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.waitForFunction(() => document.querySelector('#openOptions .option-freshness-warning'));
  assert(/last confirmed 22-Sep-2026/.test(await page.$eval('#openOptions .option-freshness-warning', node => node.textContent)), 'stale broker positions are visibly unverified');
  assert(/Put positions need a fresh broker sync/.test(await page.$eval('#kpiRow', node => node.textContent)), 'stale put positions do not produce a cash scenario');

  const savedModel = payload.model;
  payload.empty = true;
  payload.model = null;
  await page.goto(`http://127.0.0.1:${port}/dashboard/`);
  await page.click('#optionHistoryTab');
  await page.waitForFunction(() => document.getElementById('optionHistoryTable')?.textContent?.includes('MSFT'));
  assert(/No longer observed/.test(await page.$eval('#optionHistoryTable', node => node.textContent)), 'history survives an empty current portfolio');
  payload.empty = false;
  payload.model = savedModel;

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
