import { describe, expect, it } from 'vitest';
import {
  createInvageTools,
  createRealEstateExpertTools,
} from '../src/tools/index.js';
import { realEstateExpertExtension } from '../src/agents/real-estate-expert.js';

describe('Real Estate Expert local agent', () => {
  it('includes property + household tools for RE sleeve work', () => {
    const names = createRealEstateExpertTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'property_intel',
        'ura_carpark',
        'get_household',
        'get_portfolio',
        'run_projection',
      ]),
    );
  });

  it('excludes securities analysis and payment-plan tools', () => {
    const names = new Set(createRealEstateExpertTools().map((t) => t.name));
    for (const forbidden of [
      'portfolio_analyzer',
      'get_quote',
      'get_playbook',
      'update_playbook',
      'build_payment_plan',
      'estimate_opportunity_cost',
      'save_report',
      'add_holding',
    ]) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it('purpose requires tool-before-claim, agent KB, and property hand-offs', () => {
    expect(realEstateExpertExtension.purpose).toMatch(/Real Estate Expert/i);
    expect(realEstateExpertExtension.purpose).toMatch(/Tool-before-claim/i);
    expect(realEstateExpertExtension.purpose).toMatch(/agent KB|search_kb/i);
    expect(realEstateExpertExtension.purpose).toMatch(/property_intel|comps/i);
    expect(realEstateExpertExtension.purpose).toMatch(/@InvestmentExpert|Investment Expert/i);
    expect(realEstateExpertExtension.purpose).toMatch(/never invent/i);
    expect(realEstateExpertExtension.purpose).toMatch(/licensed/i);
  });

  it('defaults LLM routing to heavy', () => {
    expect(realEstateExpertExtension.llmRouting).toEqual({ default: 'heavy' });
  });

  it('registers RE skills only', () => {
    expect(realEstateExpertExtension.billing).toBeUndefined();
    expect(realEstateExpertExtension.webUi).toBeUndefined();
    const skillIds = realEstateExpertExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('sg-real-estate-portfolio');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).toContain('firecrawl');
    expect(skillIds).not.toContain('investment-analysis');
    expect(skillIds).not.toContain('playbook-setup');
  });

  it('owns property_intel that default orchestrator does not', () => {
    const expert = new Set(createRealEstateExpertTools().map((t) => t.name));
    const host = new Set(createInvageTools().map((t) => t.name));
    expect(expert.has('property_intel')).toBe(true);
    expect(expert.has('ura_carpark')).toBe(true);
    expect(host.has('property_intel')).toBe(false);
    expect(host.has('ura_carpark')).toBe(false);
  });
});
