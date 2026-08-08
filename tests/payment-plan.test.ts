import { describe, expect, it } from 'vitest';
import {
  buildPaymentPlan,
  impliedDepositAnnualPct,
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
