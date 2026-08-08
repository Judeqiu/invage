import { describe, expect, it } from 'vitest';
import {
  createAccountantTools,
  createBookkeeperTools,
  createInvestmentExpertTools,
  createInvageTools,
} from '../src/tools/index.js';
import { investmentExpertExtension } from '../src/agents/investment-expert.js';

describe('Investment Expert local agent', () => {
  it('includes read/research tools only', () => {
    const names = createInvestmentExpertTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_portfolio',
        'get_playbook',
        'get_quote',
        'portfolio_analyzer',
        'save_report',
      ]),
    );
    expect(names).toHaveLength(5);
  });

  it('excludes mutations, household, payment plans, and playbook updates', () => {
    const names = new Set(createInvestmentExpertTools().map((t) => t.name));
    for (const forbidden of [
      'add_holding',
      'update_holding',
      'remove_holding',
      'set_cash',
      'clear_cash',
      'transfer_cash',
      'add_deposit',
      'update_playbook',
      'get_household',
      'build_payment_plan',
      'estimate_opportunity_cost',
      'property_intel',
      'send_report',
      'run_projection',
    ]) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('purpose requires tool-before-claim, agent KB, and hand-offs', () => {
    expect(investmentExpertExtension.purpose).toMatch(/Investment Expert/i);
    expect(investmentExpertExtension.purpose).toMatch(/Tool-before-claim/i);
    expect(investmentExpertExtension.purpose).toMatch(/agent KB|search_kb/i);
    expect(investmentExpertExtension.purpose).toMatch(/@Bookkeeper/);
    expect(investmentExpertExtension.purpose).toMatch(/@Accountant/);
    expect(investmentExpertExtension.purpose).toMatch(/@Invester/);
    expect(investmentExpertExtension.purpose).toMatch(/Never invent|never invent/i);
    expect(investmentExpertExtension.purpose).toMatch(/licensed/i);
  });

  it('defaults LLM routing to heavy', () => {
    expect(investmentExpertExtension.llmRouting).toEqual({ default: 'heavy' });
  });

  it('registers analysis skills only (no playbook wizard or payment-planning)', () => {
    expect(investmentExpertExtension.billing).toBeUndefined();
    expect(investmentExpertExtension.webUi).toBeUndefined();
    const skillIds = investmentExpertExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('investment-analysis');
    expect(skillIds).toContain('firecrawl');
    expect(skillIds).toContain('bindrive');
    expect(skillIds).not.toContain('playbook-setup');
    expect(skillIds).not.toContain('payment-planning');
    expect(skillIds).not.toContain('family-treasury');
    expect(skillIds).not.toContain('bookkeeping');
  });

  it('is narrower than Invester and orthogonal to Bookkeeper/Accountant toolsets', () => {
    const expert = new Set(createInvestmentExpertTools().map((t) => t.name));
    const invage = new Set(createInvageTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const acc = new Set(createAccountantTools().map((t) => t.name));

    for (const n of expert) {
      expect(invage.has(n)).toBe(true);
    }
    expect(book.has('portfolio_analyzer')).toBe(false);
    expect(book.has('get_playbook')).toBe(false);
    expect(acc.has('get_playbook')).toBe(false);
    expect(acc.has('save_report')).toBe(false);
    expect(expert.has('build_payment_plan')).toBe(false);
  });
});
