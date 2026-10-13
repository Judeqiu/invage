import { expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import puppeteer from 'puppeteer-core';
import { readDashboardConfig, dashboardConfig } from '../src/webapp/dashboard-config.js';

const script = readFileSync('webui/dashboard/option-timeline.js', 'utf8');
const c = { underlying: 'AMD', right: 'call', side: 'short', expiry: '2026-11-20', strike: 200, multiplier: 100, currency: 'USD' };
const episode = {
  id: 'one', broker_id: 'ibkr', channel: 'ibkr', account_id: 'A', contract: c, status: 'closed_by_fills',
  first_seen: '2026-09-01', last_seen_open: '2026-09-29', first_seen_absent: '2026-10-01',
  observations: [{ as_of: '2026-09-01', avg_price: 500, mark: 300, units: 2 }, { as_of: '2026-09-29', avg_price: 500, mark: 200, units: 2 }], events: [],
  executions: [{ execution_id: 'open', executed_at: '2026-08-28T10:00:00', effect: 'open', side: 'sell', contracts: 2, multiplier: '100', gross_premium: '600', commission: '-1.25', currency: 'USD' },
    { execution_id: 'close', executed_at: '2026-10-01T10:00:00', effect: 'close', side: 'buy', contracts: 2 }],
};
const replacement = { ...c, expiry: '2027-01-15', strike: 220 };
const relationship = { id: 'roll', channel: 'ibkr', account_id: 'A', old: c, replacement, side: 'short',
  at: '2026-10-01T10:00:00', through: '2026-10-01T10:00:00', evidence: 'possible',
  reason: '<script>bad()</script> timing only', closed_quantity: '2', opened_quantity: '2', replacement_effect: 'open' };
const groups = [{ relationships: [relationship] }];
const openEpisode = { ...episode, id: 'active', contract: replacement, status: 'open', first_seen: '2026-10-01', last_seen_open: '2026-10-12', first_seen_absent: null,
  observations: [{ as_of: '2026-10-01' }, { as_of: '2026-10-12' }], executions: [{ execution_id: 'new-open', executed_at: '2026-10-01T10:00:00', effect: 'open', side: 'sell', contracts: 2 }] };
const context = { asOf: '2026-10-12', channel: '', replay: false, positions: [], tradeDetails: {}, brokerAsOf: {} };

it('uses dated observations for hover prices and excludes later prices and fills in replay', () => {
  const window: any = {}; runInNewContext(script, { window });
  const live = window.buildOptionTimelineTracks([episode], [], context).tracks[0];
  expect(live.quote).toMatchObject({ asOf: '2026-09-29', averageCost: 500, mark: 200, units: 2, currency: 'USD' });
  expect(live.events.find((e: any) => e.id === 'fill:open').fill.gross_premium).toBe('600');
  const replay = window.buildOptionTimelineTracks([episode], [], { ...context, replay: true, asOf: '2026-09-15' }).tracks[0];
  expect(replay.quote).toMatchObject({ asOf: '2026-09-01', mark: 300 });
  expect(replay.events.some((e: any) => e.kind === 'close')).toBe(false);
  const before = window.buildOptionTimelineTracks([episode], [], { ...context, replay: true, asOf: '2026-08-29' }).tracks[0];
  expect(before.quote).toBeUndefined();
  const missing = window.buildOptionTimelineTracks([], [], { ...context, positions: [{ instrument: 'option', ticker: 'fallback', channel: 'tiger', option: c, avgCost: 0, units: 1, brokerMark: 0 }], brokerAsOf: { tiger: '2026-10-12' } }).tracks[0];
  expect(missing.quote).toMatchObject({ averageCost: 0, mark: 0 });
});

it('merges legacy Tiger positions with normalized history and groups fallback contracts by stock', () => {
  const window: any = {}; runInNewContext(script, { window });
  const tiger = { ...openEpisode, channel: 'tiger', account_id: 'T' };
  const legacy = { ...replacement, underlying: 'AMD   270115C00220000' };
  const position = { instrument: 'option', ticker: 'legacy-key', channel: 'tiger', option: legacy };
  const inputs = { ...context, positions: [position], brokerAsOf: { tiger: '2026-10-12' } };
  const before = JSON.stringify(inputs);
  const matched = window.buildOptionTimelineTracks([tiger], [], inputs);
  expect(matched.tracks).toHaveLength(1);
  expect(matched.tracks[0]).toMatchObject({ account: 'T', contract: { underlying: 'AMD' } });
  expect(JSON.stringify(inputs)).toBe(before);
  const differentStrike = { ...position, ticker: 'second', option: { ...legacy, strike: 230, underlying: 'AMD270115C230000' } };
  const fallback = window.buildOptionTimelineTracks([], [], { ...inputs, positions: [position, differentStrike] });
  expect(fallback.tracks).toHaveLength(2);
  expect(fallback.tracks.map((t: any) => t.contract.underlying)).toEqual(['AMD', 'AMD']);
  expect(fallback.tracks.map((t: any) => t.contract.strike)).toEqual([220, 230]);
  const replay = window.buildOptionTimelineTracks([], [], { ...inputs, replay: true });
  expect(replay.tracks[0].contract.underlying).toBe('AMD');
  const separateAccounts = window.buildOptionTimelineTracks([tiger, { ...tiger, account_id: 'T2' }], [], context);
  expect(separateAccounts.tracks).toHaveLength(2);
  const mismatch = window.buildOptionTimelineTracks([], [], { ...inputs,
    positions: [{ ...position, option: { ...legacy, strike: 999 } }] });
  expect(mismatch.tracks[0].contract.underlying).toBe(legacy.underlying);
});

it('keeps account tracks separate, preserves evidence, and excludes future activity in replay', () => {
  const window: any = {}; runInNewContext(script, { window });
  const live = window.buildOptionTimelineTracks([episode, { ...episode, account_id: 'B' }], groups, context);
  expect(live.tracks).toHaveLength(3);
  expect(live.links[0].evidence).toBe('possible');
  const replay = window.buildOptionTimelineTracks([episode], groups, { ...context, replay: true, asOf: '2026-09-15' });
  expect(replay.links).toHaveLength(0);
  expect(replay.tracks[0].events.map((e: any) => e.kind)).toEqual(['open']);
  expect(replay.tracks[0].spans.find((s: any) => !s.projected).to).toBe('2026-09-01');
  expect(replay.tracks[0].notes.join()).not.toContain('closed');
  const beforeObservation = window.buildOptionTimelineTracks([episode], groups, { ...context, replay: true, asOf: '2026-08-29' });
  expect(beforeObservation.tracks[0].events[0].kind).toBe('open');
  expect(beforeObservation.tracks[0].notes.join()).not.toContain('2026-09-01');
  const missing = window.buildOptionTimelineTracks([], [], { ...context, positions: [{ instrument: 'option', ticker: 'AMD-call', channel: 'ibkr', option: c }] });
  expect(missing.tracks[0].events).toHaveLength(0);
  expect(missing.tracks[0].spans).toHaveLength(0);
  expect(missing.tracks[0].notes.join()).toContain('unavailable');
});

it('marks missing opening history without inventing an opening date or changing recorded events', () => {
  const window: any = {}; runInNewContext(script, { window });
  const archiveOnly = window.buildOptionTimelineTracks([], groups, context);
  expect(archiveOnly.tracks.find((t: any) => t.contract.strike === 200).unknownStart).toBe('2026-10-01');
  expect(archiveOnly.tracks.find((t: any) => t.contract.strike === 220).unknownStart).toBeNull();
  const observedOnly = { ...episode, executions: [episode.executions[1]] };
  const missing = window.buildOptionTimelineTracks([observedOnly], [], context).tracks[0];
  expect(missing.unknownStart).toBe('2026-09-01');
  expect(missing.events.some((e: any) => e.kind === 'open')).toBe(false);
  const complete = window.buildOptionTimelineTracks([episode], [], context).tracks[0];
  expect(complete.unknownStart).toBeNull();
});

it('reads saved management configuration on each use and defaults to the existing table', () => {
  expect(readDashboardConfig().optionView).toBe('open');
  const dir = join(process.env.UTARUS_DATA_ROOT!, 'config', 'agent-config');
  const file = join(dir, dashboardConfig.id + '.json');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, JSON.stringify({ option_view: 'timeline' }));
    expect(readDashboardConfig().optionView).toBe('timeline');
    writeFileSync(file, JSON.stringify({ option_view: 'rolls' }));
    expect(readDashboardConfig().optionView).toBe('rolls');
  } finally { rmSync(file, { force: true }); }
});

