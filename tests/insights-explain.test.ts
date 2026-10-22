import { withPageProjections } from './helpers/portfolio-projection.js';
import { expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { insightsFixture } from './helpers/insights-fixture.js';

const executablePath = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executablePath)).each(['index.html', 'v2.html'])('explains %s aggregates with snapshot scope, figure selection, reuse and retry', async version => {
  const root = resolve('webui'), payload = insightsFixture();
  Object.assign(payload.model.live, { totalPL: 0, totalPLPct: 0, optionCount: 3, equityCount: 2, fundCount: 0, positionCount: 5, contingentCashObligation: 12000 });
  payload.model.live.byChannel.forEach((c: any) => {
    const positions = payload.model.live.positions.filter((p: any) => p.channel === c.channel);
    Object.assign(c, { totalPL: 0, totalPLPct: 0, positionCount: positions.length, cashCurrency: 'USD',
      equityCount: positions.filter((p: any) => p.instrument === 'equity').length, fundCount: 0,
      optionCount: positions.filter((p: any) => p.instrument === 'option').length,
      contingentCashObligation: positions.reduce((sum: number, p: any) => sum + (p.contingentCashObligation || 0), 0) });
  });
  payload.model.live.positions.forEach((p: any) => p.weightPct = p.value / 25000 * 100);
  const prompts: any[] = []; let failChat = false, release: (() => void) | null = null, delay = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (value: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(withPageProjections(value))); };
    if (url.pathname === '/shell') return res.end(`<iframe src="/insights/${version}" style="width:100%;height:96vh;border:0"></iframe><script>window.messages=[];addEventListener('message',e=>messages.push(e.data))</script>`);
    if (url.pathname.endsWith('/dashboard-cache')) return json(null);
    if (url.pathname.endsWith('/dashboard')) return json(payload);
    if (url.pathname === '/api/chat/messages') {
      let body = ''; for await (const chunk of req) body += chunk;
      prompts.push(JSON.parse(body));
      if (delay) await new Promise<void>(r => release = r);
      res.statusCode = failChat ? 503 : 200;
      return json(failChat ? { message: 'Please retry' } : { conversationId: `insights-${prompts.length}` });
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'text/html'); res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(5000);
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.setRequestInterception(true); page.on('request', r => r.url().startsWith(origin) ? r.continue() : r.abort());
    await page.setViewport({ width: 1440, height: 1100 }); await page.goto(origin + '/shell');
    const frame = page.frames().find(f => f.url().includes('/insights/'))!;
    const nav = '#metrics .metric-card:first-child [data-insights-explain-button]';
    await frame.waitForSelector(nav);
    expect(prompts).toHaveLength(0);
    expect(await frame.$$eval('#metrics .metric-card', cards => cards.every(c => c.querySelectorAll('[data-insights-explain-button]').length === 1))).toBe(true);
    await frame.focus(nav); await page.keyboard.press('Enter');
    await expect.poll(() => prompts.length).toBe(1);
    await frame.waitForSelector(nav + ':enabled');
    expect(prompts[0].text).toContain('$25,000.00');
    expect(prompts[0].text).toContain('All brokers (merged)');
    expect(prompts[0].text).toContain(payload.generatedAt);
    expect(prompts[0].text).toContain('2026-10-20');
    expect(prompts[0].text).toContain('Calculation notes:');
    expect(prompts[0].composeSource).toEqual({ kind: 'host_seed' });
    await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:closed' }, location.origin));
    await frame.waitForFunction(() => document.activeElement?.hasAttribute('data-insights-explain-button'));
    await frame.click(nav); expect(prompts).toHaveLength(1);

    const multiple = version === 'v2.html' ? '#statistics .metric-card:nth-child(6) [data-insights-explain-button]' : '#edge .metric-card:nth-child(3) [data-insights-explain-button]';
    await frame.click(multiple); await frame.waitForSelector('#insightsExplainChoice[open]');
    await page.keyboard.press('Escape'); expect(prompts).toHaveLength(1);
    await frame.click(multiple); await frame.select('#insightsExplainMetric', '1'); await frame.click('#insightsExplainChoice button[value="explain"]');
    await expect.poll(() => prompts.length).toBe(2);
    expect(prompts[1].text).toContain('Selected figure to explain:');
    if (version === 'v2.html') {
      expect(prompts[1].text).toContain('Selected figure to explain: Short call lines — 2');
      const row = '#underlyings tbody tr:first-child';
      expect(await frame.$$eval(row + ' > *', ns => ns.length)).toBe(5);
      expect(await frame.$eval(row + ' th', n => n.textContent)).toBe('AAPL');
      expect(await frame.$eval(row + ' [data-insights-explain-button]', n => n.textContent)).toBe('AAPL');
      expect(await frame.$eval(row + ' [data-insights-explain-button]', n => n.getAttribute('title'))).toBe('Explain with AI');
      await frame.click(row + ' [data-insights-explain-button]'); await frame.select('#insightsExplainMetric', '3'); await frame.click('#insightsExplainChoice button[value="explain"]');
      await expect.poll(() => prompts.length).toBe(3);
      expect(prompts.at(-1).text).toMatch(/Selected figure to explain: .+ · open P&L/);
      expect(await frame.$eval(row + ' th', n => n.textContent)).toBe('AAPL');
    }
    await page.screenshot({ path: `/tmp/invage-insights-explain-${version}-desktop.png`, fullPage: true });
    for (const width of [390, 768, 1100]) {
      await page.setViewport({ width, height: 900 });
      expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await frame.$$eval('.insights-explain-card', cards => cards.every(c => {
        const b = c.querySelector('[data-insights-explain-button]')!.getBoundingClientRect();
        const content = [...c.children].filter(n => !n.hasAttribute('data-insights-explain-button'));
        return content.every(n => n.getBoundingClientRect().bottom <= b.top + 1);
      }))).toBe(true);
    }
    await page.setViewport({ width: 390, height: 844 }); await page.screenshot({ path: `/tmp/invage-insights-explain-${version}-mobile.png`, fullPage: true });
    await frame.click('[data-channel="ibkr"]'); delay = true; failChat = true;
    const before = prompts.length;
    await frame.click(nav); await frame.waitForSelector(nav + ':disabled');
    await expect.poll(() => release !== null).toBe(true);
    const retryId = await page.evaluate(() => (window as any).messages.filter((m: any) => m.type === 'utarus:chat-panel:open').at(-1).requestId);
    await frame.click('[data-channel="tiger"]');
    expect(await frame.$eval(nav, b => (b as HTMLButtonElement).disabled)).toBe(false);
    delay = false; release!(); release = null;
    await frame.waitForFunction(() => document.getElementById('insightsExplainStatus')?.textContent?.includes('Please retry'));
    failChat = false;
    await page.evaluate(id => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'utarus:chat-panel:retry', requestId: id }, location.origin), retryId);
    await expect.poll(() => prompts.length).toBe(before + 2);
    expect(prompts.at(-1).text).toContain('Selected Insights: ibkr');
    expect(prompts.at(-1).text).toContain('$9,000.00');
    await frame.waitForFunction(() => document.getElementById('insightsExplainStatus')?.textContent === '');
    await frame.click(nav); await expect.poll(() => prompts.length).toBe(before + 3);
    expect(prompts.at(-1).text).toContain('Selected Insights: tiger');
    expect(prompts.at(-1).text).toContain('$16,000.00');
    expect(errors).toEqual([]);
  } finally { release?.(); await browser.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}, 30000);
