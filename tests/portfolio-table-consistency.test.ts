import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildPageProjections, buildTradeProjections } from '../src/report/page-projections.js';
import { openOptionTradeDetails } from '../src/webapp/option-dashboard-data.js';
import { tradesOpenBook } from '../src/webapp/trades-v2-data.js';

const math = runInNewContext(readFileSync('webui/option-position.js', 'utf8') + '; OptionPosition');
function fixture() {
  const definitions = [
    ['put', 'ibkr', 'AAPL', 'USD', 'short', 'put', 82.5, 100, 2, 300, 450, 200],
    ['hedge', 'ibkr', 'AAPL', 'USD', 'long', 'put', 80, 100, 2, 100, 75, 50],
    ['call', 'ibkr', 'AAPL', 'USD', 'short', 'call', 100, 100, 1, 500, 250, 100],
    ['foreign', 'tiger', 'SGX', 'SGD', 'short', 'put', 120, 10, 1, 20, 15, 12],
  ];
  const portfolio: any = {}, executions: any[] = [];
  for (const [key, channel, underlying, currency, side, right, strike, multiplier, units, avg, market] of definitions as any[]) {
    portfolio[key] = { instrument: 'option', channel, currency, units, avg_price: avg,
      option: { underlying, side, right, strike, multiplier, expiry: '2026-11-20', settlement: 'physical', mark: market } };
    executions.push({ channel, account_id: channel, execution_id: key, contract_id: key, executed_at: '2026-10-01T10:00:00', underlying,
      right, side: side === 'short' ? 'sell' : 'buy', effect: 'open', strike: String(strike), multiplier: String(multiplier),
      expiry: '2026-11-20', contracts: String(units), currency, gross_premium: String(avg * units * (side === 'short' ? 1 : -1)), commission: '0' });
  }
  const state: any = { user: { id: '8648d3d4-f46f-4979-a9f3-7d76cefa9d15', created_at: '2026-01-01' },
    profile: { display_name: 'Consistency', contact_email: 'test@example.test' }, log: [], portfolio, option_executions: executions,
    broker_sources: Object.fromEntries(['ibkr', 'tiger'].map(channel => [channel, { broker_id: channel, credentials: {} }])),
    broker_connections: Object.fromEntries(['ibkr', 'tiger'].map(channel => [channel, { broker_id: channel, source_id: channel,
      channel, label: channel, account_id: channel, enabled: true, config: channel === 'tiger' ? { account: channel } : {} }])) };
  const live = buildLivePositions(portfolio, { AAPL: 100, SGX: 130 }, {},
    [{ channel: 'ibkr', currency: 'USD', amount: 10000 }, { channel: 'tiger', currency: 'SGD', amount: 1000 }], [],
    '2026-10-28', { reportingCurrency: 'USD', fxRates: { SGD: .75 } });
  for (const p of live.positions) p.brokerMark = definitions.find(row => row[0] === p.ticker)![11] as number;
  for (const p of live.positions) p.probabilityQuote = { mark: p.brokerMark!, spot: p.currency === 'USD' ? 100 : 130,
    optionAsOf: '2026-10-28T11:59:00Z', spotAsOf: '2026-10-28T12:00:00Z' };
  const details = openOptionTradeDetails(portfolio, executions, { ibkr: 'ibkr', tiger: 'tiger' });
  details.call.rollDate = '2026-10-01'; details.call.rollPremium = 200;
  const payload: any = { empty: false, displayName: 'Consistency', productProfile: 'consultant', generatedAt: '2026-10-28T12:00:00Z',
    dashboardConfig: { dashboardVersion: 'v2', showOptionRiskModelView: false }, model: buildDashboardModel(live, []),
    brokerAsOf: { ibkr: '2026-10-28', tiger: '2026-10-28' }, equityPrices: { AAPL: 100, SGX: 130 }, optionTradeDetails: details, optionAnalytics: { executions, profits: [], gaps: [] } };
  const pages = buildPageProjections(payload);
  payload.pageProjections = { positions: pages.positions, insights: pages.insights }; payload.aggregatedViews = pages.dashboard;
  const open: any = { ...tradesOpenBook(state), revision: 1 }; open.aggregates = buildTradeProjections(open.rows);
  return { payload, open };
}

