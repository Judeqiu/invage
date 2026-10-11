import { describe, expect, it } from 'vitest';
import {
  createFinancialPlannerTools,
  createBookkeeperTools,
  createInvageTools,
} from '../src/tools/index.js';
import { financialPlannerExtension } from '../src/agents/financial-planner.js';

describe('FinancialPlanner local agent', () => {
  it('includes position + payment plan tools and live marks (read-only books)', () => {
    const names = createFinancialPlannerTools().map((t) => t.name);
    expect(names).toContain('get_household');
    expect(names).toContain('get_portfolio');
    expect(names).toContain('optimize_payment_plan');
    expect(names).toContain('build_payment_plan');
    expect(names).toContain('estimate_opportunity_cost');
    expect(names).toContain('get_quote');
    expect(names).toContain('portfolio_analyzer');
    expect(names).toContain('run_projection');
    expect(names).not.toContain('get_playbook');
    expect(names).not.toContain('property_intel');
    // Books writes are Bookkeeper-only
    for (const w of [
      'set_cash',
      'add_holding',
      'transfer_cash',
      'record_property_payment',
      'add_property',
      'set_treasury',
      'save_snapshot',
      'save_scenario',
    ]) {
      expect(names).not.toContain(w);
    }
  });

  it('purpose requires payments ledger not scenarios for paid-to-date', () => {
    expect(financialPlannerExtension.purpose).toMatch(/properties\[\]\.payments/);
    expect(financialPlannerExtension.purpose).toMatch(/not a payment ledger/i);
  });

  it('purpose bans invented yields and requires estimate_opportunity_cost', () => {
    expect(financialPlannerExtension.purpose).toMatch(/Never invent yields/i);
    expect(financialPlannerExtension.purpose).toMatch(/estimate_opportunity_cost/);
    expect(financialPlannerExtension.purpose).toMatch(/HARD/);
    expect(financialPlannerExtension.purpose).toMatch(/SOFT/);
    expect(financialPlannerExtension.purpose).toMatch(/agent KB|search_kb/i);
  });

  it('defaults LLM routing to heavy (Kimi k3 profile on host)', () => {
    expect(financialPlannerExtension.llmRouting).toEqual({ default: 'heavy' });
  });

  it('has optimize_payment_plan + build_payment_plan while Bookkeeper does not', () => {
    const acc = new Set(createFinancialPlannerTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    expect(acc.has('optimize_payment_plan')).toBe(true);
    expect(acc.has('build_payment_plan')).toBe(true);
    expect(book.has('optimize_payment_plan')).toBe(false);
    expect(book.has('build_payment_plan')).toBe(false);
  });

  it('default orchestrator does not own payment-plan tools (FinancialPlanner does)', () => {
    expect(createInvageTools().map((t) => t.name)).not.toContain('build_payment_plan');
    expect(createInvageTools().map((t) => t.name)).not.toContain('optimize_payment_plan');
    expect(createFinancialPlannerTools().map((t) => t.name)).toContain('optimize_payment_plan');
  });

  it('purpose requires combination search for min cost / max gain', () => {
    expect(financialPlannerExtension.purpose).toMatch(/optimize_payment_plan/);
    expect(financialPlannerExtension.purpose).toMatch(/combination|cartesian|search/i);
    expect(financialPlannerExtension.purpose).toMatch(/minimi[sz]e/i);
  });

  it('purpose requires help-first and create_task for deferred re-plans', () => {
    expect(financialPlannerExtension.purpose).toMatch(/Help-first/i);
    expect(financialPlannerExtension.purpose).toMatch(/create_task/);
    expect(financialPlannerExtension.purpose).toMatch(/maturity|matures/i);
  });

  it('registers FinancialPlanner purpose and payment-planning skill', () => {
    expect(financialPlannerExtension.purpose).toMatch(/FinancialPlanner/i);
    expect(financialPlannerExtension.purpose).toMatch(/avalanche/i);
    expect(financialPlannerExtension.billing).toBeUndefined();
    expect(financialPlannerExtension.webUi).toBeUndefined();
    const skillIds = financialPlannerExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('payment-planning');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).not.toContain('investment-analysis');
  });
});
