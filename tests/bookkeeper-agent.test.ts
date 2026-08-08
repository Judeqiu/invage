import { describe, expect, it } from 'vitest';
import { createBookkeeperTools, createInvageTools } from '../src/tools/index.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';

describe('Bookkeeper local agent', () => {
  it('exposes book tools only (no market analyzer / playbook / quote)', () => {
    const names = createBookkeeperTools().map((t) => t.name).sort();
    expect(names).toContain('get_household');
    expect(names).toContain('get_portfolio');
    expect(names).toContain('set_cash');
    expect(names).toContain('add_cash_flow');
    expect(names).toContain('run_projection');
    expect(names).not.toContain('portfolio_analyzer');
    expect(names).not.toContain('get_quote');
    expect(names).not.toContain('get_playbook');
    expect(names).not.toContain('update_playbook');
    expect(names).not.toContain('property_intel');
  });

  it('is a strict subset of Invester domain tool names for shared book surfaces', () => {
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const invage = new Set(createInvageTools().map((t) => t.name));
    for (const name of book) {
      expect(invage.has(name), `Invester missing shared tool ${name}`).toBe(true);
    }
  });

  it('registers Bookkeeper purpose and bookkeeping skill', () => {
    expect(bookkeeperExtension.purpose).toMatch(/Bookkeeper/i);
    expect(bookkeeperExtension.purpose).toMatch(/journal/i);
    expect(bookkeeperExtension.billing).toBeUndefined();
    expect(bookkeeperExtension.webUi).toBeUndefined();
    const skillIds = bookkeeperExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('bookkeeping');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).not.toContain('investment-analysis');
  });

  it('tools factory returns a fresh array each call', () => {
    const a = typeof bookkeeperExtension.tools === 'function'
      ? bookkeeperExtension.tools('jude', false)
      : bookkeeperExtension.tools;
    const b = typeof bookkeeperExtension.tools === 'function'
      ? bookkeeperExtension.tools('jude', false)
      : bookkeeperExtension.tools;
    expect(a).not.toBe(b);
    expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
  });
});
