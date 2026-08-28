import { describe, expect, it } from 'vitest';
import {
  createBookkeeperTools,
  createFactcheckerTools,
  createFinancialPlannerTools,
  createInvageTools,
  createInvestmentAdvisorTools,
} from '../src/tools/index.js';
import { factcheckerExtension } from '../src/agents/factchecker.js';

const EXPECTED_TOOLS = [
  'get_portfolio',
  'list_journal_entries',
  'get_household',
  'get_treasury',
  'list_cash_flows',
  'get_projection_assumptions',
  'get_playbook',
  'get_scenario',
  'list_scenarios',
  'run_projection',
  'compare_scenarios',
  'get_quote',
  'portfolio_analyzer',
  'build_payment_plan',
  'estimate_opportunity_cost',
  'property_intel',
  'ura_carpark',
  'options_insight',
  'submit_factcheck_verdict',
] as const;

describe('Factchecker local agent', () => {
  it('has exact read-only tool set of length 19', () => {
    const names = createFactcheckerTools().map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(names).toHaveLength(19);
  });

  it('excludes mutations, optimize, snapshots, playbook updates, reports', () => {
    const names = new Set(createFactcheckerTools().map((t) => t.name));
    for (const forbidden of [
      'add_holding',
      'set_cash',
      'transfer_cash',
      'post_opening_balance',
      'update_playbook',
      'add_watch_product',
      'remove_watch_product',
      'optimize_payment_plan',
      'save_report',
      'send_report',
      'list_snapshots',
      'save_snapshot',
      'save_scenario',
      'delete_scenario',
    ]) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });

  it('purpose requires auditor role, verdict tool, and redo protocol', () => {
    const p = factcheckerExtension.purpose;
    expect(p).toMatch(/Factchecker/i);
    expect(p).toMatch(/submit_factcheck_verdict/);
    expect(p).toMatch(/PASS/);
    expect(p).toMatch(/FAIL/);
    expect(p).toMatch(/PASS_WITH_CAVEATS/);
    expect(p).toMatch(/0\.5%/);
    expect(p).toMatch(/list_journal_entries|journal/i);
    expect(p).toMatch(/Never invent|never invent/i);
    expect(p).toMatch(/invoke_local_agent/);
    expect(p).toMatch(/redo/i);
    expect(p).toMatch(/Tool-before-claim|re-run/i);
    expect(p).toMatch(/n\/a|books DB|not configured/i);
  });

  it('does not embed full HELP_FIRST create_task craft recipes', () => {
    // Tailored auditor help-first only — must not pull payment-plan task templates.
    expect(factcheckerExtension.purpose).not.toMatch(/optimize_payment_plan for best HARD-cost/);
    expect(factcheckerExtension.purpose).toMatch(/Auditor help-first/i);
  });

  it('defaults LLM routing to daily (fast audit; tools carry accuracy)', () => {
    expect(factcheckerExtension.llmRouting).toEqual({ default: 'daily' });
    expect(factcheckerExtension.llmHeavyHeuristics).toEqual({ keywords: [] });
  });

  it('room @mention label is a single token', () => {
    const mentionLabel = 'Factchecker';
    expect(mentionLabel).not.toMatch(/\s/);
    expect(mentionLabel).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
  });

  it('registers fact-audit skill only', () => {
    expect(factcheckerExtension.billing).toBeUndefined();
    expect(factcheckerExtension.webUi).toBeUndefined();
    const skillIds = factcheckerExtension.skills.map((s) => s.id);
    expect(skillIds).toEqual(['fact-audit']);
    expect(skillIds).not.toContain('payment-planning');
    expect(skillIds).not.toContain('investment-analysis');
    expect(skillIds).not.toContain('family-treasury');
    expect(skillIds).not.toContain('bookkeeping');
  });

  it('owns audit tools host and craft peers do not all share', () => {
    const fc = new Set(createFactcheckerTools().map((t) => t.name));
    const host = new Set(createInvageTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const fp = new Set(createFinancialPlannerTools().map((t) => t.name));
    const ia = new Set(createInvestmentAdvisorTools().map((t) => t.name));

    expect(fc.has('submit_factcheck_verdict')).toBe(true);
    expect(host.has('submit_factcheck_verdict')).toBe(false);
    expect(book.has('submit_factcheck_verdict')).toBe(false);
    expect(fp.has('submit_factcheck_verdict')).toBe(false);
    expect(ia.has('submit_factcheck_verdict')).toBe(false);

    expect(fc.has('list_journal_entries')).toBe(true);
    expect(fc.has('build_payment_plan')).toBe(true);
    expect(fc.has('optimize_payment_plan')).toBe(false);
  });
});
