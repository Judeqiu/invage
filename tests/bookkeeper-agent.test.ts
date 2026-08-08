import { describe, expect, it } from 'vitest';
import { createBookkeeperTools, createInvageTools } from '../src/tools/index.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';

describe('Bookkeeper local agent', () => {
  it('exposes book tools only (no market analyzer / playbook / quote)', () => {
    const names = createBookkeeperTools().map((t) => t.name).sort();
    expect(names).toContain('get_household');
    expect(names).toContain('record_property_payment');
    expect(names).toContain('get_portfolio');
    expect(names).toContain('set_cash');
    expect(names).toContain('transfer_cash');
    expect(names).toContain('mature_deposit');
    expect(names).toContain('add_cash_flow');
    expect(names).toContain('run_projection');
    expect(names).not.toContain('portfolio_analyzer');
    expect(names).not.toContain('get_quote');
    expect(names).not.toContain('get_playbook');
    expect(names).not.toContain('update_playbook');
    expect(names).not.toContain('property_intel');
  });

  it('owns ledger tools that default orchestrator does not', () => {
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    const invage = new Set(createInvageTools().map((t) => t.name));
    expect(book.has('add_holding')).toBe(true);
    expect(book.has('set_cash')).toBe(true);
    expect(invage.has('add_holding')).toBe(false);
    expect(invage.has('set_cash')).toBe(false);
    // Shared residual surfaces may still exist on host (household projections)
    expect(book.has('get_household')).toBe(true);
    expect(invage.has('get_household')).toBe(true);
  });

  it('registers Bookkeeper purpose and bookkeeping skill', () => {
    expect(bookkeeperExtension.purpose).toMatch(/Bookkeeper/i);
    expect(bookkeeperExtension.purpose).toMatch(/journal/i);
    expect(bookkeeperExtension.purpose).toMatch(/instrument=fund/);
    expect(bookkeeperExtension.purpose).toMatch(/fund_quote_source/);
    expect(bookkeeperExtension.purpose).toMatch(/adjust_cash=false/);
    expect(bookkeeperExtension.purpose).toMatch(/Screenshot fund reconcile/i);
    expect(bookkeeperExtension.purpose).toMatch(/agent KB|search_kb/i);
    expect(bookkeeperExtension.purpose).toMatch(/Help-first/i);
    expect(bookkeeperExtension.purpose).toMatch(/create_task/);
    expect(bookkeeperExtension.billing).toBeUndefined();
    expect(bookkeeperExtension.webUi).toBeUndefined();
    const skillIds = bookkeeperExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('bookkeeping');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).not.toContain('investment-analysis');
    const bookkeeping = bookkeeperExtension.skills.find((s) => s.id === 'bookkeeping');
    expect(bookkeeping?.description).toMatch(/agent KB|search_kb|fund/i);
  });

  it('add_holding exposes prepareArguments for screenshot number coercion', () => {
    const add = createBookkeeperTools().find((t) => t.name === 'add_holding');
    expect(add?.prepareArguments).toBeTypeOf('function');
    const coerced = add!.prepareArguments!({
      ticker: 'EASTSPRING-ASB',
      avg_price: '20,000.00',
      units: '1',
      mark: '19,340.22',
      instrument: 'fund',
      fund_quote_source: 'manual',
      adjust_cash: false,
      channel: 'ocbc',
    });
    expect(coerced.avg_price).toBe(20000);
    expect(coerced.units).toBe(1);
    expect(coerced.mark).toBe(19340.22);
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