it('matches broker-mark option P&L and risk across dashboard and portfolio in each account and currency', () => {
  const { payload, open } = fixture();
  for (const channel of ['all', 'ibkr', 'tiger']) {
    const portfolio = payload.pageProjections.positions[channel];
    const dashboard = payload.aggregatedViews.live[channel === 'all' ? 'merged' : channel];
    for (const row of portfolio.obligations) {
      const matching = dashboard.risk.wheel.rows.filter((r: any) => r.p.option.underlying === row.ticker);
      const nativePnl = matching.reduce((n: number, r: any) => n + math.valuation(r.p).pnl * (r.p.currency === 'USD' ? 1 : .75), 0);
      expect(row.pnl).toBeCloseTo(nativePnl);
      expect(row.highRisk).toBe(matching.filter((r: any) => r.estimate.probability > .6).length);
      expect(row.unscored).toBe(matching.filter((r: any) => r.estimate.probability == null).length);
    }
  }
  expect(payload.pageProjections.positions.all.obligations.find((r: any) => r.ticker === 'AAPL').pnl).toBe(600);
  expect(new Map(payload.aggregatedViews.live.merged.openBook.pnlByExpiry).get('2026-11')).toBe(506);
  expect(new Map(payload.aggregatedViews.live.merged.openBook.premiumByExpiry).get('2026-11')).toBe(615);
  expect(open.rows.find((r: any) => r.right === 'call').premium).toBe('500');
  expect(payload.pageProjections.positions.ibkr.totals.premium).toBe(1100);
});

it('uses execution cash rather than an adjusted position basis, preserving zeroes, debits and missing evidence', () => {
  const { payload } = fixture();
  payload.model.live.positions.find((p: any) => p.ticker === 'put').cost = 744;
  let pages = buildPageProjections(payload);
  expect(new Map((pages.dashboard.live.merged as any).openBook.premiumByExpiry).get('2026-11')).toBe(615);
  payload.optionTradeDetails.put.stoGrossPremium = 0;
  pages = buildPageProjections(payload);
  expect(new Map((pages.dashboard.live.merged as any).openBook.premiumByExpiry).get('2026-11')).toBe(15);
  delete payload.optionTradeDetails.put;
  pages = buildPageProjections(payload);
  expect(new Map((pages.dashboard.live.merged as any).openBook.premiumByExpiry).get('2026-11')).toBeNull();
});

const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('keeps fractional strikes, broker P&L and opening/roll help consistent on desktop and mobile', async () => {
  const { payload, open } = fixture(), root = resolve('webui');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname.endsWith('/dashboard') || url.pathname.endsWith('/dashboard-cache')) return json(payload);
    if (url.pathname.endsWith('/trades-v2')) return json(open);
    if (url.pathname.endsWith('/broker-sync')) return json(null);
    if (url.pathname.endsWith('/option-risk/capabilities')) return json({ enabled: false });
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], next_offset: null });
    const path = resolve(root, '.' + url.pathname);
    if (!path.startsWith(root + '/') || !existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : extname(path) === '.css' ? 'text/css' : 'text/html');
    res.end(readFileSync(path));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true); page.on('request', r => r.url().startsWith(origin) ? r.continue() : r.abort());
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(origin + '/dashboard/v2.html'); await page.waitForSelector('#expiryTable .risk-row');
      await page.click('[data-risk-level="ok"]');
      expect(await page.$$eval('#expiryTable .risk-row td:nth-child(5)', nodes => nodes.map(n => n.textContent))).toContain('$82.5');
      expect(await page.$eval('#openPnlExpiryCard', n => n.textContent)).toContain('$506.00');
      expect(await page.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('$915.00'); // Recorded calendar cash flow, distinct from open/latest-roll premium.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto(origin + '/positions/v2.html'); await page.waitForSelector('#obligationsTable tbody tr');
      expect(await page.$eval('#obligationsTable tbody', n => n.textContent)).toContain('+$600.00');
      expect(await page.$eval('#obligationsTable tbody', n => n.textContent)).not.toContain('unscored');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto(origin + '/trades/v2.html'); await page.waitForSelector('#journalTable [data-row]');
      expect(await page.$eval('#journalTable [aria-label="About Returns %"]', n => n.getAttribute('data-help'))).toContain('closing leg');
      expect(await page.$$eval('#journalTable [data-row] td:nth-child(5)', nodes => nodes.map(n => n.textContent))).toContain('$82.50');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30000);
