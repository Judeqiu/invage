import { describe, expect, it } from 'vitest';
import {
  estimateOpportunityCost,
  impliedDepositAnnualPct,
} from '../src/treasury/opportunity-cost.js';
import { assertFundSpec } from '../src/market/position-value.js';
import type { FundSpec } from '../src/market/types.js';

describe('estimateOpportunityCost', () => {
  it('computes simple capital × yield × years', () => {
    const r = estimateOpportunityCost({
      capital: 271245,
      yieldPct: 3,
      years: 1,
      currency: 'SGD',
      source: 'explicit_yield_pct',
      sourceDetail: 'user-stated',
    });
    expect(r.soft_cost_per_year).toBeCloseTo(8137.35, 2);
    expect(r.soft_cost_total).toBeCloseTo(8137.35, 2);
    expect(r.cost_class).toBe('SOFT');
    expect(r.formula).toMatch(/271245/);
  });

  it('requires years and rejects invented-scale yield', () => {
    expect(() =>
      estimateOpportunityCost({
        capital: 100,
        yieldPct: 3,
        years: 0,
        currency: 'USD',
        source: 'explicit_yield_pct',
        sourceDetail: 'x',
      }),
    ).toThrow(/years/);
    expect(() =>
      estimateOpportunityCost({
        capital: 100,
        yieldPct: 320,
        years: 1,
        currency: 'USD',
        source: 'explicit_yield_pct',
        sourceDetail: 'x',
      }),
    ).toThrow(/implausible/);
  });
});

describe('impliedDepositAnnualPct', () => {
  it('annualizes full-term interest', () => {
    // 10000 principal, 327 interest over ~2 months ≈ 3.27% * 2/12 roughly
    const pct = impliedDepositAnnualPct(100000, 545, '2026-07-06', '2026-09-08');
    expect(pct).toBeGreaterThan(2);
    expect(pct).toBeLessThan(5);
  });
});

describe('assertFundSpec yield trio', () => {
  it('allows omit all yield fields', () => {
    const f: FundSpec = { quote_source: 'manual', mark: 1 };
    expect(() => assertFundSpec(f, 'X')).not.toThrow();
  });

  it('requires yield trio together', () => {
    expect(() =>
      assertFundSpec(
        { quote_source: 'manual', mark: 1, expected_yield_pct: 3.2 },
        'X',
      ),
    ).toThrow(/together/);
    expect(() =>
      assertFundSpec(
        {
          quote_source: 'manual',
          mark: 1,
          expected_yield_pct: 3.2,
          yield_basis: 'distribution',
          yield_as_of: '2026-08-08',
        },
        'X',
      ),
    ).not.toThrow();
  });
});