const executable = process.env.CHROME_BINARY || '/usr/bin/chromium';
it.skipIf(!existsSync(executable))('defaults to Open and renders timeline filters, keyboard evidence, paging, partial failures and mobile scroll', async () => {
  const root = resolve('webui'); let failRolls = false;
  const queries: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/domain/invage/dashboard') return json({ empty: true, displayName: 'Test', productProfile: 'consultant', dashboardConfig: { optionView: 'timeline' } });
    if (url.pathname.endsWith('/option-history')) {
      queries.push(url.search);
      return json({ episodes: url.searchParams.get('offset') === '100' ? [{ ...episode, id: 'put', account_id: 'B', contract: { ...c, right: 'put' }, executions: [episode.executions[1]] }, { ...episode, id: 'msft', contract: { ...c, underlying: 'MSFT' } }] : [episode, openEpisode],
        connections: [], gaps: [], history_started: true, next_offset: url.searchParams.get('offset') === '100' ? null : 100 });
    }
    if (url.pathname.endsWith('/option-relationships')) return failRolls ? json({ message: 'Archive temporarily unavailable' }, 503) : json({ groups, gaps: [], next_offset: null });
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': extname(file) === '.css' ? 'text/css' : extname(file) === '.js' ? 'text/javascript' : 'text/html' });
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 950 });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/dashboard/index.html`);
    await page.waitForFunction(() => document.querySelector('.status-line')!.textContent!.includes('Last refresh'));
    expect(await page.$eval('#optionOpenTab', e => e.getAttribute('aria-pressed'))).toBe('true');
    expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(true);
    await page.click('#optionTimelineTab');
    await page.waitForSelector('.option-timeline');
    await page.waitForFunction(() => document.getElementById('timelineStatus')!.textContent!.includes('4 contract tracks'));
    expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(false);
    expect(await page.$$('[data-timeline-group]')).toHaveLength(2);
    expect(await page.$$('[data-timeline-row]')).toHaveLength(0);
    expect(await page.$$('.timeline-roll')).toHaveLength(0);
    expect(await page.$eval('[data-timeline-group="AMD"]', e => e.getAttribute('aria-expanded'))).toBe('false');
    const requestsBeforeResize = queries.length;
    for (const width of [1800, 1400]) {
      await page.setViewport({ width, height: 950 });
      await page.waitForFunction(() => Number(document.querySelector('.option-timeline')!.getAttribute('width')) === document.querySelector('.timeline-scroll')!.clientWidth);
      expect(await page.$eval('.timeline-group-lane', e => Number(e.getAttribute('width')))).toBe(await page.$eval('.timeline-scroll', e => e.clientWidth));
    }
    await page.$eval('#timelineChart', e => { (e as HTMLElement).style.width = '90%'; });
    await page.waitForFunction(() => Number(document.querySelector('.option-timeline')!.getAttribute('width')) === document.querySelector('.timeline-scroll')!.clientWidth);
    expect(queries).toHaveLength(requestsBeforeResize);
    await page.$eval('#timelineChart', e => { (e as HTMLElement).style.width = ''; });
    await page.setViewport({ width: 1180, height: 950 });
    await page.waitForFunction(() => Number(document.querySelector('.option-timeline')!.getAttribute('width')) === Math.max(1080, document.querySelector('.timeline-scroll')!.clientWidth));
    const collapsedHeight = await page.$eval('.option-timeline', e => Number(e.getAttribute('height')));
    const collapsedTicks = await page.$$eval('.timeline-tick', es => es.map(e => e.textContent));
    await page.screenshot({ path: '/tmp/option-timeline-collapsed.png', fullPage: true });
    await page.click('[data-timeline-group="AMD"]');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(3);
    expect(await page.$eval('[data-timeline-group="AMD"]', e => e.getAttribute('aria-expanded'))).toBe('true');
    expect(await page.$eval('[data-timeline-group="MSFT"]', e => e.getAttribute('aria-expanded'))).toBe('false');
    expect(await page.$eval('.option-timeline', e => Number(e.getAttribute('height')))).toBeGreaterThan(collapsedHeight);
    expect(await page.$$eval('.timeline-tick', es => es.map(e => e.textContent))).toEqual(collapsedTicks);
    await page.hover('[data-timeline-row="0"] .timeline-event.open');
    const hoverText = await page.$eval('#optionTimelineTooltip', e => e.textContent);
    expect(hoverText).toContain('Sell to open / unit');
    expect(hoverText).toContain('USD 3.00');
    expect(hoverText).toContain('USD 500.00');
    expect(hoverText).toContain('USD 200.00');
    expect(hoverText).toContain('2026-09-29');
    expect(hoverText).toContain('Recorded prices; live bid/ask unavailable.');
    await page.screenshot({ path: '/tmp/option-timeline-hover.png', fullPage: true });
    await page.keyboard.press('Escape');
    expect(await page.$eval('#optionTimelineTooltip', e => (e as HTMLElement).hidden)).toBe(true);
    await page.$eval('[data-timeline-group="AMD"]', e => (e as SVGElement).focus()); await page.keyboard.press(' ');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(0);
    expect(await page.$$('.timeline-roll')).toHaveLength(0);
    expect(await page.$eval('.option-timeline', e => Number(e.getAttribute('height')))).toBe(collapsedHeight);
    await page.hover('[data-timeline-price-track="0"][data-timeline-event="fill:open"]');
    expect(await page.$eval('#optionTimelineTooltip', e => e.textContent)).toContain('USD 3.00');
    await page.mouse.move(0, 0);
    await page.keyboard.press('Enter');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(3);
    await page.click('#timelineExpand');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(4);
    expect(await page.$eval('#timelineExpand', e => (e as HTMLButtonElement).disabled)).toBe(true);
    expect(await page.$$eval('.timeline-roll.possible', es => es.length)).toBe(1);
    expect(await page.$$('.timeline-unknown-start')).toHaveLength(1);
    expect(await page.$eval('.timeline-unknown-start line', e => Number(e.getAttribute('x2')) - Number(e.getAttribute('x1')))).toBeGreaterThan(40);
    expect(queries.some(q => q.includes('offset=100'))).toBe(true);
    await page.$eval('[data-timeline-row="0"]', e => (e as SVGElement).focus()); await page.keyboard.press('Enter');
    expect(await page.$eval('#timelineDetail', e => e.textContent)).toContain('<script>bad()</script>');
    expect(await page.$$('#timelineDetail script')).toHaveLength(0);
    await page.select('#timelineRight', 'put'); expect(await page.$$('[data-timeline-row]')).toHaveLength(1);
    await page.$eval('[data-timeline-row="0"]', e => (e as SVGElement).focus()); await page.keyboard.press('Enter');
    expect(await page.$eval('#timelineDetail', e => e.textContent)).toContain('Earlier history unavailable.');
    await page.type('#timelineSearch', 'MISSING'); expect(await page.$eval('#timelineChart', e => e.textContent)).toContain('No option records');
    await page.$eval('#timelineSearch', e => { (e as HTMLInputElement).value = ''; e.dispatchEvent(new Event('input')); });
    await page.select('#timelineRight', '');
    expect(await page.$$eval('[data-timeline-group]', es => es.every(e => e.getAttribute('aria-expanded') === 'true'))).toBe(true);
    await page.click('#timelineCollapse');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(0);
    expect(await page.$eval('#timelineCollapse', e => (e as HTMLButtonElement).disabled)).toBe(true);
    await page.click('#timelineExpand');
    await page.screenshot({ path: '/tmp/option-timeline-desktop.png', fullPage: true });
    for (const width of [320, 375, 768]) {
      await page.setViewport({ width, height: 900 });
      expect(await page.$eval('#optionTimelinePanel', e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await page.waitForFunction(() => Number(document.querySelector('.option-timeline')!.getAttribute('width')) === 1080);
      await page.$eval('[data-timeline-row="0"]', e => (e as SVGElement).focus());
      const bounds = await page.$eval('#optionTimelineTooltip', e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(900);
      await page.keyboard.press('Escape');
    }
    await page.setViewport({ width: 375, height: 900 });
    await page.screenshot({ path: '/tmp/option-timeline-mobile.png', fullPage: true });
    failRolls = true; await page.click('#timelineRefresh');
    await page.waitForFunction(() => document.getElementById('timelineStatus')!.textContent!.includes('Partial timeline'));
    expect(await page.$$('.option-timeline')).toHaveLength(1);
    failRolls = false; await page.click('#timelineRefresh');
    await page.waitForFunction(() => !document.getElementById('timelineStatus')!.textContent!.includes('Partial timeline') && document.querySelector('.timeline-roll'));
    await page.click('#optionOpenTab'); expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(true);
    expect(errors).toEqual([]);
    expect(await page.$eval('#status', e => e.classList.contains('error'))).toBe(false);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 30_000);
