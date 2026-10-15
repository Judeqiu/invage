import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { readDashboardConfig, dashboardConfig } from '../src/webapp/dashboard-config.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';

it('reads saved management configuration on each use and defaults to the existing table', () => {
  expect(readDashboardConfig().optionView).toBe('open');
  expect(readDashboardConfig().showTotalPremium).toBe(true);
  expect(readDashboardConfig().showRealizedPnl).toBe(true);
  expect(readDashboardConfig().showRecordedPnlByMonth).toBe(false);
  const dir = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
  const file = join(dir, dashboardConfig.id + '.json');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, JSON.stringify({ option_view: 'timeline', show_total_premium: false, show_realized_pnl: false, show_recorded_pnl_by_month: true }));
    expect(readDashboardConfig().optionView).toBe('timeline');
    expect(readDashboardConfig().showTotalPremium).toBe(false);
    expect(readDashboardConfig().showRealizedPnl).toBe(false);
    expect(readDashboardConfig().showRecordedPnlByMonth).toBe(true);
    writeFileSync(file, JSON.stringify({ option_view: 'rolls' }));
    expect(readDashboardConfig().optionView).toBe('rolls');
    expect(readDashboardConfig().showTotalPremium).toBe(true);
    expect(readDashboardConfig().showRealizedPnl).toBe(true);
    expect(readDashboardConfig().showRecordedPnlByMonth).toBe(false);
  } finally { rmSync(file, { force: true }); }
});

const executable = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executable))('opens on Open without date or refresh controls and allows switching to Timeline', async () => {
  const root = resolve('webui');
  let dashboard: Record<string, unknown> = { empty: true, displayName: 'Test', productProfile: 'consultant', dashboardConfig: { optionView: 'timeline' } };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith('/dashboard')) return json(dashboard);
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], history_started: false, next_offset: null });
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html' });
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard/index.html`);
    await page.waitForFunction(() => document.querySelector('.status-line')!.textContent!.includes('Last refresh'));
    expect(await page.$eval('#optionOpenTab', e => e.getAttribute('aria-pressed'))).toBe('true');
    expect(await page.$('#optionTimelineTab')).not.toBeNull();
    expect(await page.$('#autoRefresh')).toBeNull();
    for (const id of ['dateInput', 'datePrev', 'dateNext', 'dateLatest', 'refreshBtn']) {
      expect(await page.$('#' + id)).toBeNull();
    }
    await page.click('#optionTimelineTab');
    expect(await page.$eval('#optionTimelineTab', e => e.getAttribute('aria-pressed'))).toBe('true');
    await page.click('#optionOpenTab');
    expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(true);
    dashboard = {
      empty: false, displayName: 'Test', productProfile: 'consultant', generatedAt: '2026-09-16T10:00:00Z',
      model: buildDashboardModel(buildLivePositions({ AAPL: { avg_price: 100, units: 10, channel: 'ibkr', currency: 'USD' } }, { AAPL: 120 }), []),
      premiumJournal: { channels: ['ibkr'], available: true, daily: [] },
      optionAnalytics: { executions: [], gaps: [], profits: [{ channel: 'ibkr', date: '2026-09-10', currency: 'USD', gross: 350, net: 348 }] },
    };
    await page.reload();
    await page.waitForSelector('#realizedPnlCard:not(.hidden)');
    expect(await page.$eval('#realizedPnlValue', e => e.textContent)).toContain('348');
    expect(await page.$eval('#realizedPnlMeta', e => e.textContent)).toContain('After reported fees');
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-earned-premium-mobile.png', fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.screenshot({ path: '/tmp/invage-earned-premium-desktop.png', fullPage: true });
    dashboard.dashboardConfig = { showRealizedPnl: false };
    await page.reload();
    await page.waitForSelector('#loading.hidden');
    expect(await page.$eval('#realizedPnlCard', e => e.classList.contains('hidden'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
});
