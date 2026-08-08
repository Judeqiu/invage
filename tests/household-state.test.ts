import { describe, it, expect } from 'vitest';
import {
  appendPropertyPayment,
  assertProperty,
  assertLiability,
  assertCashFlowLine,
  assertProjectionAssumptions,
  assertSavedScenario,
  assertTreasurySettings,
  normalizeProperties,
  propertyPaidToDate,
  upsertLiability,
  upsertProperty,
  removeProperty,
  type HouseholdInvestorState,
} from '../src/state/household-state.js';
import { annuityPayment } from '../src/treasury/amortize.js';

function blankState(): HouseholdInvestorState {
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000099',
      slug: 'test',
      created_at: '2026-07-29',
      telegram_user_ids: [],
      auth_token: '00000000-0000-4000-8000-000000000098',
    },
    profile: { display_name: 'T', contact_email: 't@example.com' },
    log: [],
  } as HouseholdInvestorState;
}

describe('household-state validation', () => {
  it('validates treasury', () => {
    const t = assertTreasurySettings({
      reporting_currency: 'sgd',
      updated_at: '2026-07-29',
    });
    expect(t.reporting_currency).toBe('SGD');
  });

  it('rejects bad currency', () => {
    expect(() =>
      assertTreasurySettings({ reporting_currency: 'US', updated_at: '2026-07-29' }),
    ).toThrow(/3–4 letter/);
  });

  it('validates property and cash flow', () => {
    const p = assertProperty({
      id: 'prop-1',
      value: 1e6,
      currency: 'SGD',
      updated_at: '2026-07-29',
      label: 'Home',
    });
    expect(p.id).toBe('prop-1');
    expect(p.payments).toBeUndefined();
    expect(propertyPaidToDate(p)).toBeNull();
    const cf = assertCashFlowLine({
      id: 'cf-1',
      kind: 'income',
      amount: 1000,
      currency: 'SGD',
      frequency: 'monthly',
      start_date: '2026-01-01',
      updated_at: '2026-07-29',
    });
    expect(cf.kind).toBe('income');
  });

  it('validates property payments ledger and paid_to_date', () => {
    const p = assertProperty({
      id: 'prop-8bt',
      value: 2_200_000,
      currency: 'SGD',
      updated_at: '2026-08-03',
      label: '8@BT #1708',
      payments: [
        { date: '2026-08-03', amount: 109_100, label: 'OTP option lock ~5%' },
      ],
    });
    expect(p.payments).toHaveLength(1);
    expect(propertyPaidToDate(p)).toBe(109_100);

    expect(() =>
      assertProperty({
        id: 'prop-bad',
        value: 1,
        currency: 'SGD',
        updated_at: '2026-08-03',
        payments: null,
      }),
    ).toThrow(/omit the field/);

    expect(() =>
      assertProperty({
        id: 'prop-bad2',
        value: 1,
        currency: 'SGD',
        updated_at: '2026-08-03',
        payments: [{ date: '2026-08-03', amount: -1 }],
      }),
    ).toThrow(/>= 0|≥ 0/);
  });

  it('appends property payment and keeps mark unchanged', () => {
    const state = blankState();
    upsertProperty(state, {
      id: 'prop-8bt-1708',
      value: 2_200_000,
      currency: 'SGD',
      updated_at: '2026-08-03',
      label: '8@BT #1708',
    });
    expect(propertyPaidToDate(state.properties![0])).toBeNull();

    const after = appendPropertyPayment(
      state,
      'prop-8bt-1708',
      { date: '2026-08-03', amount: 109_100, label: 'OTP option lock ~5%' },
      '2026-08-03',
    );
    expect(after.value).toBe(2_200_000);
    expect(propertyPaidToDate(after)).toBe(109_100);
    expect(after.payments).toEqual([
      { date: '2026-08-03', amount: 109_100, label: 'OTP option lock ~5%' },
    ]);

    appendPropertyPayment(
      state,
      'prop-8bt-1708',
      { date: '2026-09-15', amount: 220_000, label: 'PPS foundation' },
      '2026-09-15',
    );
    const again = state.properties!.find((x) => x.id === 'prop-8bt-1708')!;
    expect(propertyPaidToDate(again)).toBe(329_100);
  });

  it('empty payments array means known-zero paid (not unknown)', () => {
    const p = assertProperty({
      id: 'prop-empty-pay',
      value: 500_000,
      currency: 'SGD',
      updated_at: '2026-08-03',
      payments: [],
    });
    expect(propertyPaidToDate(p)).toBe(0);
  });

  it('requires mortgage property_id', () => {
    expect(() =>
      assertLiability({
        id: 'm1',
        kind: 'mortgage',
        principal: 100,
        annual_rate_pct: 3,
        currency: 'SGD',
        start_date: '2026-01-01',
        term_months: 12,
        payment_amount: 10,
        payment_frequency: 'monthly',
        updated_at: '2026-07-29',
      }),
    ).toThrow(/property_id/);
  });

  it('links mortgage to existing property', () => {
    const state = blankState();
    upsertProperty(state, {
      id: 'home',
      value: 800_000,
      currency: 'SGD',
      updated_at: '2026-07-29',
    });
    const payment = annuityPayment(400_000, 3, 360);
    upsertLiability(state, {
      id: 'mortgage-1',
      kind: 'mortgage',
      principal: 400_000,
      annual_rate_pct: 3,
      currency: 'SGD',
      start_date: '2026-01-01',
      term_months: 360,
      payment_amount: payment,
      payment_frequency: 'monthly',
      property_id: 'home',
      updated_at: '2026-07-29',
    });
    expect(normalizeProperties(state.properties)[0].mortgage_id).toBe('mortgage-1');
    expect(() => removeProperty(state, 'home')).toThrow(/still references/);
  });

  it('validates assumptions and scenarios', () => {
    const a = assertProjectionAssumptions({
      portfolio_return_annual_pct: 5,
      inflation_annual_pct: 2,
      updated_at: '2026-07-29',
      fx: { USD: 1.3 },
    });
    expect(a.fx?.USD).toBe(1.3);

    const sc = assertSavedScenario({
      id: 'sc1',
      label: 'House',
      updated_at: '2026-07-29',
      events: [
        {
          type: 'buy_property',
          date: '2028-01-01',
          property_value: 1e6,
          currency: 'SGD',
          down_payment: 200_000,
          mortgage: { annual_rate_pct: 3.5, term_months: 360 },
        },
      ],
    });
    expect(sc.events).toHaveLength(1);
  });
});
