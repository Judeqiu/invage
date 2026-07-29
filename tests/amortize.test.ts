import { describe, it, expect } from 'vitest';
import {
  annuityPayment,
  assertPaymentMatchesAnnuity,
  amortizeMonth,
  monthsBetween,
  remainingTermMonths,
  addMonths,
} from '../src/treasury/amortize.js';

describe('amortize', () => {
  it('computes zero-rate payment as principal/n', () => {
    expect(annuityPayment(12000, 0, 12)).toBeCloseTo(1000, 6);
  });

  it('computes standard mortgage payment', () => {
    // 1_000_000 @ 3.6% for 360 months — classic formula
    const pmt = annuityPayment(1_000_000, 3.6, 360);
    expect(pmt).toBeGreaterThan(4500);
    expect(pmt).toBeLessThan(4600);
    assertPaymentMatchesAnnuity(1_000_000, 3.6, 360, pmt);
  });

  it('fails mismatched payment', () => {
    expect(() =>
      assertPaymentMatchesAnnuity(100_000, 5, 120, 500),
    ).toThrow(/does not match annuity payment/);
  });

  it('amortizeMonth reduces principal', () => {
    const pmt = annuityPayment(100_000, 6, 120);
    const step = amortizeMonth(100_000, 6, pmt);
    expect(step.interest).toBeCloseTo(100_000 * 0.06 / 12, 6);
    expect(step.principalPaid).toBeGreaterThan(0);
    expect(step.remainingPrincipal).toBeLessThan(100_000);
    expect(step.remainingPrincipal + step.principalPaid).toBeCloseTo(100_000, 6);
  });

  it('pays off early when payment covers balance', () => {
    const step = amortizeMonth(100, 0, 1000);
    expect(step.remainingPrincipal).toBe(0);
    expect(step.principalPaid).toBe(100);
  });

  it('monthsBetween and remainingTermMonths', () => {
    expect(monthsBetween('2026-01-15', '2026-07-01')).toBe(6);
    expect(remainingTermMonths('2026-01-01', 360, '2026-01-01')).toBe(360);
    expect(remainingTermMonths('2020-01-01', 12, '2026-01-01')).toBe(0);
  });

  it('addMonths rolls years', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
  });
});
