import { describe, expect, it } from 'vitest';
import {
  createAccountantTools,
  createBookkeeperTools,
  createInvestmentExpertTools,
  createInvageTools,
} from '../src/tools/index.js';
import { invageExtension } from '../src/extension.js';
import { registerInvageSkills } from '../src/skills.js';

describe('Invester default orchestrator', () => {
  it('domain tools are residual host only (no peer craft)', () => {
    const names = new Set(createInvageTools().map((t) => t.name));
    expect(names.has('get_playbook')).toBe(true);
    expect(names.has('update_playbook')).toBe(true);
    expect(names.has('get_household')).toBe(true);
    expect(names.has('property_intel')).toBe(true);

    for (const forbidden of [
      'add_holding',
      'set_cash',
      'get_portfolio',
      'portfolio_analyzer',
      'get_quote',
      'build_payment_plan',
      'estimate_opportunity_cost',
      'save_report',
      'send_report',
    ]) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });

  it('purpose requires always-route orchestration and no keyword matching', () => {
    expect(invageExtension.purpose).toMatch(/orchestrat/i);
    expect(invageExtension.purpose).toMatch(/invoke_local_agent/);
    expect(invageExtension.purpose).toMatch(/always/i);
    expect(invageExtension.purpose).toMatch(/capability fit/i);
    expect(invageExtension.purpose).toMatch(/keyword/i);
    expect(invageExtension.purpose).toMatch(/Investment Expert/i);
    expect(invageExtension.purpose).toMatch(/Bookkeeper/i);
    expect(invageExtension.purpose).toMatch(/Accountant/i);
    expect(invageExtension.purpose).toMatch(/DIY is forbidden|do not perform that work|Never DIY/i);
  });

  it('default skills exclude investment-analysis and firecrawl DIY research', () => {
    const ids = invageExtension.skills.map((s) => s.id);
    expect(ids).toContain('playbook-setup');
    expect(ids).toContain('family-treasury');
    expect(ids).toContain('sg-real-estate-portfolio');
    expect(ids).not.toContain('investment-analysis');
    expect(ids).not.toContain('firecrawl');
  });

  it('specialists own craft tools the orchestrator does not', () => {
    const host = new Set(createInvageTools().map((t) => t.name));
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const acc = new Set(createAccountantTools().map((t) => t.name));
    const expert = new Set(createInvestmentExpertTools().map((t) => t.name));

    expect(book.has('add_holding')).toBe(true);
    expect(host.has('add_holding')).toBe(false);

    expect(acc.has('build_payment_plan')).toBe(true);
    expect(host.has('build_payment_plan')).toBe(false);

    expect(expert.has('portfolio_analyzer')).toBe(true);
    expect(host.has('portfolio_analyzer')).toBe(false);
  });

  it('registerInvageSkills matches extension skill catalog ids', () => {
    const fromReg = new Set(registerInvageSkills().map((s) => s.id));
    for (const s of invageExtension.skills) {
      expect(fromReg.has(s.id)).toBe(true);
    }
  });
});
