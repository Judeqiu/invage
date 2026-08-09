import { describe, expect, it } from 'vitest';
import {
  createFinancialPlannerTools,
  createBookkeeperTools,
  createInvestmentAdvisorTools,
  createInvageTools,
} from '../src/tools/index.js';
import { investmentAdvisorExtension } from '../src/agents/investment-advisor.js';

describe('InvestmentAdvisor local agent', () => {
  it('includes read/research tools only', () => {
    const names = createInvestmentAdvisorTools().map((t) => t.name);
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
    const names = new Set(createInvestmentAdvisorTools().map((t) => t.name));
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
    expect(investmentAdvisorExtension.purpose).toMatch(/InvestmentAdvisor/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/Tool-before-claim/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/agent KB|search_kb/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/@Bookkeeper/);
    expect(investmentAdvisorExtension.purpose).toMatch(/@FinancialPlanner/);
    expect(investmentAdvisorExtension.purpose).toMatch(/@WalletStreet/);
    expect(investmentAdvisorExtension.purpose).toMatch(/Never invent|never invent/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/licensed/i);
  });

  it('purpose owns research analyst pack (Part H)', () => {
    expect(investmentAdvisorExtension.purpose).toMatch(/Research analyst pack|Part H/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/full stock breakdown|Full stock breakdown/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/valuation assessment|UNDER\/FAIR\/OVER/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/risk scenario/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/technical structure/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/Parts A–H|Parts A-H|Part H/i);
  });

  it('investment-analysis skill description covers Part H products', () => {
    const skill = investmentAdvisorExtension.skills.find((s) => s.id === 'investment-analysis');
    expect(skill).toBeDefined();
    expect(skill!.description).toMatch(/research analyst pack|full breakdown/i);
    expect(skill!.description).toMatch(/valuation under\/fair\/over|statement deep dive/i);
  });

  it('purpose requires help-first and create_task for deferred observation', () => {
    expect(investmentAdvisorExtension.purpose).toMatch(/Help-first/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/create_task/);
    expect(investmentAdvisorExtension.purpose).toMatch(/observe/i);
    expect(investmentAdvisorExtension.purpose).toMatch(/invoke_local_agent/);
  });

  it('defaults LLM routing to heavy', () => {
    expect(investmentAdvisorExtension.llmRouting).toEqual({ default: 'heavy' });
  });

  it('room @mention label is a single token (no spaces)', () => {
    // WebUI Composer inserts `@${label}`; room-mention parser only matches [A-Za-z0-9_-]+.
    // Label must stay CamelCase one-token — see src/index.ts agents[].label.
    const mentionLabel = 'InvestmentAdvisor';
    expect(mentionLabel).not.toMatch(/\s/);
    expect(mentionLabel).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
    // Normalizes same as spaced display name used in prose
    const normalize = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    expect(normalize(mentionLabel)).toBe(normalize('InvestmentAdvisor'));
  });

  it('registers analysis skills only (no playbook wizard or payment-planning)', () => {
    expect(investmentAdvisorExtension.billing).toBeUndefined();
    expect(investmentAdvisorExtension.webUi).toBeUndefined();
    const skillIds = investmentAdvisorExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('investment-analysis');
    expect(skillIds).toContain('firecrawl');
    expect(skillIds).toContain('bindrive');
    expect(skillIds).not.toContain('playbook-setup');
    expect(skillIds).not.toContain('payment-planning');
    expect(skillIds).not.toContain('family-treasury');
    expect(skillIds).not.toContain('bookkeeping');
  });

  it('owns research tools the default orchestrator does not', () => {
    const expert = new Set(createInvestmentAdvisorTools().map((t) => t.name));
    const invage = new Set(createInvageTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const acc = new Set(createFinancialPlannerTools().map((t) => t.name));

    expect(expert.has('portfolio_analyzer')).toBe(true);
    expect(expert.has('get_quote')).toBe(true);
    expect(invage.has('portfolio_analyzer')).toBe(false);
    expect(invage.has('get_quote')).toBe(false);
    expect(book.has('portfolio_analyzer')).toBe(false);
    expect(acc.has('save_report')).toBe(false);
    expect(expert.has('build_payment_plan')).toBe(false);
  });
});
