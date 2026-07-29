import { describe, it, expect } from 'vitest';
import { project, toReporting } from '../src/treasury/project.js';
import { evaluateAffordability } from '../src/treasury/affordability.js';
import { annuityPayment } from '../src/treasury/amortize.js';
import type { ProjectionAssumptions } from '../src/state/household-state.js';

const assumptions: ProjectionAssumptions = {
  portfolio_return_annual_pct: 0,
  inflation_annual_pct: 2,
  property_appreciation_annual_pct: 0,
  updated_at: '2026-07-29',
  fx: { USD: 1.35 },
};

describe('toReporting', () => {
  it('passthrough same currency', () => {
    expect(toReporting(100, 'SGD', 'SGD', undefined, 't')).toBe(100);
  });

  it('converts with FX', () => {
    expect(toReporting(100, 'USD', 'SGD', { USD: 1.35 }, 't')).toBeCloseTo(135, 6);
  });

  it('fails without FX', () => {
    expect(() => toReporting(100, 'USD', 'SGD', undefined, 'cash')).toThrow(/Missing FX/);
  });
});

describe('project', () => {
  it('projects monthly income surplus', () => {
    const result = project({
      books: {
        reportingCurrency: 'SGD',
        freeCash: 10_000,
        portfolioValue: 0,
        deposits: [],
        properties: [],
        liabilities: [],
        cashFlows: [
          {
            id: 'salary',
            kind: 'income',
            amount: 5000,
            currency: 'SGD',
            frequency: 'monthly',
            start_date: '2026-01-01',
            updated_at: '2026-07-29',
          },
          {
            id: 'rent',
            kind: 'expense',
            amount: 2000,
            currency: 'SGD',
            frequency: 'monthly',
            start_date: '2026-01-01',
            updated_at: '2026-07-29',
          },
        ],
      },
      assumptions,
      horizonMonths: 12,
      asOf: '2026-01-01',
    });
    // +3000/mo * 12 = +36000 on top of 10000
    expect(result.months).toHaveLength(12);
    expect(result.summary.minFreeCash).toBeGreaterThanOrEqual(10_000);
    expect(result.months[11].freeCash).toBeCloseTo(10_000 + 3000 * 12, 4);
    expect(result.summary.shortfallMonths).toBe(0);
  });

  it('flags liquidity shortfall on mortgage without cash', () => {
    const principal = 500_000;
    const rate = 3;
    const term = 360;
    const payment = annuityPayment(principal, rate, term);
    const result = project({
      books: {
        reportingCurrency: 'SGD',
        freeCash: 100, // too small
        portfolioValue: 0,
        deposits: [],
        properties: [
          {
            id: 'home',
            value: 800_000,
            currency: 'SGD',
            updated_at: '2026-07-29',
          },
        ],
        liabilities: [
          {
            id: 'm1',
            kind: 'mortgage',
            principal,
            annual_rate_pct: rate,
            currency: 'SGD',
            start_date: '2026-01-01',
            term_months: term,
            payment_amount: payment,
            payment_frequency: 'monthly',
            property_id: 'home',
            updated_at: '2026-07-29',
          },
        ],
        cashFlows: [],
      },
      assumptions,
      horizonMonths: 3,
      asOf: '2026-01-01',
    });
    expect(result.summary.shortfallMonths).toBe(3);
    expect(result.months[0].flags).toContain('liquidity_shortfall');
  });

  it('applies buy_property scenario and scores affordability', () => {
    const result = project({
      books: {
        reportingCurrency: 'SGD',
        freeCash: 600_000,
        portfolioValue: 100_000,
        deposits: [],
        properties: [],
        liabilities: [],
        cashFlows: [
          {
            id: 'salary',
            kind: 'income',
            amount: 15_000,
            currency: 'SGD',
            frequency: 'monthly',
            start_date: '2026-01-01',
            updated_at: '2026-07-29',
          },
          {
            id: 'living',
            kind: 'expense',
            amount: 5_000,
            currency: 'SGD',
            frequency: 'monthly',
            start_date: '2026-01-01',
            updated_at: '2026-07-29',
          },
        ],
      },
      assumptions: { ...assumptions, portfolio_return_annual_pct: 0 },
      scenario: {
        id: 'buy',
        label: 'Buy',
        updated_at: '2026-07-29',
        events: [
          {
            type: 'buy_property',
            date: '2026-06-15',
            property_value: 1_000_000,
            currency: 'SGD',
            down_payment: 250_000,
            mortgage: {
              annual_rate_pct: 3,
              term_months: 360,
            },
          },
        ],
      },
      horizonMonths: 24,
      asOf: '2026-01-01',
    });
    expect(result.purchaseMonth).toBe('2026-06');
    expect(result.peakCashNeed).toBeCloseTo(250_000, 2);
    // Property appears after purchase
    const jun = result.months.find((m) => m.month === '2026-06')!;
    expect(jun.property).toBeGreaterThan(0);
    expect(jun.debt).toBeGreaterThan(0);

    const aff = evaluateAffordability({
      projection: result,
      purchaseMonth: result.purchaseMonth,
      peakCashNeed: result.peakCashNeed,
    });
    expect(['AFFORDABLE', 'TIGHT', 'NOT_AFFORDABLE']).toContain(aff.verdict);
    expect(aff.verdict).not.toBe('NOT_AFFORDABLE');
  });

  it('matures deposits into free cash (principal only)', () => {
    const result = project({
      books: {
        reportingCurrency: 'SGD',
        freeCash: 0,
        portfolioValue: 0,
        deposits: [
          {
            id: 'fd1',
            amount: 50_000,
            currency: 'SGD',
            end_date: '2026-03-15',
          },
        ],
        properties: [],
        liabilities: [],
        cashFlows: [],
      },
      assumptions,
      horizonMonths: 6,
      asOf: '2026-01-01',
    });
    const mar = result.months.find((m) => m.month === '2026-03')!;
    expect(mar.freeCash).toBeCloseTo(50_000, 2);
    expect(mar.deposits).toBeCloseTo(0, 2);
  });

  it('grows portfolio at stated annual return', () => {
    const result = project({
      books: {
        reportingCurrency: 'USD',
        freeCash: 0,
        portfolioValue: 100_000,
        deposits: [],
        properties: [],
        liabilities: [],
        cashFlows: [],
      },
      assumptions: {
        portfolio_return_annual_pct: 12,
        inflation_annual_pct: 0,
        updated_at: '2026-07-29',
      },
      horizonMonths: 12,
      asOf: '2026-01-01',
    });
    // (1.12)^(1) ≈ 1.12
    expect(result.months[11].portfolio).toBeCloseTo(100_000 * 1.12, 0);
  });
});
