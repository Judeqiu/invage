import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { readDashboardConfig, dashboardConfig } from '../src/webapp/dashboard-config.js';

it('reads saved management configuration on each use and defaults to the existing table', () => {
  expect(readDashboardConfig().optionView).toBe('open');
  expect(readDashboardConfig().showTotalPremium).toBe(true);
  const dir = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
  const file = join(dir, dashboardConfig.id + '.json');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, JSON.stringify({ option_view: 'timeline', show_total_premium: false }));
    expect(readDashboardConfig().optionView).toBe('timeline');
    expect(readDashboardConfig().showTotalPremium).toBe(false);
    writeFileSync(file, JSON.stringify({ option_view: 'rolls' }));
    expect(readDashboardConfig().optionView).toBe('rolls');
    expect(readDashboardConfig().showTotalPremium).toBe(true);
  } finally { rmSync(file, { force: true }); }
});

const executable = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executable))('opens on Open even with a saved Timeline preference and preserves manual selection on refresh', async () => {
  const root = resolve('webui');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname.endsWith('/dashboard')) return json({ empty: true, displayName: 'Test', productProfile: 'consultant', dashboardConfig: { optionView: 'timeline' } });
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
    await page.click('#refreshBtn');
    await page.waitForFunction(() => !(document.getElementById('refreshBtn') as HTMLButtonElement).disabled);
    expect(await page.$eval('#optionOpenTab', e => e.getAttribute('aria-pressed'))).toBe('true');
    await page.click('#optionTimelineTab');
    await page.click('#refreshBtn');
    await page.waitForFunction(() => !(document.getElementById('refreshBtn') as HTMLButtonElement).disabled);
    expect(await page.$eval('#optionTimelineTab', e => e.getAttribute('aria-pressed'))).toBe('true');
    await page.click('#optionOpenTab');
    expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
});
