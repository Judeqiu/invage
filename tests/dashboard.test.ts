import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-dashboard-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { loadSnapshotIndex, loadSnapshots } = await import('../src/state/snapshot.js');
const {
  buildLivePositions,
  buildDashboardModel,
  filterLiveByChannel,
  resolveDashboardChannel,
  DEFAULT_CHANNEL,
  MERGED_CHANNEL_VIEW,
} = await import('../src/report/dashboard-model.js');
const {
  buildDashboardReport,
  buildSparklineSvg,
} = await import('../src/report/dashboard-template.js');
import type { Snapshot } from '../src/state/snapshot.js';

describe('buildLivePositions', () => {
  it('fails on empty portfolio', () => {
    expect(() => buildLivePositions({}, {})).toThrow(/No portfolio saved/);
  });

  it('fails when a ticker is missing a price', () => {
    expect(() =>
      buildLivePositions({ AAPL: { avg_price: 100, units: 2 } }, {}),
    ).toThrow(/Missing market price for AAPL/);
  });

  it('computes P/L and weight % sorted by value', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
        MSFT: { avg_price: 200, units: 5 },
      },
      { AAPL: 110, MSFT: 180 },
    );
    expect(live.positionCount).toBe(2);
    expect(live.totalCost).toBe(2000);
    expect(live.totalValue).toBe(2000); // 1100 + 900
    expect(live.positionsValue).toBe(2000);
    expect(live.cashAmount).toBeNull();
    expect(live.cashWeightPct).toBeNull();
    expect(live.totalPL).toBe(0);
    expect(live.positions[0].ticker).toBe('AAPL');
    expect(live.positions[0].weightPct).toBeCloseTo(55, 5);
    expect(live.positions[1].weightPct).toBeCloseTo(45, 5);
    const weightSum = live.positions.reduce((s, p) => s + p.weightPct, 0);
    expect(weightSum).toBeCloseTo(100, 5);
    expect(live.equityCount).toBe(2);
    expect(live.optionCount).toBe(0);
  });

  it('includes recorded cash in NAV and cash weight', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
      },
      { AAPL: 110 },
      undefined,
      { amount: 400, currency: 'USD' },
    );
    // positions 1100 + cash 400
    expect(live.positionsValue).toBe(1100);
    expect(live.cashAmount).toBe(400);
    expect(live.cashCurrency).toBe('USD');
    expect(live.totalValue).toBe(1500);
    expect(live.cashWeightPct).toBeCloseTo((400 / 1500) * 100, 5);
    // AAPL weight of full NAV abs sum
    expect(live.positions[0].weightPct).toBeCloseTo((1100 / 1500) * 100, 5);
    // P/L still position-only (1100 - 1000)
    expect(live.totalPL).toBe(100);
  });

  it('includes fixed deposit principal in NAV but not free cash weight numerator alone', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
      },
      { AAPL: 110 },
      undefined,
      { amount: 400, currency: 'USD', channel: 'jude_futu' },
      [
        {
          id: 'fd-1',
          amount: 5000,
          interest: 80,
          currency: 'USD',
          start_date: '2026-01-01',
          end_date: '2026-12-31',
          channel: 'jude_futu',
          label: '1Y TD',
        },
      ],
      '2026-07-29',
    );
    // positions 1100 + cash 400 + FD 5000
    expect(live.positionsValue).toBe(1100);
    expect(live.cashAmount).toBe(400);
    expect(live.depositsAmount).toBe(5000);
    expect(live.depositCount).toBe(1);
    expect(live.totalValue).toBe(6500);
    // free cash weight uses free cash only over full NAV
    expect(live.cashWeightPct).toBeCloseTo((400 / 6500) * 100, 5);
    expect(live.deposits[0].id).toBe('fd-1');
    expect(live.deposits[0].channel).toBe('jude_futu');
    expect(live.deposits[0].daysRemaining).toBeGreaterThan(0);
    expect(live.deposits[0].matured).toBe(false);
    // channel list includes deposit channel
    expect(live.channels).toContain('jude_futu');
    // AAPL has no channel → default; cash+FD on jude_futu
    const ch = live.byChannel.find((c) => c.channel === 'jude_futu');
    expect(ch?.depositsAmount).toBe(5000);
    expect(ch?.cashAmount).toBe(400);
    expect(ch?.totalValue).toBe(5400); // cash 400 + FD 5000 (no positions on this channel)
    const def = live.byChannel.find((c) => c.channel === DEFAULT_CHANNEL);
    expect(def?.totalValue).toBe(1100);
  });

  it('allows deposits-only portfolio (no holdings)', () => {
    const live = buildLivePositions(
      {},
      {},
      undefined,
      null,
      [
        {
          id: 'fd-only',
          amount: 10000,
          interest: 100,
          currency: 'USD',
          start_date: '2026-01-01',
          end_date: '2026-06-01',
          channel: 'ibkr',
        },
      ],
      '2026-07-29',
    );
    expect(live.positionCount).toBe(0);
    expect(live.depositsAmount).toBe(10000);
    expect(live.totalValue).toBe(10000);
    expect(live.deposits[0].matured).toBe(true);
    expect(live.channels).toEqual(['ibkr']);
  });

  it('includes short put without Yahoo price on the option key', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
        'SPACEX-P-90-20260807-S': {
          instrument: 'option',
          avg_price: 265, // $ per contract total, not ×100
          units: 1,
          option: {
            right: 'put',
            side: 'short',
            strike: 90,
            expiry: '2026-08-07',
            multiplier: 100,
            underlying: 'SPACEX',
            settlement: 'physical',
            mark: 265,
          },
        },
      },
      { AAPL: 110 },
    );
    expect(live.positionCount).toBe(2);
    expect(live.contingentCashObligation).toBe(9000);
    expect(live.optionsPremiumCollected).toBe(265);
    expect(live.optionCount).toBe(1);
    const opt = live.positions.find((p) => p.instrument === 'option');
    expect(opt?.value).toBe(-265);
    expect(opt?.pl).toBe(0);
  });

  it('tags missing channel as default and builds byChannel', () => {
    expect(resolveDashboardChannel(undefined)).toBe(DEFAULT_CHANNEL);
    expect(resolveDashboardChannel('')).toBe(DEFAULT_CHANNEL);
    expect(resolveDashboardChannel('  ibkr  ')).toBe('ibkr');

    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
        MSFT: { avg_price: 200, units: 5, channel: 'moomoo' },
      },
      { AAPL: 110, MSFT: 180 },
      undefined,
      { amount: 500, currency: 'USD' },
    );

    expect(live.positions.find((p) => p.ticker === 'AAPL')?.channel).toBe(DEFAULT_CHANNEL);
    expect(live.positions.find((p) => p.ticker === 'MSFT')?.channel).toBe('moomoo');
    expect(live.cashChannel).toBe(DEFAULT_CHANNEL);
    expect(live.channels).toEqual([DEFAULT_CHANNEL, 'moomoo']);
    expect(live.byChannel).toHaveLength(2);

    const def = live.byChannel.find((c) => c.channel === DEFAULT_CHANNEL);
    const moo = live.byChannel.find((c) => c.channel === 'moomoo');
    expect(def?.positionCount).toBe(1);
    expect(def?.cashAmount).toBe(500);
    expect(def?.positionsValue).toBe(1100);
    expect(def?.totalValue).toBe(1600); // 1100 + 500 cash
    expect(moo?.positionCount).toBe(1);
    expect(moo?.cashAmount).toBeNull();
    expect(moo?.positionsValue).toBe(900);
    expect(moo?.totalValue).toBe(900);

    // Merged totals
    expect(live.totalValue).toBe(2500); // 1100 + 900 + 500
    expect(live.positionsValue).toBe(2000);
  });

  it('filterLiveByChannel isolates one broker; merged returns full slice', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10, channel: 'ibkr' },
        MSFT: { avg_price: 200, units: 5, channel: 'moomoo' },
      },
      { AAPL: 110, MSFT: 180 },
      undefined,
      { amount: 400, currency: 'USD', channel: 'ibkr' },
    );

    const merged = filterLiveByChannel(live, MERGED_CHANNEL_VIEW);
    expect(merged.positionCount).toBe(2);
    expect(merged.totalValue).toBe(2400); // 1100+900+400

    const ibkr = filterLiveByChannel(live, 'ibkr');
    expect(ibkr.positionCount).toBe(1);
    expect(ibkr.positions[0].ticker).toBe('AAPL');
    expect(ibkr.cashAmount).toBe(400);
    expect(ibkr.cashChannel).toBe('ibkr');
    expect(ibkr.totalValue).toBe(1500); // 1100 + 400
    // Weight is within filtered set
    expect(ibkr.positions[0].weightPct).toBeCloseTo((1100 / 1500) * 100, 5);

    const moo = filterLiveByChannel(live, 'moomoo');
    expect(moo.positionCount).toBe(1);
    expect(moo.cashAmount).toBeNull();
    expect(moo.totalValue).toBe(900);
  });

  it('multi-channel cash appears on each channel and sums in merged view', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10, channel: 'jude_futu' },
        TSLA: { avg_price: 200, units: 5, channel: 'cmbyonglong' },
      },
      { AAPL: 110, TSLA: 300 },
      undefined,
      [
        { amount: 12448.47, currency: 'USD', channel: 'jude_futu' },
        { amount: 38758.91, currency: 'USD', channel: 'cmbyonglong' },
      ],
    );

    expect(live.cashAmount).toBeCloseTo(51207.38, 2);
    expect(live.cashChannel).toBeNull(); // multi → no single channel on merged
    expect(live.totalValue).toBeCloseTo(1100 + 1500 + 51207.38, 2);

    const futu = live.byChannel.find((c) => c.channel === 'jude_futu');
    const cmb = live.byChannel.find((c) => c.channel === 'cmbyonglong');
    expect(futu?.cashAmount).toBeCloseTo(12448.47, 2);
    expect(futu?.totalValue).toBeCloseTo(1100 + 12448.47, 2);
    expect(cmb?.cashAmount).toBeCloseTo(38758.91, 2);
    expect(cmb?.totalValue).toBeCloseTo(1500 + 38758.91, 2);

    const filteredFutu = filterLiveByChannel(live, 'jude_futu');
    expect(filteredFutu.cashAmount).toBeCloseTo(12448.47, 2);
    expect(filteredFutu.cashChannel).toBe('jude_futu');
    expect(filteredFutu.positionCount).toBe(1);
  });

  it('multi-currency cash converts with live FX rates into reporting currency', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10, channel: 'us' },
      },
      { AAPL: 110 },
      undefined,
      [
        { amount: 1000, currency: 'USD', channel: 'us' },
        { amount: 1000, currency: 'SGD', channel: 'sg' },
      ],
      null,
      undefined,
      { reportingCurrency: 'USD', fxRates: { SGD: 0.74, USD: 1 } },
    );
    // cash: 1000 USD + 740 USD + positions 1100
    expect(live.fxApplied).toBe(true);
    expect(live.reportingCurrency).toBe('USD');
    expect(live.cashAmount).toBeCloseTo(1740, 5);
    expect(live.cashCurrency).toBe('USD');
    expect(live.totalValue).toBeCloseTo(1100 + 1740, 5);
    const sg = live.byChannel.find((c) => c.channel === 'sg');
    expect(sg?.cashAmount).toBeCloseTo(740, 5);
    expect(sg?.cashCurrency).toBe('USD');
  });

  it('multi-currency cash without FX fails fast', () => {
    expect(() =>
      buildLivePositions(
        { AAPL: { avg_price: 100, units: 10 } },
        { AAPL: 110 },
        undefined,
        [
          { amount: 1000, currency: 'USD', channel: 'us' },
          { amount: 1000, currency: 'SGD', channel: 'sg' },
        ],
      ),
    ).toThrow(/reporting_currency|currencies/);
  });
});

