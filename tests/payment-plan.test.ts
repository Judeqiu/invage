import { describe, expect, it } from 'vitest';
import {
  buildPaymentPlan,
  impliedDepositAnnualPct,
  optimizePaymentPlan,
} from '../src/treasury/payment-plan.js';

describe('impliedDepositAnnualPct', () => {
  it('computes simple annualized yield from full-term interest', () => {
    // 1000 principal, 50 interest over 365 days → 5%
    const pct = impliedDepositAnnualPct(1000, 50, '2026-01-01', '2027-01-01');
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(5, 1);
  });
});

describe('buildPaymentPlan', () => {
  const base = {
    asOf: '2026-08-01',
    currency: 'SGD',
    freeCash: [{ amount: 2000, currency: 'SGD', channel: 'bank' }],
    deposits: [
      {
        id: 'fd1',
        amount: 5000,
        interest: 100,
        currency: 'SGD',
        start_date: '2026-01-01',
        end_date: '2026-09-01',
        label: '6m FD',
      },
    ],
    monthlyIncome: 8000,
    monthlyExpense: 5000,
    liabilities: [
      {
        id: 'card',
        kind: 'loan',
        principal: 3000,
        annual_rate_pct: 18,
        payment_amount: 150,
        currency: 'SGD',
        label: 'card',
      },
      {
        id: 'mort',
        kind: 'mortgage',
        principal: 200000,
        annual_rate_pct: 3.5,
        payment_amount: 1200,
        currency: 'SGD',
        label: 'home',
      },
    ],
  };

  it('avalanche ranks highest APR first and prefers card over mortgage', () => {
    const plan = buildPaymentPlan({ ...base, strategy: 'avalanche', maxMonths: 24 });
    expect(plan.liability_order[0].id).toBe('card');
    expect(plan.liability_order[1].id).toBe('mort');
    expect(plan.monthly_surplus_for_debt).toBeGreaterThan(0);
    expect(plan.summary.total_interest).toBeGreaterThanOrEqual(0);
    expect(plan.funding_waterfall.length).toBeGreaterThan(3);
  });

  it('snowball ranks smallest principal first', () => {
    const plan = buildPaymentPlan({ ...base, strategy: 'snowball', maxMonths: 12 });
    expect(plan.liability_order[0].id).toBe('card');
    expect(plan.liability_order[0].rankReason).toMatch(/Snowball/i);
  });

  it('preserves emergency reserve from free cash', () => {
    const plan = buildPaymentPlan({
      ...base,
      strategy: 'avalanche',
      preserveEmergencyMonths: 3,
      maxMonths: 6,
    });
    // expense 5000 * 3 = 15000, free cash only 2000 → deployable 0
    expect(plan.emergency_reserve).toBe(15000);
    expect(plan.deployable_cash_now).toBe(0);
  });

  it('fails fast on mixed liability currency', () => {
    expect(() =>
      buildPaymentPlan({
        ...base,
        strategy: 'avalanche',
        liabilities: [
          { ...base.liabilities[0], currency: 'USD' },
        ],
      }),
    ).toThrow(/currency/i);
  });

  it('flags maturing deposit for post-maturity paydown when debt APR is higher', () => {
    const plan = buildPaymentPlan({ ...base, strategy: 'avalanche', maxMonths: 3 });
    const fd = plan.deposit_guidance.find((d) => d.id === 'fd1');
    expect(fd).toBeDefined();
    expect(fd!.action).toMatch(/matur|compare|hold/i);
    expect(fd!.detail.length).toBeGreaterThan(20);
  });
});

describe('optimizePaymentPlan', () => {
  const base = {
    asOf: '2026-08-01',
    currency: 'SGD',
    freeCash: [{ amount: 5000, currency: 'SGD', channel: 'bank' }],
    deposits: [] as Array<{
      id: string;
      amount: number;
      interest: number;
      currency: string;
      start_date: string;
      end_date: string;
    }>,
    monthlyIncome: 8000,
    monthlyExpense: 5000,
    liabilities: [
      {
        id: 'card',
        kind: 'loan',
        principal: 8000,
        annual_rate_pct: 22,
        payment_amount: 200,
        currency: 'SGD',
        label: 'card',
      },
      {
        id: 'loan',
        kind: 'loan',
        principal: 4000,
        annual_rate_pct: 8,
        payment_amount: 150,
        currency: 'SGD',
        label: 'personal',
      },
    ],
  };

  it('evaluates strategy × emergency axes and ranks by lowest HARD interest then faster debt-free', () => {
    const result = optimizePaymentPlan(base, {
      strategies: ['avalanche', 'snowball'],
      emergencyMonths: [undefined, 3],
      extraMonthlies: [undefined],
      maxMonths: 120,
    });
    expect(result.candidates_evaluated).toBe(4);
    expect(result.ranking).toHaveLength(4);
    expect(result.best.config.strategy).toBe('avalanche');
    // Best must have interest ≤ every other candidate
    for (const c of result.ranking) {
      expect(result.best.summary.total_interest).toBeLessThanOrEqual(c.summary.total_interest + 1e-9);
    }
    // Ranking is sorted best→worst by objective
    for (let i = 1; i < result.ranking.length; i++) {
      const a = result.ranking[i - 1].summary;
      const b = result.ranking[i].summary;
      const aMonths = a.months_to_debt_free ?? Number.POSITIVE_INFINITY;
      const bMonths = b.months_to_debt_free ?? Number.POSITIVE_INFINITY;
      if (a.total_interest === b.total_interest) {
        expect(aMonths).toBeLessThanOrEqual(bMonths);
      } else {
        expect(a.total_interest).toBeLessThanOrEqual(b.total_interest);
      }
    }
    expect(result.interest_saved_vs_worst).toBeGreaterThanOrEqual(0);
    expect(result.best_plan.strategy).toBe(result.best.config.strategy);
    expect(result.best_plan.summary.total_interest).toBe(result.best.summary.total_interest);
  });

  it('fails fast when strategies list is empty', () => {
    expect(() =>
      optimizePaymentPlan(base, {
        strategies: [],
        emergencyMonths: [undefined],
        extraMonthlies: [undefined],
      }),
    ).toThrow(/strateg/i);
  });

  it('fails fast when no candidates after cartesian product', () => {
    expect(() =>
      optimizePaymentPlan(base, {
        strategies: ['avalanche'],
        emergencyMonths: [],
        extraMonthlies: [undefined],
      }),
    ).toThrow(/candidate|emergency|empty/i);
  });

  it('respects pinned extra_monthly across candidates', () => {
    const result = optimizePaymentPlan(base, {
      strategies: ['avalanche', 'snowball'],
      emergencyMonths: [undefined],
      extraMonthlies: [500, 1500],
      maxMonths: 60,
    });
    expect(result.candidates_evaluated).toBe(4);
    const extras = new Set(result.ranking.map((c) => c.config.extra_monthly));
    expect(extras.has(500)).toBe(true);
    expect(extras.has(1500)).toBe(true);
    // Higher extra should not produce higher interest for same strategy
    const ava500 = result.ranking.find(
      (c) => c.config.strategy === 'avalanche' && c.config.extra_monthly === 500,
    )!;
    const ava1500 = result.ranking.find(
      (c) => c.config.strategy === 'avalanche' && c.config.extra_monthly === 1500,
    )!;
    expect(ava1500.summary.total_interest).toBeLessThanOrEqual(ava500.summary.total_interest);
  });
});
