import { withPageProjections } from './helpers/portfolio-projection.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import type { Holding } from '../src/market/types.js';
import type { OptionExecution } from '../src/brokers/option-executions.js';
import { buildOptionRelationships, type RollFill } from '../src/brokers/option-relationships.js';
import { openOptionTradeDetails, attachLatestRollPremium } from '../src/webapp/option-dashboard-data.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';

const source = readFileSync('webui/dashboard/app.js', 'utf8');
const helpers = source.slice(source.indexOf('function optionTradeCashFlow('), source.indexOf('function openingPremiumHtml('));
const { cashFlow, total } = runInNewContext(`${helpers}\n({cashFlow:optionTradeCashFlow,total:optionTradeCashFlowTotal})`);
const trade = (extra = {}) => ({ currency: 'USD', stoGrossPremium: 1950, rollDate: '2026-10-07', rollPremium: 815, ...extra });
it('uses verified roll credits, debits and zero, never STO or fee-inclusive cash in place of an unknown roll', () => {
  expect(cashFlow(trade({ stoNetPremium: 1949 }))).toBe(815);
  expect(cashFlow(trade({ rollPremium: -50 }))).toBe(-50);
  expect(cashFlow(trade({ rollPremium: 0 }))).toBe(0);
  for (const value of [null, undefined, NaN, Infinity, '815']) expect(cashFlow(trade({ rollPremium: value }))).toBeNull();
  expect(cashFlow(trade({ rollDate: undefined, rollPremium: null }))).toBeNull();
  expect(cashFlow({ currency: 'USD', stoGrossPremium: 225 })).toBe(225);
  expect(cashFlow({ currency: 'USD', openingGrossPremium: -100 })).toBe(-100);
  expect(cashFlow(trade({ currency: null }))).toBeNull();
  expect(cashFlow(undefined)).toBeNull();
});
it('totals the displayed before-fees cash flows only when all rows and currencies reconcile', () => {
  const ordinary = { currency: 'USD', stoGrossPremium: 225 };
  expect(total([trade(), ordinary])).toEqual({ value: 1040, currency: 'USD' });
  expect(total([trade(), ordinary, trade({ rollPremium: -50 })])).toEqual({ value: 990, currency: 'USD' });
  expect(total([trade({ rollPremium: 0 })])).toEqual({ value: 0, currency: 'USD' });
  for (const rows of [[], [trade(), undefined], [trade(), trade({ rollPremium: null })], [trade(), { ...ordinary, currency: 'SGD' }]]) expect(total(rows)).toBeNull();
});

