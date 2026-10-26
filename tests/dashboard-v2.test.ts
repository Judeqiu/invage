import { withPageProjections } from './helpers/portfolio-projection.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dashboardConfig, readDashboardConfig } from '../src/webapp/dashboard-config.js';
import { createInvageWebUi } from '../src/webapp/invage-webui.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';

it('switches the dashboard route from management without replacing other dashboard settings', () => {
  const dir = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
  const file = join(dir, dashboardConfig.id + '.json');
  mkdirSync(dir, { recursive: true });
  const route = () => createInvageWebUi().routes!.find(r => r.path === '/dashboard');
  try {
    expect(readDashboardConfig().dashboardVersion).toBe('v1');
    expect(route()?.iframeSrc).toContain('/dashboard/index.html');
    writeFileSync(file, JSON.stringify({ dashboard_version: 'v2', option_view: 'history', show_total_premium: false }));
    expect(readDashboardConfig()).toMatchObject({ dashboardVersion: 'v2', optionView: 'history', showTotalPremium: false });
    expect(route()?.iframeSrc).toContain('/dashboard/v2.html');
    writeFileSync(file, JSON.stringify({ dashboard_version: 'v1' }));
    expect(route()?.iframeSrc).toContain('/dashboard/index.html');
  } finally { rmSync(file, { force: true }); }
});

