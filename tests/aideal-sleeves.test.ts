import { describe, expect, it } from 'vitest';
import { getAidealSleeve, lotsFromPortfolio } from '../src/aideal/sleeves.js';
import { buildAidealNewsletterHtml } from '../src/aideal/newsletter.js';
import type { SleeveIndexResult } from '../src/aideal/index-math.js';

describe('Aideal sleeve catalog', () => {
  it('exposes the seven SL sleeves with benchmarks', () => {
    expect(getAidealSleeve('healthcare').benchmark).toBe('IYH');
    expect(getAidealSleeve('technology').benchmark).toBe('QQQ');
    expect(getAidealSleeve('overall').benchmark).toBe('SPY');
    expect(() => getAidealSleeve('real-estate')).toThrow(/Unknown Aideal sleeve/);
  });

  it('takes lots only from matching holding.category', () => {
    const sleeve = getAidealSleeve('healthcare');
    const lots = lotsFromPortfolio(sleeve, {
      LLY: { avg_price: 700, units: 4, category: 'healthcare' },
      AAPL: { avg_price: 180, units: 10, category: 'technology' },
      JNJ: { avg_price: 150, units: 8 },
    });
    expect(lots).toEqual([{ ticker: 'LLY', units: 4 }]);
  });

  it('overall unions craft-sleeve categories', () => {
    const lots = lotsFromPortfolio(getAidealSleeve('overall'), {
      LLY: { avg_price: 700, units: 4, category: 'healthcare' },
      AAPL: { avg_price: 180, units: 10, category: 'technology' },
      CASHCOIN: { avg_price: 1, units: 99, category: 'other' },
    });
    expect(lots).toEqual([
      { ticker: 'LLY', units: 4 },
      { ticker: 'AAPL', units: 10 },
    ]);
  });
});

describe('buildAidealNewsletterHtml', () => {
  const sleeve: SleeveIndexResult = {
    sleeveId: 'healthcare',
    label: 'Healthcare',
    benchmark: 'IYH',
    baseDate: '2025-08-12',
    reportDate: '2026-08-18',
    sleeveValueBase: 100,
    sleeveValueNow: 110,
    fundIndex: 110,
    benchmarkIndex: 108,
    vsBenchmark: 2,
    lotCount: 2,
  };

  it('emits Gmail-safe tables and sleeve numbers', () => {
    const html = buildAidealNewsletterHtml({
      title: 'Aideal weekly',
      reportDate: '2026-08-18',
      sleeves: [sleeve],
      laggards: [{ ticker: 'UNH', plPct: -22, action: 'WATCH', note: 'upside thin' }],
      overpriced: [],
      buyOpportunities: [],
    });
    expect(html).toContain('Aideal weekly');
    expect(html).toContain('Healthcare');
    expect(html).toContain('110.00');
    expect(html).toContain('UNH');
    expect(html).not.toMatch(/rgba\(/);
    expect(html).toContain('bgcolor="#1a365d"');
    expect(html).toContain('<table');
  });

  it('fails without title, date, or sleeve rows', () => {
    expect(() =>
      buildAidealNewsletterHtml({
        title: '  ',
        reportDate: '2026-08-18',
        sleeves: [sleeve],
        laggards: [],
        overpriced: [],
        buyOpportunities: [],
      }),
    ).toThrow(/title/);
    expect(() =>
      buildAidealNewsletterHtml({
        title: 'x',
        reportDate: '18 Aug',
        sleeves: [sleeve],
        laggards: [],
        overpriced: [],
        buyOpportunities: [],
      }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      buildAidealNewsletterHtml({
        title: 'x',
        reportDate: '2026-08-18',
        sleeves: [],
        laggards: [],
        overpriced: [],
        buyOpportunities: [],
      }),
    ).toThrow(/sleeve index/);
  });
});
