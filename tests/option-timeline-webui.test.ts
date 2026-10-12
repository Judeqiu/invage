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
  observations: [{ as_of: '2026-09-01' }, { as_of: '2026-09-29' }], events: [],
  executions: [{ execution_id: 'open', executed_at: '2026-08-28T10:00:00', effect: 'open', side: 'sell', contracts: 2 },
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
it.skipIf(!existsSync(executable))('renders the configured default, filters, keyboard evidence, paging, partial failures and mobile scroll', async () => {
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
    await page.waitForSelector('.option-timeline');
    await page.waitForFunction(() => document.getElementById('timelineStatus')!.textContent!.includes('4 contract tracks'));
    expect(await page.$eval('#optionTimelinePanel', e => e.classList.contains('hidden'))).toBe(false);
    expect(await page.$$('[data-timeline-group]')).toHaveLength(2);
    expect(await page.$$('[data-timeline-row]')).toHaveLength(0);
    expect(await page.$$('.timeline-roll')).toHaveLength(0);
    expect(await page.$eval('[data-timeline-group="AMD"]', e => e.getAttribute('aria-expanded'))).toBe('false');
    const collapsedHeight = await page.$eval('.option-timeline', e => Number(e.getAttribute('height')));
    const collapsedTicks = await page.$$eval('.timeline-tick', es => es.map(e => e.textContent));
    await page.screenshot({ path: '/tmp/option-timeline-collapsed.png', fullPage: true });
    await page.click('[data-timeline-group="AMD"]');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(3);
    expect(await page.$eval('[data-timeline-group="AMD"]', e => e.getAttribute('aria-expanded'))).toBe('true');
    expect(await page.$eval('[data-timeline-group="MSFT"]', e => e.getAttribute('aria-expanded'))).toBe('false');
    expect(await page.$eval('.option-timeline', e => Number(e.getAttribute('height')))).toBeGreaterThan(collapsedHeight);
    expect(await page.$$eval('.timeline-tick', es => es.map(e => e.textContent))).toEqual(collapsedTicks);
    await page.$eval('[data-timeline-group="AMD"]', e => (e as SVGElement).focus()); await page.keyboard.press(' ');
    expect(await page.$$('[data-timeline-row]')).toHaveLength(0);
    expect(await page.$$('.timeline-roll')).toHaveLength(0);
    expect(await page.$eval('.option-timeline', e => Number(e.getAttribute('height')))).toBe(collapsedHeight);
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