const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath))('renders V2 with shared data, clarifies multi-number Explain, filters, and fits mobile', async () => {
  const root = resolve('webui');
  const prompts: string[] = [];
  const dashboard: any = {
    empty: false, displayName: 'Test', productProfile: 'consultant', generatedAt: '2026-10-20T10:00:00Z',
    brokerAsOf: { ibkr: '2026-10-20', tiger: '2026-10-20' },
    dashboardConfig: { dashboardVersion: 'v2', showTotalPremium: true, showRealizedPnl: true },
    model: buildDashboardModel(buildLivePositions({
      AAPL: { avg_price: 100, units: 10, channel: 'ibkr', currency: 'USD' },
      MSFT: { avg_price: 200, units: 10, channel: 'tiger', currency: 'USD' },
    }, { AAPL: 120, MSFT: 220 }), []),
    premiumJournal: { channels: ['ibkr', 'tiger'], available: true, daily: [
      { date: '2026-10-20', channel: 'ibkr', currency: 'USD', gross_premium: 250 },
      { date: '2026-10-20', channel: 'tiger', currency: 'USD', gross_premium: 150 },
    ] },
    optionAnalytics: { executions: [], gaps: [], profits: [
      { date: '2026-10-20', channel: 'ibkr', currency: 'USD', net: 90, gross: 100 },
      { date: '2026-10-10', channel: 'tiger', currency: 'USD', net: 180, gross: 200 },
    ] },
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(withPageProjections(body))); };
    if (url.pathname === '/shell') return res.end('<body style="margin:0;background:#10131c"><iframe src="/dashboard/v2.html" style="display:block;width:100%;height:100vh;border:0"></iframe>');
    if (url.pathname.endsWith('/dashboard')) return json(dashboard);
    if (url.pathname.endsWith('/dashboard-cache')) return json({});
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], history_started: false, next_offset: null });
    if (url.pathname === '/api/chat/messages') {
      let body = ''; for await (const chunk of req) body += chunk;
      prompts.push(JSON.parse(body).text);
      return json({ conversationId: 'explain-v2', turnId: 'turn-v2' });
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true);
    page.on('request', req => req.url().startsWith(origin) ? req.continue() : req.abort());
    await page.setViewport({ width: 1440, height: 1100 });
    await page.goto(origin + '/shell');
    const frame = page.frames().find(f => f.url().includes('/dashboard/v2.html'))!;
    await frame.waitForSelector('#v2Summary .section-explain');
    const labels = await frame.$$eval('#v2Summary > section > h2', nodes => nodes.map(n => n.childNodes[0].textContent));
    expect(labels).toEqual(['Premium & earnings', 'Account value', 'Cash & exposure']);
    expect(await frame.$eval('#v2Summary', n => n.textContent)).toContain('$3,400.00');
    const earned = '#v2Summary .v2-earnings .metric-card:nth-child(2)';
    expect(await frame.$$eval(earned + ' .metric-value', nodes => nodes.map(n => n.textContent))).toEqual(['$90', '$270', '$270.00']);
    await frame.click('.v2-earnings .section-explain');
    await frame.waitForSelector('#explainChoice[open]');
    expect(prompts).toHaveLength(0);
    await frame.select('#explainMetric', '1');
    await frame.click('#explainChoice button[value="explain"]');
    await expect.poll(() => prompts.length).toBe(1);
    expect(prompts[0]).toContain('Selected figure to explain: Net premium · MTD');
    await frame.click('.v2-earnings .section-explain');
    await frame.waitForSelector('#explainChoice[open]');
    await page.keyboard.press('Escape');
    expect(prompts).toHaveLength(1);
    await frame.click('#channelPills [data-channel="ibkr"]');
    expect(await frame.$eval('#v2Summary', n => n.textContent)).toContain('$1,200.00');
    expect(await frame.$$eval(earned + ' .metric-value', nodes => nodes.map(n => n.textContent))).toEqual(['$90', '$90', '$90.00']);
    await frame.click('#channelPills [data-channel="merged"]');
    dashboard.model = buildDashboardModel(buildLivePositions({
      AAPL: { avg_price: 100, units: 100, channel: 'ibkr', currency: 'USD' },
      'AAPL-P-110': { instrument: 'option', avg_price: 350, units: 2, channel: 'ibkr', currency: 'USD',
        option: { right: 'put', side: 'short', strike: 110, expiry: '2026-11-20', multiplier: 100, underlying: 'AAPL', settlement: 'physical', mark: 150 } },
      'MSFT-P-230': { instrument: 'option', avg_price: 600, units: 1, channel: 'tiger', currency: 'USD',
        option: { right: 'put', side: 'short', strike: 230, expiry: '2026-11-20', multiplier: 100, underlying: 'MSFT', settlement: 'physical', mark: 1200 } },
      'AAPL-C-130': { instrument: 'option', avg_price: 240, units: 1, channel: 'ibkr', currency: 'USD',
        option: { right: 'call', side: 'short', strike: 130, expiry: '2026-12-18', multiplier: 100, underlying: 'AAPL', settlement: 'physical', mark: 100 } },
    }, { AAPL: 120, MSFT: 220 }), []);
    dashboard.equityPrices = { AAPL: 120, MSFT: 220 };
    for (const position of dashboard.model.live.positions) {
      if (position.option) position.probabilityQuote = { mark: position.option.mark, spot: dashboard.equityPrices[position.option.underlying], spotAsOf: dashboard.generatedAt };
    }
    dashboard.optionAnalytics.executions = [{ channel: 'ibkr', account_id: 'A', underlying: 'AAPL', executed_at: '2026-10-20', currency: 'USD', gross_premium: 250, commission: -1 }];
    await frame.goto(origin + '/dashboard/v2.html');
    await frame.waitForSelector('#expiryTable .risk-table');
    await frame.waitForSelector('#openOptions .option-ledger');
    expect(await frame.$eval('#expiryRow', n => n.textContent)).toContain('$23,000');
    expect(await frame.$eval('#openOptions', n => n.textContent)).toContain('AAPL');
    expect(await frame.$$eval('#premiumEngine > .metric-card', nodes => nodes.length)).toBe(4);
    expect(await frame.$('#openPremiumExpiryCard .bar-fill')).not.toBeNull();
    expect(await frame.$('#premiumConcentrationCard .bar-fill')).not.toBeNull();
    expect(await frame.$('#openPnlExpiryCard .bar-fill.down')).not.toBeNull();
    expect(await frame.$('.premium-history')).toBeNull();
    expect(await frame.$eval('#v2Summary', n => n.textContent)).toContain('Net risk capital');
    expect(await frame.$eval('#v2Summary', n => n.textContent)).not.toContain('Daily aggregate changes');
    expect(await frame.$eval('#v2Summary', n => n.textContent)).toContain('Brokerage fees · Total');
    expect(await frame.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('Nov 2026');
    expect(await frame.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('$1,300.00');
    expect(await frame.$eval('#openPnlExpiryCard', n => n.textContent)).toContain('-$200.00');
    expect(await frame.$eval('#openPremiumUnderlyingCard', n => n.textContent)).toContain('$940.00');
    await frame.click('#channelPills [data-channel="ibkr"]');
    expect(await frame.$eval('#openPremiumExpiryCard', n => n.textContent)).toContain('$700.00');
    await frame.click('#channelPills [data-channel="merged"]');

    await frame.click('#expiryTitle .section-explain');
    await frame.waitForSelector('#explainChoice[open]');
    expect(await frame.$eval('#explainMetric', node => node.textContent)).toContain('Spot — 220.00');
    await frame.click('#explainChoice button[value="cancel"]');
    expect(prompts).toHaveLength(1);
    const preview = await browser.newPage();
    await preview.setRequestInterception(true);
    preview.on('request', req => req.url().startsWith(origin) ? req.continue() : req.abort());
    await preview.setViewport({ width: 1440, height: 1100 });
    await preview.goto(origin + '/dashboard/v2.html');
    await preview.waitForSelector('#openOptions .option-ledger');
    await preview.screenshot({ path: '/tmp/invage-dashboard-v2-desktop.png', fullPage: true });
    await (await preview.$('#premiumBlock'))!.screenshot({ path: '/tmp/invage-premium-engine-desktop.png' });
    for (const width of [390, 768, 1100]) {
      await page.setViewport({ width, height: 900 });
      expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await frame.$$eval('#premiumEngine > .metric-card', cards => cards.every(card => {
        const caption = card.querySelector('.bar-caption')!.getBoundingClientRect();
        const explain = card.querySelector('.card-explain')!.getBoundingClientRect();
        return caption.bottom <= explain.top;
      }))).toBe(true);
    }
    await page.setViewport({ width: 390, height: 844 });
    await preview.setViewport({ width: 390, height: 844 });
    await preview.screenshot({ path: '/tmp/invage-dashboard-v2-mobile.png', fullPage: true });
    await (await preview.$('#premiumBlock'))!.screenshot({ path: '/tmp/invage-premium-engine-mobile.png' });
    await preview.close();
    dashboard.dashboardConfig.showTotalPremium = false;
    dashboard.dashboardConfig.showRealizedPnl = false;
    await frame.goto(origin + '/dashboard/v2.html');
    await frame.waitForSelector('#v2Summary .section-explain');
    expect(await frame.$eval('#v2Summary', n => n.textContent)).not.toContain('Earned premium');
    expect(await frame.$$eval('.v2-premium-card .v2-stat', nodes => nodes.length)).toBe(2);
    dashboard.empty = true; dashboard.model = null;
    await frame.goto(origin + '/dashboard/v2.html'); await frame.waitForSelector('#dashboard:not(.hidden)');
    expect(await frame.$eval('#v2Summary', n => n.textContent)).toContain('Cash available');
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 30000);
