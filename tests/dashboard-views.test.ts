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
    await page.waitForFunction(() => document.getElementById('loadProgress')!.getAttribute('aria-valuenow') === '8');
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

it.skipIf(!existsSync(executable))('explains dashboard cards in side chat with the displayed values and reuses conversations', async () => {
  const root = resolve('webui');
  const prompts: { text: string; composeSource: { kind: string } }[] = [];
  let failChat = true;
  let delayChats = false;
  const waitingChats: (() => void)[] = [];
  const dashboard = {
    empty: false, displayName: 'Test', generatedAt: '2026-10-15T10:00:00Z',
    brokerAsOf: { ibkr: '2026-10-14' },
    model: buildDashboardModel(buildLivePositions({ AAPL: { avg_price: 100, units: 10, channel: 'ibkr', currency: 'USD' } }, { AAPL: 120 }), []),
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/shell') return res.end('<iframe src="/dashboard/index.html" style="width:100%;height:95vh"></iframe><script>window.messages=[];addEventListener("message",e=>messages.push(e.data))</script>');
    if (url.pathname.endsWith('/dashboard')) return json(dashboard);
    if (url.pathname === '/api/chat/messages') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      prompts.push(JSON.parse(raw));
      if (delayChats) await new Promise<void>(resolve => waitingChats.push(resolve));
      res.statusCode = failChat ? 503 : 200;
      return json(failChat ? { message: 'Try again' } : { conversationId: `explain-${prompts.length}` });
    }
    if (url.pathname.endsWith('/option-history')) return json({ episodes: [], connections: [], gaps: [], next_offset: null });
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html');
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/shell`);
    const frame = page.frames().find(f => f.url().includes('/dashboard/'))!;
    const selector = '.hero-metrics [data-card-explain]';
    await frame.waitForSelector(selector);
    expect(await frame.$$eval('.hero-metrics .metric-card, #kpiRow .metric-card', cards => cards.every(card => card.querySelectorAll('[data-card-explain]').length === 1))).toBe(true);
    const value = await frame.$eval('#navValue', e => e.textContent!);
    await frame.focus(selector); await page.keyboard.press('Enter');
    await frame.waitForFunction(() => document.getElementById('optionChatStatus')?.textContent?.includes('Try again'));
    expect(await page.evaluate(() => (window as any).messages.some((m: any) => m.type === 'utarus:chat-panel:error'))).toBe(true);
    failChat = false;
    await page.evaluate(() => {
      const messages = (window as any).messages;
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:retry', requestId: messages.find((m: any) => m.type === 'utarus:chat-panel:open').requestId }, location.origin);
    });
    await page.waitForFunction(() => (window as any).messages.some((m: any) => m.type === 'utarus:chat-panel:ready'));
    expect(prompts).toHaveLength(2);
    expect(prompts[1].text).toContain(value);
    expect(prompts[1].text).toContain('Net asset value (NAV)');
    expect(prompts[1].text).toContain('All brokers (merged)');
    expect(prompts[1].text).toContain(dashboard.generatedAt);
    expect(prompts[1].text).toContain('2026-10-14');
    expect(prompts[1].text).toContain('Calculation notes:');
    expect(prompts[1].composeSource.kind).toBe('host_seed');
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:closed' }, location.origin));
    await frame.waitForFunction(() => document.activeElement?.hasAttribute('data-card-explain'));
    await frame.click(selector);
    expect(prompts).toHaveLength(2);
    await frame.click('#channelPills [data-channel="ibkr"]');
    await frame.click(selector);
    await frame.waitForFunction(() => document.querySelector('.hero-metrics [data-card-explain]')?.textContent === 'Explain');
    expect(prompts).toHaveLength(3);
    expect(prompts[2].text).toContain('Selected dashboard: ibkr');
    delayChats = true;
    const firstCard = '#kpiRow .metric-card:nth-child(1) [data-card-explain]';
    const secondCard = '#kpiRow .metric-card:nth-child(2) [data-card-explain]';
    await frame.click(firstCard);
    await frame.click(secondCard);
    await frame.waitForFunction(() => document.querySelectorAll('[data-card-explain]:disabled').length === 2);
    await expect.poll(() => waitingChats.length).toBe(2);
    expect(prompts).toHaveLength(5);
    expect(await frame.$eval('.hero-metrics [data-card-explain]', button => (button as HTMLButtonElement).disabled)).toBe(false);
    delayChats = false; waitingChats.splice(0).forEach(resolve => resolve());
    await frame.waitForFunction(() => document.querySelectorAll('[data-card-explain]:disabled').length === 0);
    await page.evaluate(() => {
      const opens = (window as any).messages.filter((m: any) => m.type === 'utarus:chat-panel:open');
      document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:activated', requestId: opens.at(-2).requestId }, location.origin);
    });
    await frame.waitForFunction(() => document.querySelector('#kpiRow .metric-card:nth-child(1) [data-card-explain]')?.getAttribute('aria-expanded') === 'true');
    expect(await frame.$eval(secondCard, button => button.getAttribute('aria-expanded'))).toBe('false');
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:closed', minimized: true }, location.origin));
    await frame.waitForFunction(() => document.activeElement === document.querySelector('#kpiRow .metric-card:nth-child(1) [data-card-explain]'));
    await page.setViewport({ width: 390, height: 844 });
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/invage-dashboard-explain-mobile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally { waitingChats.splice(0).forEach(resolve => resolve()); await browser.close(); await new Promise<void>(r => server.close(() => r())); }
});
