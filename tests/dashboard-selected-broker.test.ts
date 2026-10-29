import { attachDailyChanges } from '../src/report/daily-changes.js';
import type { PortfolioProjection } from '../src/state/projection-store.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildBrokerProjections } from '../src/report/broker-projections.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import { buildExecutionJournal } from '../src/brokers/option-executions.js';
import { buildRecordedOptionAnalytics } from '../src/webapp/option-analytics.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';

function fixture() {
  const state: InvestorState = { user: { id: '00000000-0000-4000-8000-000000000061', slug: 'test', created_at: '2026-01-01' },
    profile: { display_name: 'Selected broker', contact_email: 'test@example.com' }, log: [],
    broker_sources: { ib: { broker_id: 'ibkr', credentials: { token: 'test' } }, tiger: { broker_id: 'tiger', credentials: {} } },
    broker_connections: Object.fromEntries(['retirement', 'savings', 'other'].map((channel, i) => [channel, {
      broker_id: i < 2 ? 'ibkr' : 'tiger', source_id: i < 2 ? 'ib' : 'tiger', account_id: 'A' + i,
      channel, label: channel, enabled: true, config: i < 2 ? {} : { account: 'A' + i },
    }])),
    portfolio: {
      'AAPL@retirement': { units: 1, avg_price: 80, currency: 'USD', channel: 'retirement' },
      'AAPL@savings': { units: 1, avg_price: 80, currency: 'USD', channel: 'savings' },
      'MSFT@other': { units: 1, avg_price: 180, currency: 'USD', channel: 'other' },
      'AAPL-put': { units: 1, avg_price: 100, currency: 'USD', channel: 'retirement', instrument: 'option',
        option: { underlying: 'AAPL', right: 'put', side: 'short', strike: 100, expiry: '2026-11-20', multiplier: 100, settlement: 'physical', mark: 100, quote_source: 'manual' } },
      'MSFT-put': { units: 1, avg_price: 100, currency: 'USD', channel: 'other', instrument: 'option',
        option: { underlying: 'MSFT', right: 'put', side: 'short', strike: 200, expiry: '2026-11-20', multiplier: 100, settlement: 'physical', mark: 50, quote_source: 'manual' } },
    },
    cash: ['retirement', 'savings', 'other'].map((channel, i) => ({ channel, currency: 'USD', amount: [50, 75, 25][i], updated_at: '2026-10-23' })),
  };
  state.option_executions = ['retirement', 'savings', 'other'].map((channel, i) => ({ channel, account_id: 'A' + i,
    execution_id: 'open', contract_id: 'option-' + i, executed_at: '2026-10-23T09:00:00', underlying: i < 2 ? 'AAPL' : 'MSFT',
    right: 'put', side: 'sell', effect: 'open', strike: i < 2 ? '100' : '200', expiry: '2026-11-20', multiplier: '100',
    contracts: '1', gross_premium: ['100', '200', '500'][i], currency: 'USD', commission: '-1' }));
  const journal = buildExecutionJournal(state.option_executions);
  const live = buildLivePositions(state.portfolio!, { AAPL: 100, MSFT: 200 }, {}, state.cash, [], '2026-10-23', { reportingCurrency: 'USD', fxRates: {} });
  const dashboard: DashboardPayload = { slug: state.user.id, displayName: state.profile.display_name, empty: false,
    generatedAt: '2026-10-23T10:00:00Z', productProfile: 'consultant', productName: 'Test', benchmark: null,
    model: buildDashboardModel(live, [{ date: '2026-10-22', totalValue: 999, totalCost: 0, totalPL: 0, totalPLPct: 0, positions: [], cashAmount: 999, cashCurrency: 'USD' }]),
    premiumJournal: { available: journal.available, daily: journal.daily, channels: ['retirement', 'savings', 'other'] },
    optionAnalytics: buildRecordedOptionAnalytics(state.option_executions), equityPrices: { AAPL: 100, MSFT: 200 },
    brokerAsOf: { retirement: '2026-10-23', savings: '2026-10-23', other: '2026-10-23' },
    brokerChannels: { retirement: { brokerId: 'ibkr', label: 'Retirement' }, savings: { brokerId: 'ibkr', label: 'Savings' }, other: { brokerId: 'tiger', label: 'Other' } } };
  dashboard.aggregatedViews = buildPageProjections(dashboard).dashboard;
  const brokers = buildBrokerProjections(state, dashboard, [], []);
  const entry = { dashboard, brokers, calculatedAt: dashboard.generatedAt } as PortfolioProjection;
  const yesterday = structuredClone(entry);
  yesterday.calculatedAt = '2026-10-22T10:00:00Z';
  for (const raw of Object.values(yesterday.dashboard.aggregatedViews!.live)) (raw as any).view.totalValue -= 10;
  for (const [id, broker] of Object.entries(yesterday.brokers)) for (const raw of Object.values(broker.scopes.live)) (raw as any).view.totalValue -= id === 'ibkr' ? 20 : 30;
  attachDailyChanges(yesterday);
  attachDailyChanges(entry, yesterday.dailyAggregateHistory);
  return { ...dashboard, brokerAggregates: brokers, analysisContextId: 'selected-broker-test',
    dashboardConfig: { showDailyChanges: true, showTotalPremium: true, showRealizedPnl: true, showOptionRiskModelView: true } };
}
const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath)).each(['index.html', 'v2.html'])('%s keeps account/all selection consistent across totals, history, risk scope and reload', async fileName => {
  const root = resolve('webui'), payload = fixture();
  const requests: URL[] = [], riskScopes: string[][] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost'); requests.push(url);
    const json = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith('/dashboard')) return json(payload);
    if (url.pathname.endsWith('/broker-sync')) return json(null);
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: ['retirement','savings','other'].map((channel, i) => ({ channel, label: channel, broker_id: i < 2 ? 'ibkr' : 'tiger' })), gaps: [], next_offset: null });
    if (url.pathname.endsWith('/option-relationships')) return json({ groups: [], spreads: [], connections: [], coverage: [], gaps: [], total: 0, next_offset: null });
    if (url.pathname.endsWith('/option-risk/capabilities')) return json({ enabled: true, available: true });
    if (url.pathname.endsWith('/option-risk/latest')) { riskScopes.push(JSON.parse(url.searchParams.get('accountIds') || '[]')); return json({ job: null }); }
    if (url.pathname.endsWith('/option-risk/jobs')) return json({ error: 'Test market data unavailable' }, 503);
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
    await page.goto(origin + '/dashboard/' + fileName);
    await page.waitForSelector('[data-channel="retirement"]');
    if (fileName === 'v2.html') {
      expect(await page.$eval('#v2Summary .daily-change', node => node.textContent)).toContain('Daily vs');
    }
    const dailyScopes = [payload.aggregatedViews!.live, ...Object.values(payload.brokerAggregates).map(b => b.scopes.live)]
      .flatMap(scopes => Object.values(scopes).map((scope: any) => scope.dailyChanges));
    const savedMetrics = dailyScopes.map(daily => daily.metrics);
    for (const daily of dailyScopes) daily.metrics = {};
    await page.reload();
    await page.waitForFunction(() => document.getElementById('navDelta')?.textContent?.includes('Unavailable'));
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('Daily vs 22-Oct-2026');
    const visibleScope = fileName === 'v2.html' ? '#v2Summary ' : '';
    expect(await page.$eval(visibleScope + '.daily-aggregate-changes', node => node.textContent)).toContain('no comparable saved value');
    payload.dashboardConfig.showDailyChanges = false;
    await page.reload();
    await page.waitForSelector('[data-channel="retirement"]');
    expect(await page.$('.daily-change')).toBeNull();
    expect(await page.$('.daily-aggregate-changes')).toBeNull();
    for (const [index, daily] of dailyScopes.entries()) daily.metrics = savedMetrics[index];
    delete (payload.dashboardConfig as any).showDailyChanges;
    await page.reload();
    await page.waitForSelector('[data-channel="retirement"]');
    expect(await page.$('.daily-change')).toBeNull();
    expect(await page.$('.daily-aggregate-changes')).toBeNull();
    payload.dashboardConfig.showDailyChanges = true;
    await page.reload();
    await page.waitForSelector('[data-channel="retirement"]');

    expect(await page.$$('#channelPills img')).toHaveLength(0);
    expect(await page.$$eval('#channelSelect option', nodes => nodes.map(node => (node as HTMLOptionElement).value))).toEqual(['merged', 'other', 'retirement', 'savings']);
    expect(await page.$('[data-channel^="broker:"]')).toBeNull();
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$400.00');
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('+$10');
    expect(await page.$eval('.daily-aggregate-changes', node => node.textContent)).toContain('Unrealized P/L');
    await page.select('#dateSelect', '2026-10-22');
    expect(await page.$('.daily-aggregate-changes')).toBeNull();
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$999.00');
    await page.select('#dateSelect', 'live');
    await page.click('[data-channel="retirement"]');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$50.00');
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('+$10');
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('Daily vs 22-Oct-2026');
    expect(await page.$eval('#deskEyebrow', node => node.textContent)).toContain('retirement');
    expect(await page.$eval('#totalPremiumValue', node => node.textContent)).toBe('$100.00');
    expect(await page.$eval('#openOptions', node => node.textContent)).toContain('AAPL');
    expect(await page.$eval('#openOptions', node => node.textContent)).not.toContain('MSFT');
    expect(await page.$eval('#dateSelect', node => (node as HTMLInputElement).disabled)).toBe(false);
    expect(new URL(page.url()).searchParams.get('channel')).toBe('retirement');
    const beforeRefresh = requests.filter(url => url.pathname.endsWith('/dashboard')).length;
    // The post-sync path uses this same saved-data reload operation.
    await page.$eval('#dashboardRetry', node => (node as HTMLButtonElement).click());
    await expect.poll(() => requests.filter(url => url.pathname.endsWith('/dashboard')).length).toBeGreaterThan(beforeRefresh);
    await page.waitForSelector('#dashboardRetry:enabled');
    expect(await page.$eval('#channelSelect', node => (node as HTMLSelectElement).value)).toBe('retirement');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$50.00');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('channelSelect')?.value === 'retirement');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$50.00');
    await page.goto(origin + '/dashboard/' + fileName);
    await page.waitForFunction(() => document.getElementById('channelSelect')?.value === 'retirement');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$50.00');
    await page.click('#optionHistoryTab');
    await expect.poll(() => requests.some(url => url.pathname.endsWith('/option-history') && url.searchParams.get('channel') === 'retirement')).toBe(true);
    await page.waitForFunction(() => document.querySelector('#historyBroker option[value="retirement"]'));
    expect(await page.$('#historyBroker option[value^="broker:"]')).toBeNull();
    await page.click('#optionRollsTab');
    await expect.poll(() => requests.some(url => url.pathname.endsWith('/option-relationships') && url.searchParams.get('channel') === 'retirement')).toBe(true);
    await page.click('#optionOpenTab');
    await page.waitForSelector('#section01RiskTab:not(.hidden)');
    await page.click('#section01RiskTab');
    await expect.poll(() => riskScopes.some(scope => scope.length === 1 && scope.includes('retirement'))).toBe(true);
    await page.select('#channelSelect', 'other');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$175.00');
    expect(await page.$eval('#dateSelect', node => (node as HTMLInputElement).disabled)).toBe(false);
    expect(await page.$eval('#openOptions', node => node.textContent)).toContain('MSFT');
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('+$10.00');
    await page.select('#channelSelect', 'savings');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$175.00');
    expect(await page.$eval('#totalPremiumValue', node => node.textContent)).toBe('$200.00');
    expect(await page.$eval('#navDelta', node => node.textContent)).toContain('+$10.00');
    await page.select('#channelSelect', 'merged');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$400.00');
    await page.setViewport({ width: 390, height: 844 });
    await page.click('[data-channel="retirement"]');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-selected-broker-' + fileName + '.png', fullPage: true });
    // Old broker-wide URLs and stored choices fall back to all accounts.
    await page.goto(origin + '/dashboard/' + fileName + '?channel=broker:ibkr');
    await page.waitForFunction(() => document.getElementById('channelSelect')?.value === 'merged');
    expect(await page.$eval('#navValue', node => node.textContent)).toBe('$400.00');
    expect(new URL(page.url()).searchParams.has('channel')).toBe(false);
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30000);
