import { describe, it, expect } from 'vitest';
import {
  assertProperty,
  assertLiability,
  assertCashFlowLine,
  assertProjectionAssumptions,
  assertSavedScenario,
  assertTreasurySettings,
  normalizeProperties,
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