describe('buildDashboardModel', () => {
  const live = buildLivePositions(
    { AAPL: { avg_price: 100, units: 10 } },
    { AAPL: 120 },
  );

  it('empty history → no period change', () => {
    const model = buildDashboardModel(live, []);
    expect(model.history).toEqual([]);
    expect(model.periodChange).toBeNull();
    expect(model.lastSnapshot).toBeNull();
    expect(model.live.totalValue).toBe(1200);
  });

  it('single snapshot → history row without delta, no period change', () => {
    const snaps: Snapshot[] = [
      {
        date: '2026-07-01',
        totalValue: 1000,
        totalCost: 900,
        totalPL: 100,
        totalPLPct: 11.1,
        positions: [
          {
            ticker: 'AAPL',
            avgCost: 90,
            units: 10,
            price: 100,
            cost: 900,
            value: 1000,
            pl: 100,
            plPct: 11.1,
          },
        ],
      },
    ];
    const model = buildDashboardModel(live, snaps);
    expect(model.history).toHaveLength(1);
    expect(model.history[0].deltaValue).toBeNull();
    expect(model.history[0].positions).toHaveLength(1);
    expect(model.history[0].positions[0].ticker).toBe('AAPL');
    expect(model.periodChange).toBeNull();
    expect(model.lastSnapshot).toEqual({ date: '2026-07-01', totalValue: 1000 });
  });

  it('multi snapshot → deltas and period change from last two', () => {
    const snaps: Snapshot[] = [
      {
        date: '2026-07-01',
        totalValue: 1000,
        totalCost: 900,
        totalPL: 100,
        totalPLPct: 11.1,
        positions: [],
      },
      {
        date: '2026-07-08',
        totalValue: 1100,
        totalCost: 900,
        totalPL: 200,
        totalPLPct: 22.2,
        positions: [],
      },
      {
        date: '2026-07-15',
        totalValue: 1050,
        totalCost: 900,
        totalPL: 150,
        totalPLPct: 16.7,
        positions: [],
      },
    ];
    const model = buildDashboardModel(live, snaps);
    expect(model.history).toHaveLength(3);
    expect(model.history[0].deltaValue).toBeNull();
    expect(model.history[1].deltaValue).toBe(100);
    expect(model.history[1].deltaPct).toBeCloseTo(10, 5);
    expect(model.history[2].deltaValue).toBe(-50);
    expect(model.history[2].deltaPct).toBeCloseTo((-50 / 1100) * 100, 5);
    expect(model.periodChange).not.toBeNull();
    expect(model.periodChange!.fromDate).toBe('2026-07-08');
    expect(model.periodChange!.toDate).toBe('2026-07-15');
    expect(model.periodChange!.deltaValue).toBe(-50);
    expect(model.periodChange!.deltaPct).toBeCloseTo((-50 / 1100) * 100, 5);
  });
});

