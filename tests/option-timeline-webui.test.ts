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
const avgoCall = { ...c, underlying: 'AVGO', strike: 400, expiry: '2026-12-18' };
const avgoPut = { ...avgoCall, right: 'put', strike: 310, expiry: '2026-10-23' };
const avgoFill = (contract: any, id: string, at: string, side: string, effect: string) => ({
  ...contract, channel: 'moomoo', account_id: 'A', execution_id: id, executed_at: at, side, effect,
  contracts: '2', gross_premium: '100', commission: null,
});
const avgoFills = [
  avgoFill(avgoCall, 'call-open', '2026-10-07T11:41:55', 'sell', 'open'),
  avgoFill(avgoPut, 'put-open', '2026-09-04T11:32:40', 'sell', 'open'),
  avgoFill(avgoPut, 'put-close', '2026-10-05T11:05:44', 'buy', 'close'),
];
const avgoEpisode = { ...openEpisode, channel: 'moomoo', contract: avgoCall, first_seen: '2026-10-13', last_seen_open: '2026-10-13',
  observations: [{ as_of: '2026-10-13' }], executions: [avgoFills[0]] };
const avgoRelationships = [{ relationships: [{ ...relationship, channel: 'moomoo', evidence: 'review',
  old: { ...avgoPut, side: 'long', strike: 295 }, replacement: avgoPut, side: 'long',
  replacement_effect: 'close', at: '2026-10-05T11:05:44', through: '2026-10-05T11:05:44' }] }];
const avgoContext = { ...context, asOf: '2026-10-14', executions: avgoFills };

it('joins a recorded opening to a single observation and shows a historical short put through its actual close', () => {
  const window: any = {}; runInNewContext(script, { window });
  const result = window.buildOptionTimelineTracks([avgoEpisode], avgoRelationships, avgoContext);
  const call = result.tracks.find((t: any) => t.contract.strike === 400);
  expect(call.spans).toEqual([
    { from: '2026-10-07', to: '2026-10-13', projected: false, tradeEvidence: true },
    { from: '2026-10-13', to: '2026-12-18', projected: true },
  ]);
  const put = result.tracks.find((t: any) => t.contract.strike === 310);
  expect(put.side).toBe('short');
  expect(put.spans).toEqual([{ from: '2026-09-04', to: '2026-10-05', projected: false, tradeEvidence: true }]);
  expect(put.events.some((e: any) => e.kind === 'unknown')).toBe(false);
  expect(put.notes.join()).toContain('a replacement opening is not established');
  expect(result.tracks.filter((t: any) => t.contract.strike === 310)).toHaveLength(1);
  const replay = window.buildOptionTimelineTracks([], [], { ...avgoContext, replay: true, asOf: '2026-09-15' });
  expect(replay.tracks).toHaveLength(1);
  expect(replay.tracks[0].events.map((e: any) => e.kind)).toEqual(['open']);
  expect(replay.tracks[0].spans[0].to).toBe('2026-09-15');
  const withPosition = window.buildOptionTimelineTracks([], [], { ...avgoContext,
    executions: [avgoFills[0]], brokerAsOf: { moomoo: '2026-10-13' },
    positions: [{ instrument: 'option', ticker: 'AVGO-call', channel: 'moomoo', currency: 'USD', option: avgoCall }],
  });
  expect(withPosition.tracks).toHaveLength(1);
  expect(withPosition.tracks[0].account).toBe('A');
  expect(withPosition.tracks[0].spans[0]).toMatchObject({ from: '2026-10-07', to: '2026-10-13', projected: false });
});

it('keeps partial closes within their matched trade interval and leaves unknown opening history unfilled', () => {
  const window: any = {}; runInNewContext(script, { window });
  const partial = { ...avgoFills[2], contracts: '1' };
  const result = window.buildOptionTimelineTracks([], [], { ...avgoContext, executions: [avgoFills[1], partial,
    { ...partial, execution_id: 'final-close', executed_at: '2026-10-08T10:00:00' }] });
  expect(result.tracks[0].spans).toEqual([{ from: '2026-09-04', to: '2026-10-08', projected: false, tradeEvidence: true }]);
  const missing = window.buildOptionTimelineTracks([], [], { ...avgoContext, executions: [avgoFills[2]] });
  expect(missing.tracks[0].spans).toEqual([]);
  expect(missing.tracks[0].unknownStart).toBe('2026-10-05');
});

