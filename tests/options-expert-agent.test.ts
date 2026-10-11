import { describe, expect, it } from 'vitest';
import { createInvageTools, createOptionsExpertTools } from '../src/tools/index.js';
import { optionsExpertExtension } from '../src/agents/options-expert.js';

describe('OptionsExpert local agent', () => {
  it('owns options_insight plus read/research tools, no mutations', () => {
    const names = createOptionsExpertTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_portfolio',
        'get_playbook',
        'get_quote',
        'portfolio_analyzer',
        'options_insight',
        'save_report',
      ]),
    );
    expect(names).toHaveLength(6);
    const set = new Set(names);
    for (const forbidden of [
      'add_holding',
      'set_cash',
      'update_playbook',
      'build_payment_plan',
      'property_intel',
    ]) {
      expect(set.has(forbidden)).toBe(false);
    }
    expect(new Set(createInvageTools().map((t) => t.name)).has('options_insight')).toBe(false);
  });

  it('purpose requires options_insight, no invented Greeks, and host orchestration', () => {
    const p = optionsExpertExtension.purpose;
    expect(p).toMatch(/OptionsExpert/);
    expect(p).toMatch(/options_insight/);
    expect(p).toMatch(/Never invent Greeks|never invent Greeks/i);
    expect(p).toMatch(/defined vs undefined|undefined risk/i);
    expect(p).toMatch(/InvestmentAdvisor/);
    expect(p).toMatch(/Bookkeeper/);
    expect(p).toMatch(/Help-first/i);
    expect(p).toMatch(/licensed/i);
  });

  it('registers options-analysis skill', () => {
    const skill = optionsExpertExtension.skills.find((s) => s.id === 'options-analysis');
    expect(skill).toBeDefined();
    expect(skill!.description).toMatch(/call\/put|listed/i);
  });
});
