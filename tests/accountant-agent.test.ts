import { describe, expect, it } from 'vitest';
import {
  createAccountantTools,
  createBookkeeperTools,
  createInvageTools,
} from '../src/tools/index.js';
import { accountantExtension } from '../src/agents/accountant.js';

describe('Accountant local agent', () => {
  it('includes position + payment plan tools and live marks', () => {
    const names = createAccountantTools().map((t) => t.name);
    expect(names).toContain('get_household');
    expect(names).toContain('get_portfolio');
    expect(names).toContain('record_property_payment');
    expect(names).toContain('build_payment_plan');
    expect(names).toContain('estimate_opportunity_cost');
    expect(names).toContain('get_quote');
    expect(names).toContain('portfolio_analyzer');
    expect(names).toContain('run_projection');
    expect(names).not.toContain('get_playbook');
    expect(names).not.toContain('property_intel');
  });

  it('purpose requires payments ledger not scenarios for paid-to-date', () => {
    expect(accountantExtension.purpose).toMatch(/properties\[\]\.payments/);
    expect(accountantExtension.purpose).toMatch(/not a payment ledger/i);
  });

  it('purpose bans invented yields and requires estimate_opportunity_cost', () => {
    expect(accountantExtension.purpose).toMatch(/Never invent yields/i);
    expect(accountantExtension.purpose).toMatch(/estimate_opportunity_cost/);
    expect(accountantExtension.purpose).toMatch(/HARD/);
    expect(accountantExtension.purpose).toMatch(/SOFT/);
    expect(accountantExtension.purpose).toMatch(/agent KB|search_kb/i);
  });

  it('defaults LLM routing to heavy (Kimi k3 profile on host)', () => {
    expect(accountantExtension.llmRouting).toEqual({ default: 'heavy' });
  });

  it('has build_payment_plan while Bookkeeper does not', () => {
    const acc = new Set(createAccountantTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    expect(acc.has('build_payment_plan')).toBe(true);
    expect(book.has('build_payment_plan')).toBe(false);
  });

  it('Invester also exposes build_payment_plan for default-agent access', () => {
    expect(createInvageTools().map((t) => t.name)).toContain('build_payment_plan');
  });

  it('registers Accountant purpose and payment-planning skill', () => {
    expect(accountantExtension.purpose).toMatch(/Accountant/i);
    expect(accountantExtension.purpose).toMatch(/avalanche/i);
    expect(accountantExtension.billing).toBeUndefined();
    expect(accountantExtension.webUi).toBeUndefined();
    const skillIds = accountantExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('payment-planning');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).not.toContain('investment-analysis');
  });
});
