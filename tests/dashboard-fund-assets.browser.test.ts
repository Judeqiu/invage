import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { withPageProjections } from './helpers/portfolio-projection.js';

const chrome = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(chrome))('shows each available account fund value and one combined total without double counting', async () => {
  const fund = (channel: string, currency: string, units: number, mark: number) => ({
    instrument: 'fund' as const, channel, currency, units, avg_price: mark,
    fund: { quote_source: 'manual' as const, mark },
  });
  const live = buildLivePositions({
    'USD-FUND@tiger': fund('tiger', 'USD', 498169.3975, 1.20185),
    'SGD-FUND@tiger': fund('tiger', 'SGD', 207795.738, 1.06803),
    'FUND@ibkr': fund('ibkr', 'USD', 20, 3),
    'FUND@webull-fund': fund('webull-fund', 'USD', 8, 4),
    // The aggregate for this account must replace its itemized value.
    'FUND@moomoo': fund('moomoo', 'USD', 10, 10),
    'SHARES@webull': { channel: 'webull', currency: 'USD', units: 1, avg_price: 1 },
  }, { SHARES: 2 }, undefined, [], [], undefined, { reportingCurrency: 'USD', fxRates: { SGD: 0.78 } });
  const connectionMetrics = {
    moomoo: { as_of: '2026-11-10', currency: 'USD', fund_assets: 827984.3081 },
    futubull: { as_of: '2026-11-10', currency: 'SGD', fund_assets: 2000 },
    zero: { as_of: '2026-11-10', currency: 'USD', fund_assets: 0 },
  };
  const payload = withPageProjections({ empty: false, displayName: 'Fund accounts',
    generatedAt: '2026-11-10T06:20:00Z', connectionMetrics,
    dashboardConfig: { dashboardVersion: 'v2' }, model: buildDashboardModel(live, []),
    premiumJournal: { available: true, channels: [], daily: [] },
    optionAnalytics: { executions: [], gaps: [], profits: [] },
  });
  const root = resolve('webui');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (url.pathname.endsWith('/dashboard')) return json(payload);
    if (url.pathname.endsWith('/dashboard-cache') || url.pathname.endsWith('/broker-sync')) return json(null);
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], next_offset: null });
    const file = resolve(root, '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin) ? request.continue() : request.abort());
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(origin + '/dashboard/v2.html');
    await page.waitForSelector('#v2Summary .metric-card');
    const card = () => page.$eval('#v2Summary', node => [...node.querySelectorAll('.metric-card')]
      .filter(card => card.querySelector('.label-eyebrow')?.textContent === 'Fund assets')
      .map(card => ({ value: card.querySelector('.metric-value')?.textContent, text: card.textContent })));
    const tiger = live.positions.filter(p => p.channel === 'tiger').reduce((sum, p) => sum + p.value, 0);
    const total = tiger + 60 + 32 + connectionMetrics.moomoo.fund_assets + connectionMetrics.futubull.fund_assets * live.fxRates!.SGD!;
    const format = (amount: number) => '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect((await card()).map(c => c.value)).toEqual([format(total)]);
    expect((await card())[0].text).toContain('Some accounts unavailable');
    const nav = await page.$eval('#navValue', n => n.textContent);
    for (const [channel, expected] of [['tiger', tiger], ['ibkr', 60], ['moomoo', connectionMetrics.moomoo.fund_assets], ['webull-fund', 32], ['webull', null]] as const) {
      await page.select('#channelSelect', channel);
      expect((await card()).map(c => c.value)).toEqual([expected == null ? '—' : format(expected)]);
    }
    await page.select('#channelSelect', 'merged');
    expect(await page.$eval('#navValue', n => n.textContent)).toBe(nav);
    await page.screenshot({ path: '/tmp/velovest-fund-assets-all.png', fullPage: true });
    await page.select('#channelSelect', 'tiger');
    await page.screenshot({ path: '/tmp/velovest-fund-assets-tiger.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    // Exercise source absence, signed/zero totals, missing FX and saved dates through the same native helper.
    const edgeCases = await page.evaluate(() => {
      const summarize = (globalThis as any).fundAssetsSummary;
      const view = { reportingCurrency: 'USD', channels: ['a'], positions: [
        { channel: 'a', instrument: 'fund', currency: 'USD', value: 40 },
      ], fxRates: {} };
      const metric = (amount: number, currency = 'USD') => ({ connectionMetrics: { a: { currency, fund_assets: amount } } });
      return {
        zero: summarize(metric(0), view).amount,
        negative: summarize(metric(-12.5), view).amount,
        noFx: summarize(metric(20, 'SGD'), view).amount,
        missing: summarize({}, { ...view, positions: [] }).amount,
        historical: summarize(metric(999), view, 'all', false).amount,
        invalidLot: summarize({}, { ...view, positions: [...view.positions, { channel: 'a', instrument: 'fund', currency: 'SGD', value: 30 }] }).amount,
        nativeFx: summarize(metric(20, 'SGD'), { ...view, fxRates: { SGD: 0.75 } }).amount,
      };
    });
    expect(edgeCases).toEqual({ zero: 0, negative: -12.5, noFx: null, missing: null, historical: 40, invalidLot: null, nativeFx: 15 });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(origin + '/insights/?channel=tiger');
    await page.waitForFunction(() => document.getElementById('metrics')?.textContent?.includes('Fund assets'));
    expect(await page.$eval('#metrics', n => n.textContent)).toContain(format(tiger));
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
}, 60000);