it('draws a trade-based expiry guide for an unobserved latest replacement without treating it as a holding', () => {
  const window: any = {}; runInNewContext(script, { window });
  const build = (episodes = [], relationships = [relationship], overrides = {}) =>
    window.buildOptionTimelineTracks(episodes, [{ relationships }], { ...context, ...overrides });
  const latest = build().tracks.find((t: any) => t.contract.strike === 220);
  expect(latest.spans).toEqual([{ from: '2026-10-01', to: replacement.expiry, projected: true, tradeEvidence: true }]);
  expect(latest.quote).toBeUndefined();
  expect(latest.notes).toEqual([]);
  expect(build().tracks.find((t: any) => t.contract.strike === 200).spans).toEqual([]);
  expect(build([], [{ ...relationship, replacement_effect: 'unknown' }]).tracks.every((t: any) => !t.spans.length)).toBe(true);
  expect(build([], [relationship], { replay: true, asOf: '2026-09-30' }).tracks).toEqual([]);
  const observed = window.buildOptionTimelineTracks([openEpisode], groups, context).tracks.find((t: any) => t.contract.strike === 220);
  expect(observed.spans).toEqual([
    { from: '2026-10-01', to: '2026-10-12', projected: false, tradeEvidence: true },
    { from: '2026-10-12', to: replacement.expiry, projected: true },
  ]);
  const closed = { ...openEpisode, observations: [], executions: [...openEpisode.executions,
    { execution_id: 'new-close', executed_at: '2026-10-06', effect: 'close', side: 'buy', contracts: 2 }] };
  expect(window.buildOptionTimelineTracks([closed], groups, context).tracks.find((t: any) => t.contract.strike === 220).spans).toEqual([
    { from: '2026-10-01', to: '2026-10-06', projected: false, tradeEvidence: true },
  ]);
  expect(build([], [{ ...relationship, replacement: { ...replacement, expiry: '2026-10-01' } }]).tracks.every((t: any) => !t.spans.length)).toBe(true);
});

it('keeps a roll chain adjacent in relationship order despite interleaved expiries and accounts', () => {
  const window: any = {}; runInNewContext(script, { window });
  const contracts = ['2026-03-20', '2026-08-21', '2026-04-17', '2026-11-20'].map((expiry, i) =>
    ({ ...c, underlying: 'AMZN', right: 'put', expiry, strike: i === 1 ? 230 : 225 }));
  const rolls = contracts.slice(1).map((replacement, i) => ({ ...relationship, id: `roll-${i}`,
    old: contracts[i], replacement, at: `2026-02-0${i + 1}`, through: `2026-02-0${i + 1}` }));
  const unrelated = { ...episode, contract: { ...contracts[0], expiry: '2026-06-18' } };
  const otherAccount = { ...unrelated, account_id: 'B' };
  const inputs = [{ relationships: [rolls[2], rolls[0], rolls[1], rolls[0]] }];
  const before = JSON.stringify(inputs);
  const result = window.buildOptionTimelineTracks([unrelated, otherAccount], inputs, context);
  expect(result.tracks.map((t: any) => [t.account, t.contract.expiry])).toEqual([
    ...contracts.map(contract => ['A', contract.expiry]), ['A', '2026-06-18'], ['B', '2026-06-18'],
  ]);
  expect(result.links).toHaveLength(4);
  expect(result.links.every((l: any) => l.evidence === 'possible')).toBe(true);
  expect(JSON.stringify(inputs)).toBe(before);
});