describe('loadSnapshots', () => {
  const slug = 'alice';

  beforeAll(() => {
    const dir = join(dataRoot, 'drive', slug);
    mkdirSync(dir, { recursive: true });
  });

  afterAll(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('missing index → empty array', () => {
    expect(loadSnapshotIndex('nobody')).toEqual([]);
    expect(loadSnapshots('nobody')).toEqual([]);
  });

  it('loads and sorts by date', () => {
    const dir = join(dataRoot, 'drive', slug);
    const a: Snapshot = {
      date: '2026-07-10',
      totalValue: 200,
      totalCost: 100,
      totalPL: 100,
      totalPLPct: 100,
      positions: [],
    };
    const b: Snapshot = {
      date: '2026-07-01',
      totalValue: 150,
      totalCost: 100,
      totalPL: 50,
      totalPLPct: 50,
      positions: [],
    };
    writeFileSync(join(dir, 'snapshot-2026-07-10.json'), JSON.stringify(a), 'utf-8');
    writeFileSync(join(dir, 'snapshot-2026-07-01.json'), JSON.stringify(b), 'utf-8');
    writeFileSync(
      join(dir, 'snapshots.json'),
      JSON.stringify(['snapshot-2026-07-10.json', 'snapshot-2026-07-01.json']),
      'utf-8',
    );

    const snaps = loadSnapshots(slug);
    expect(snaps.map((s) => s.date)).toEqual(['2026-07-01', '2026-07-10']);
  });

  it('throws on corrupt JSON', () => {
    const dir = join(dataRoot, 'drive', slug);
    writeFileSync(join(dir, 'snapshot-bad.json'), '{not-json', 'utf-8');
    writeFileSync(join(dir, 'snapshots.json'), JSON.stringify(['snapshot-bad.json']), 'utf-8');
    expect(() => loadSnapshots(slug)).toThrow(/Corrupt snapshot JSON/);
  });

  it('throws when index lists missing file', () => {
    const dir = join(dataRoot, 'drive', slug);
    writeFileSync(
      join(dir, 'snapshots.json'),
      JSON.stringify(['snapshot-missing.json']),
      'utf-8',
    );
    expect(() => loadSnapshots(slug)).toThrow(/file missing/);
  });
});

describe('buildDashboardReport', () => {
  it('includes live total and empty-history messaging', () => {
    const live = buildLivePositions(
      { AAPL: { avg_price: 100, units: 10 } },
      { AAPL: 150 },
    );
    const html = buildDashboardReport(buildDashboardModel(live, []), 'Jude');
    expect(html).toContain('Jude');
    expect(html).toContain('Portfolio Dashboard');
    expect(html).toContain('$1,500.00');
    expect(html).toContain('No snapshots yet');
    expect(html).toContain('No prior snapshot for period change');
    expect(html).toContain('default'); // unassigned channel
    expect(html).toContain('By Channel');
    expect(html).toContain('Merged');
  });

  it('normalizes snapshot positions without channel to default', () => {
    const live = buildLivePositions(
      { AAPL: { avg_price: 100, units: 10 } },
      { AAPL: 150 },
    );
    const model = buildDashboardModel(live, [
      {
        date: '2026-07-01',
        totalValue: 1000,
        totalCost: 900,
        totalPL: 100,
        totalPLPct: 11.1,
        positions: [
          {
            ticker: 'AAPL',
            avgCost: 90,
            units: 10,
            price: 100,
            cost: 900,
            value: 1000,
            pl: 100,
            plPct: 11.1,
          },
        ],
        cashAmount: 50,
        cashCurrency: 'USD',
      },
    ]);
    expect(model.history[0].positions[0].channel).toBe(DEFAULT_CHANNEL);
    expect(model.history[0].cashChannel).toBe(DEFAULT_CHANNEL);
  });

  it('includes history rows and sparkline when ≥2 snapshots', () => {
    const live = buildLivePositions(
      { AAPL: { avg_price: 100, units: 10 } },
      { AAPL: 150 },
    );
    const snaps: Snapshot[] = [
      {
        date: '2026-07-01',
        totalValue: 1000,
        totalCost: 900,
        totalPL: 100,
        totalPLPct: 11.1,
        positions: [],
      },
      {
        date: '2026-07-08',
        totalValue: 1200,
        totalCost: 900,
        totalPL: 300,
        totalPLPct: 33.3,
        positions: [],
      },
    ];
    const html = buildDashboardReport(buildDashboardModel(live, snaps), 'Alice');
    expect(html).toContain('2026-07-01');
    expect(html).toContain('2026-07-08');
    expect(html).toContain('<polyline');
    expect(html).toContain('→');
  });
});

describe('buildSparklineSvg', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(buildSparklineSvg([])).toBe('');
    expect(buildSparklineSvg([1])).toBe('');
  });

  it('returns polyline for 2+ points', () => {
    const svg = buildSparklineSvg([100, 120, 110]);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('points=');
  });
});
