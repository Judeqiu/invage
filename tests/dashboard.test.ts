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
    expect(live.totalPL).toBe(0);
    expect(live.positions[0].ticker).toBe('AAPL');
    expect(live.positions[0].weightPct).toBeCloseTo(55, 5);
    expect(live.positions[1].weightPct).toBeCloseTo(45, 5);
    const weightSum = live.positions.reduce((s, p) => s + p.weightPct, 0);
    expect(weightSum).toBeCloseTo(100, 5);
    expect(live.equityCount).toBe(2);
    expect(live.optionCount).toBe(0);
  });

  it('includes short put without Yahoo price on the option key', () => {
    const live = buildLivePositions(
      {
        AAPL: { avg_price: 100, units: 10 },
        'SPACEX-P-90-20260807-S': {
          instrument: 'option',
          avg_price: 265,
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
    expect(live.optionsPremiumCollected).toBe(26500);
    expect(live.optionCount).toBe(1);
    const opt = live.positions.find((p) => p.instrument === 'option');
    expect(opt?.value).toBe(-26500);
    expect(opt?.pl).toBe(0);
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