it('orders branching relationships before their replacement and handles reused-contract cycles', () => {
  const window: any = {}; runInNewContext(script, { window });
  const early = { ...c, expiry: '2026-03-20' }, later = { ...c, expiry: '2026-08-21' };
  const roll = (id: string, old: typeof c, replacement: typeof c) => ({ ...relationship, id, old, replacement });
  const branched = window.buildOptionTimelineTracks([], [{ relationships: [roll('one', later, early), roll('two', c, early)] }], context);
  expect(branched.tracks.map((t: any) => t.contract.expiry)).toEqual([later.expiry, c.expiry, early.expiry]);
  const cycle = window.buildOptionTimelineTracks([], [{ relationships: [roll('one', later, early), roll('two', early, later)] }], context);
  expect(cycle.tracks.map((t: any) => t.contract.expiry)).toEqual([early.expiry, later.expiry]);
  expect(new Set(cycle.tracks.map((t: any) => t.key)).size).toBe(2);
});

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
it.skipIf(!existsSync(executable))('renders solid AVGO trade intervals with the correct short-put side and no extension after closing', async () => {
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 700 });
    await page.setContent(`<style>${readFileSync('webui/dashboard/page.css', 'utf8')}</style>
      <input id="timelineSearch"><select id="timelineRight"><option value=""></option></select>
      <button id="timelineExpand">Expand</button><button id="timelineCollapse">Collapse</button><button id="timelineRefresh">Refresh</button>
      <div id="timelineStatus"></div><div id="timelineChart"></div><div id="timelineDetail"></div>`);
    await page.addScriptTag({ content: script });
    await page.evaluate(({ episode, groups, context, executions }) => {
      window.fetch = async input => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname.endsWith('/option-history')) {
          if (url.searchParams.has('status') || url.searchParams.get('include_executions') !== 'true') {
            return new Response(JSON.stringify({ message: 'Invalid history request' }), { status: 400 });
          }
          return new Response(JSON.stringify({ episodes: [episode], executions, gaps: [], next_offset: null }));
        }
        return new Response(JSON.stringify({ groups, gaps: [], next_offset: null }));
      };
      (window as any).timeline = (window as any).createOptionTimeline(() => context);
      return (window as any).timeline.load();
    }, { episode: avgoEpisode, groups: avgoRelationships, context: avgoContext, executions: avgoFills });
    await page.click('#timelineExpand');
    const rows = await page.$$eval('[data-timeline-row]', es => es.map(e => ({
      label: e.getAttribute('aria-label'),
      solid: Array.from(e.querySelectorAll('.timeline-span:not(.projected)')).map(line => ({ from: Number(line.getAttribute('x1')), to: Number(line.getAttribute('x2')) })),
      projected: e.querySelectorAll('.timeline-span.projected').length,
    })));
    const call = rows.find(row => row.label!.includes('short call 400'))!;
    const put = rows.find(row => row.label!.includes('short put 310'))!;
    expect(call.solid[0].to).toBeGreaterThan(call.solid[0].from);
    expect(call.projected).toBe(1);
    expect(put.solid[0].to).toBeGreaterThan(put.solid[0].from);
    expect(put.projected).toBe(0);
    expect(rows.some(row => row.label!.includes('long put 310'))).toBe(false);
    expect(await page.$eval('#timelineStatus', e => e.textContent)).not.toContain('Partial timeline');
    await page.screenshot({ path: '/tmp/option-timeline-avgo-evidence.png', fullPage: true });
  } finally { await browser.close(); }
});

