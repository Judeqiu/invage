import { describe, it, expect } from 'vitest';
import {
  assessValue,
  rankValueCandidates,
  deriveYields,
  emptyMetrics,
} from '../src/market/value-assess.js';
import type { FinancialMetrics } from '../src/market/types.js';

function base(over: Partial<FinancialMetrics> = {}): FinancialMetrics {
  return {
    ...emptyMetrics('TEST'),
    shortName: 'Test Co',
    sector: 'Technology',
    ...over,
  };
}

describe('deriveYields', () => {
  it('computes earnings yield from positive PE', () => {
    const y = deriveYields({
      trailingPE: 20,
      marketCap: null,
      enterpriseValue: null,
      freeCashflow: null,
    });
    expect(y.earningsYield).toBeCloseTo(0.05);
    expect(y.fcfYield).toBeNull();
  });

  it('computes FCF yield on market cap and EV', () => {
    const y = deriveYields({
      trailingPE: null,
      marketCap: 100,
      enterpriseValue: 200,
      freeCashflow: 10,
    });
    expect(y.fcfYield).toBeCloseTo(0.1);
    expect(y.fcfYieldOnEv).toBeCloseTo(0.05);
  });

  it('fails fast on non-positive market cap when FCF present', () => {
    expect(() =>
      deriveYields({
        trailingPE: null,
        marketCap: 0,
        enterpriseValue: null,
        freeCashflow: 10,
      }),
    ).toThrow(/marketCap must be > 0/);
  });

  it('fails fast on non-positive EV when FCF present', () => {
    expect(() =>
      deriveYields({
        trailingPE: null,
        marketCap: null,
        enterpriseValue: -1,
        freeCashflow: 10,
      }),
    ).toThrow(/enterpriseValue must be > 0/);
  });
});

describe('assessValue', () => {
  it('returns UNKNOWN when fetch failed', () => {
    const a = assessValue(emptyMetrics('X', 'network down'));
    expect(a.cheapness).toBe('UNKNOWN');
    expect(a.trapRisk).toBe('UNKNOWN');
    expect(a.signals[0]).toMatch(/fetch failed/);
  });

  it('flags quality-at-discount style YES cheapness with strong ROE', () => {
    const a = assessValue(
      base({
        trailingPE: 12,
        forwardPE: 11,
        pegRatio: 0.9,
        fcfYield: 0.08,
        enterpriseToEbitda: 8,
        returnOnEquity: 0.22,
        returnOnAssets: 0.1,
        operatingMargins: 0.2,
        freeCashflow: 1e9,
        marketCap: 1e10,
      }),
    );
    expect(a.cheapness).toBe('YES');
    expect(a.quality).toBe('STRONG');
    expect(a.trapRisk).toBe('LOW');
  });

  it('flags expensive + weak as NO cheapness with elevated trap', () => {
    const a = assessValue(
      base({
        trailingPE: 45,
        forwardPE: 40,
        pegRatio: 3,
        fcfYield: 0.005,
        enterpriseToEbitda: 28,
        returnOnEquity: 0.02,
        operatingMargins: -0.05,
        freeCashflow: -1e8,
        marketCap: 5e9,
        debtToEquity: 350,
      }),
    );
    expect(a.cheapness).toBe('NO');
    expect(a.quality).toBe('WEAK');
    expect(['ELEVATED', 'HIGH']).toContain(a.trapRisk);
  });

  it('detects value-trap pattern: cheap multiples + weak quality', () => {
    const a = assessValue(
      base({
        trailingPE: 8,
        forwardPE: 9,
        pegRatio: 0.5,
        returnOnEquity: 0.01,
        operatingMargins: -0.1,
        freeCashflow: -5e7,
        marketCap: 1e9,
        revenueGrowth: -0.2,
      }),
    );
    expect(a.cheapness).toBe('YES');
    expect(a.quality).toBe('WEAK');
    expect(['ELEVATED', 'HIGH']).toContain(a.trapRisk);
    expect(a.signals.some((s) => /value-trap/i.test(s))).toBe(true);
  });

  it('uses P/B for financials and skips EV/EBITDA scoring', () => {
    const a = assessValue(
      base({
        sector: 'Financial Services',
        priceToBook: 0.9,
        trailingPE: 11,
        returnOnEquity: 0.14,
        enterpriseToEbitda: 3, // should not drive trap/cheap for banks the same way
      }),
    );
    expect(a.signals.some((s) => /P\/B/.test(s) && /book cheap/.test(s))).toBe(true);
    expect(a.signals.some((s) => /EV\/EBITDA/.test(s))).toBe(false);
  });
});

describe('rankValueCandidates', () => {
  it('ranks YES+LOW trap ahead of MIXED and HIGH trap', () => {
    const ranked = rankValueCandidates([
      {
        ticker: 'TRAP',
        cheapness: 'YES',
        quality: 'WEAK',
        trapRisk: 'HIGH',
        signals: [],
        summary: '',
      },
      {
        ticker: 'GOOD',
        cheapness: 'YES',
        quality: 'STRONG',
        trapRisk: 'LOW',
        signals: [],
        summary: '',
      },
      {
        ticker: 'MID',
        cheapness: 'MIXED',
        quality: 'OK',
        trapRisk: 'LOW',
        signals: [],
        summary: '',
      },
    ]);
    expect(ranked.map((r) => r.ticker)).toEqual(['GOOD', 'TRAP', 'MID']);
  });
});
