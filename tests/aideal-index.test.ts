import { describe, expect, it } from 'vitest';
import { computeSleeveIndex } from '../src/aideal/index-math.js';

describe('computeSleeveIndex', () => {
  it('rebases sleeve and benchmark to 100 at the base date', () => {
    const result = computeSleeveIndex({
      sleeveId: 'healthcare',
      label: 'Healthcare',
      benchmark: 'IYH',
      baseDate: '2025-08-12',
      reportDate: '2026-08-18',
      lots: [
        { ticker: 'LLY', units: 10 },
        { ticker: 'JNJ', units: 20 },
      ],
      basePrices: { LLY: 800, JNJ: 150, IYH: 50 },
      reportPrices: { LLY: 880, JNJ: 165, IYH: 55 },
    });
    // sleeve base = 10*800 + 20*150 = 11000
    // sleeve now  = 10*880 + 20*165 = 12100
    // fund = 12100/11000*100 = 110
    expect(result.sleeveValueBase).toBe(11000);
    expect(result.sleeveValueNow).toBe(12100);
    expect(result.fundIndex).toBe(110);
    expect(result.benchmarkIndex).toBe(110);
    expect(result.vsBenchmark).toBe(0);
    expect(result.benchmark).toBe('IYH');
  });

  it('reports vs-benchmark as fund index minus benchmark index', () => {
    const result = computeSleeveIndex({
      sleeveId: 'technology',
      label: 'Technology',
      benchmark: 'QQQ',
      baseDate: '2025-11-13',
      reportDate: '2026-08-18',
      lots: [{ ticker: 'AAPL', units: 5 }],
      basePrices: { AAPL: 200, QQQ: 400 },
      reportPrices: { AAPL: 240, QQQ: 440 },
    });
    expect(result.fundIndex).toBe(120);
    expect(result.benchmarkIndex).toBe(110);
    expect(result.vsBenchmark).toBe(10);
  });

  it('fails fast on missing lot price or non-positive base value', () => {
    expect(() =>
      computeSleeveIndex({
        sleeveId: 'financial',
        label: 'Financial',
        benchmark: 'SPY',
        baseDate: '2025-07-29',
        reportDate: '2026-08-18',
        lots: [{ ticker: 'BRK-B', units: 2 }],
        basePrices: { SPY: 500 },
        reportPrices: { 'BRK-B': 400, SPY: 520 },
      }),
    ).toThrow(/BRK-B/);

    expect(() =>
      computeSleeveIndex({
        sleeveId: 'financial',
        label: 'Financial',
        benchmark: 'SPY',
        baseDate: '2025-07-29',
        reportDate: '2026-08-18',
        lots: [],
        basePrices: { SPY: 500 },
        reportPrices: { SPY: 520 },
      }),
    ).toThrow(/lots/);
  });
});