it.skipIf(!existsSync(executable))('defaults to Open and renders timeline filters, keyboard evidence, paging, partial failures and mobile scroll', async () => {
  const root = resolve('webui'); let failRolls = false;
  const queries: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    const json = (body: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/domain/invage/dashboard') return json({ empty: true, displayName: 'Test', productProfile: 'consultant', dashboardConfig: { optionView: 'timeline' } });
    if (url.pathname.endsWith('/option-history')) {
      queries.push(url.search);
      if (url.searchParams.get('status') === 'all') return json({ message: 'Invalid option history filter.' }, 400);
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
    const connector = await page.$eval('.timeline-roll', e => e.getAttribute('d')!);
    expect(connector).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    const points = connector.match(/[\d.]+/g)!.map(Number);
    expect(points[0]).toBe(points[2]); // Same-day rolls have a vertical arrow.
    expect(points[3] - points[1]).toBe(68 - 8 - 10); // Adjacent contract lanes.
    expect(await page.$$('.timeline-unknown-start')).toHaveLength(1);
    expect(await page.$eval('.timeline-unknown-start line', e => Number(e.getAttribute('x2')) - Number(e.getAttribute('x1')))).toBeGreaterThan(40);
    expect(queries.some(q => q.includes('offset=100'))).toBe(true);
    const timelineQueries = queries.map(q => new URLSearchParams(q)).filter(q => q.has('include_executions'));
    expect(timelineQueries.length).toBeGreaterThan(0);
    expect(timelineQueries.every(q => q.get('include_executions') === 'true' && !q.has('status'))).toBe(true);
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

it.skipIf(!existsSync(executable))('highlights the entire roll chain on selection and clears it without changing evidence', async () => {
  const third = { ...replacement, strike: 240, expiry: '2027-03-19' };
  const chain = [{ relationships: [relationship, { ...relationship, id: 'next-roll', old: replacement, replacement: third,
    at: '2026-10-05', through: '2026-10-05', evidence: 'order' }] }];
  const root = resolve('webui');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/option-history')) return res.end(JSON.stringify({ episodes: [episode, { ...episode, account_id: 'B' }], gaps: [], next_offset: null }));
    if (url.pathname.endsWith('/option-relationships')) return res.end(JSON.stringify({ groups: chain, gaps: [], next_offset: null }));
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<meta charset="utf-8"><link rel="stylesheet" href="/dashboard/page.css"><input id="timelineSearch"><select id="timelineRight"><option value=""></option><option value="put">put</option></select>
        <button id="timelineExpand">Expand</button><button id="timelineCollapse">Collapse</button><button id="timelineRefresh">Refresh</button>
        <div id="timelineStatus"></div><div id="timelineChart"></div><div id="timelineDetail"></div><script src="/dashboard/option-timeline.js"></script>
        <script>window.timeline = createOptionTimeline(() => (${JSON.stringify(context)})); timeline.load();</script>`);
    }
    const file = resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + '/') || !existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', extname(file) === '.css' ? 'text/css' : 'text/javascript');
    res.end(readFileSync(file));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 800 });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.waitForSelector('[data-timeline-group]'); await page.click('#timelineExpand');
    const expiryGuide = await page.$eval('[data-timeline-row="2"] .timeline-span.projected', e => ({
      from: Number(e.getAttribute('x1')), to: Number(e.getAttribute('x2')), title: e.textContent,
      dash: getComputedStyle(e).strokeDasharray,
      open: Number(e.parentElement!.querySelector('.timeline-event.open')!.getAttribute('cx')),
    }));
    expect(expiryGuide.from).toBe(expiryGuide.open);
    expect(expiryGuide.to).toBeGreaterThan(expiryGuide.from);
    expect(expiryGuide.dash).not.toBe('none');
    expect(expiryGuide.title).toContain('current position status is not confirmed');
    await page.click('[data-timeline-row="1"]'); // Middle leg, highlighting both directions.
    expect(await page.$$('.timeline-selected')).toHaveLength(1);
    expect(await page.$$('.timeline-related')).toHaveLength(2);
    expect(await page.$$('.timeline-roll.timeline-highlighted')).toHaveLength(2);
    expect(await page.$$('.timeline-roll.possible.timeline-highlighted')).toHaveLength(1);
    expect(await page.$eval('[data-timeline-row="3"]', e => getComputedStyle(e).opacity)).toBe('0.3');
    expect(await page.$eval('[data-timeline-row="1"]', e => e.getAttribute('aria-pressed'))).toBe('true');
    expect(await page.$eval('#timelineDetail', e => e.textContent)).toContain('Highlighted 2 related contracts');
    await page.screenshot({ path: '/tmp/option-timeline-chain-highlight.png', fullPage: true });
    await page.setViewport({ width: 1200, height: 800 });
    await page.waitForFunction(() => Number(document.querySelector('.option-timeline')!.getAttribute('width')) === Math.max(1080, document.getElementById('timelineChart')!.clientWidth - 2), { timeout: 5000 });
    expect(await page.$$('.timeline-related')).toHaveLength(2);
    await page.keyboard.press('Escape');
    expect(await page.$$('.timeline-selected, .timeline-related, .timeline-muted, .timeline-highlighted')).toHaveLength(0);
    await page.$eval('[data-timeline-row="0"]', e => (e as SVGElement).focus()); await page.keyboard.press('Enter');
    expect(await page.$$('.timeline-related')).toHaveLength(2);
    await page.click('[data-timeline-clear]'); expect(await page.$$('.timeline-selected')).toHaveLength(0);
    await page.click('[data-timeline-row="3"]'); // Identical contract in another account is separate.
    expect(await page.$$('.timeline-related, .timeline-highlighted')).toHaveLength(0);
    expect(await page.$eval('#timelineDetail', e => e.textContent)).toContain('No related contracts');
    await page.type('#timelineSearch', '200');
    expect(await page.$$('.timeline-selected, .timeline-muted')).toHaveLength(0);
    await page.click('[data-timeline-row="0"]'); expect(await page.$$('.timeline-related')).toHaveLength(0);
    await page.click('#timelineRefresh'); await page.waitForSelector('[data-timeline-row]');
    expect(await page.$$('.timeline-selected, .timeline-muted')).toHaveLength(0);
  } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
}, 30_000);