function fixture() {
  const holdings: Record<string, Holding> = {}, executions: OptionExecution[] = [], relationships = [];
  const accounts = { 'moomoo-first': 'A', 'moomoo-second': 'B' };
  for (const [channel, account] of Object.entries(accounts)) {
    holdings['avgo-' + account] = { instrument: 'option', currency: 'USD', channel, units: 1, avg_price: 1950,
      option: { underlying: 'AVGO', side: 'short', right: 'call', strike: 400, expiry: '2026-12-18', multiplier: 100, settlement: 'physical', mark: 630 } };
    const open: OptionExecution = { channel, account_id: account, execution_id: 'same-opening-id', executed_at: '2026-10-07T11:41:55',
      underlying: 'AVGO', right: 'call', strike: '400', expiry: '2026-12-18', multiplier: '100', contracts: '1', side: 'sell', effect: 'open', currency: 'USD', gross_premium: '1950', commission: null };
    const close: OptionExecution = { ...open, execution_id: 'same-closing-id', strike: '375', expiry: '2026-10-23', side: 'buy', effect: 'close', gross_premium: account === 'A' ? '-1135' : '-2000' };
    executions.push(open, close);
    const fills: RollFill[] = [open, close].map(e => ({ id: e.execution_id, order: e.execution_id, parent: 'same-parent-id', prefix: '', account,
      contract: { underlying: e.underlying, right: e.right, strike: e.strike, expiry: e.expiry, multiplier: e.multiplier, currency: e.currency },
      at: e.executed_at, clock: 'Broker', quantity: e.contracts, side: e.side, effect: e.effect, cash: e.gross_premium,
      gross_cash: e.gross_premium, basis: 'gross', terminal: false, source: { id: 'test/archive', version: '1' } }));
    relationships.push(...buildOptionRelationships('moomoo', channel, account, fills));
  }
  holdings.soxl = { ...holdings['avgo-A'], avg_price: 225, option: { ...holdings['avgo-A'].option!, underlying: 'SOXL', right: 'put', strike: 65, mark: 100 } };
  executions.push({ ...executions[0], execution_id: 'soxl-open', underlying: 'SOXL', right: 'put', strike: '65', gross_premium: '225' });
  const details = openOptionTradeDetails(holdings, executions, accounts);
  attachLatestRollPremium(holdings, details, relationships.reverse(), accounts);
  return { holdings, executions, relationships, accounts, details };
}
it('reconciles actual closing and opening legs independently for accounts with identical broker execution IDs', () => {
  const f = fixture();
  expect(f.details['avgo-A']).toMatchObject({ stoGrossPremium: 1950, rollPremium: 815, rollDate: '2026-10-07' });
  expect(f.details['avgo-B']).toMatchObject({ stoGrossPremium: 1950, rollPremium: -50 });
  expect(f.details.soxl).toMatchObject({ stoGrossPremium: 225 });
  const wrongAccount = openOptionTradeDetails({ position: f.holdings['avgo-A'] }, f.executions, { 'moomoo-first': 'B' });
  expect(wrongAccount).toEqual({});
  const wrongQuantity = openOptionTradeDetails({ position: { ...f.holdings['avgo-A'], units: 2 } }, f.executions, f.accounts);
  expect(wrongQuantity).toEqual({});
});

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome)).each(['v2.html', 'index.html'])('renders roll-aware %s rows and totals across accounts without changing position P&L', async version => {
  const root = resolve('webui'), f = fixture();
  const dashboard = { empty: false, displayName: 'Roll regression', productProfile: 'consultant', generatedAt: '2026-10-22T06:53:08Z',
    brokerAsOf: { 'moomoo-first': '2026-10-22', 'moomoo-second': '2026-10-22' },
    dashboardConfig: { dashboardVersion: version === 'v2.html' ? 'v2' : 'v1' },
    model: buildDashboardModel(buildLivePositions(f.holdings, { AVGO: 337.8, SOXL: 60 }), []), optionTradeDetails: f.details,
    premiumJournal: { channels: Object.keys(f.accounts) }, optionAnalytics: { executions: [], profits: [], gaps: [] } };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(withPageProjections(value))); };
    if (url.pathname.endsWith('/dashboard-cache')) return json(null);
    if (url.pathname.endsWith('/dashboard')) return json(dashboard);
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], next_offset: null });
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true); page.on('request', r => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.setViewport({ width: 1440, height: 1100 });
    const column = version === 'v2.html' ? 4 : 8;
    const avgo = '#openOptions .option-ledger-row[data-option-underlying="AVGO"]';
    const cell = avgo + ` td:nth-child(${column})`;
    const month = `#openOptions .option-month-total td:nth-child(${column})`;
    const load = async () => { await page.goto(origin + '/dashboard/' + version); await page.waitForSelector('#openOptions .option-ledger-row'); await page.click('#channelPills [data-channel="moomoo-first"]'); };
    await load();
    expect(await page.$eval(cell, n => n.textContent)).toBe('$815.00Latest roll');
    expect(await page.$eval(month, n => n.textContent)).toBe('$1,040.00');
    expect(await page.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('$1,040.00');
    expect(await page.$eval('#openPremiumUnderlyingCard', n => n.textContent)).toContain('$815.00');
    if (version === 'v2.html') {
      expect(await page.$eval(avgo + ' td:nth-child(5)', n => n.textContent)).toBe('19.50');
      expect(await page.$eval(avgo + ' td:nth-child(7)', n => n.textContent)).toContain('$1,320');
      expect(await page.$eval('.option-ledger thead', n => n.textContent)).toContain('PREMIUM / ROLL');
    }
    await page.click('#channelPills [data-channel="moomoo-second"]');
    expect(await page.$eval(cell, n => n.textContent)).toBe('-$50.00Latest roll');
    expect(await page.$eval(month, n => n.textContent)).toBe('-$50.00');
    expect(await page.$eval('#openPremiumUnderlyingCard', n => n.textContent)).toContain('-$50.00');
    await page.click('#channelPills [data-channel="merged"]');
    expect(await page.$eval(month, n => n.textContent)).toBe('$990.00');
    expect(await page.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('$990.00');
    f.details['avgo-A'].rollPremium = null; await load();
    expect(await page.$eval(cell, n => n.textContent)).toBe('—');
    expect(await page.$eval(month, n => n.textContent)).toBe('—');
    expect(await page.$eval(cell + ' span', n => n.getAttribute('title'))).toContain('opening premium is not substituted');
    f.details['avgo-A'].rollPremium = 0; await load();
    expect(await page.$eval(cell, n => n.textContent)).toBe('$0.00Latest roll');
    expect(await page.$eval(month, n => n.textContent)).toBe('$225.00');
    f.details['avgo-A'].rollPremium = 815; f.details['avgo-A'].currency = 'SGD'; await load();
    expect(await page.$eval(cell, n => n.textContent)).toContain('S$815.00');
    expect(await page.$eval(month, n => n.textContent)).toBe('—');
    f.details['avgo-A'].currency = 'USD'; await load();
    for (const width of [390, 768, 1440]) { await page.setViewport({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    expect(errors).toEqual([]);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}, 30000);
