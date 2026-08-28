import { describe, expect, it } from 'vitest';
import { createBookkeeperTools, createInvageTools } from '../src/tools/index.js';
import { bookkeeperExtension } from '../src/agents/bookkeeper.js';

describe('Bookkeeper local agent', () => {
  it('exposes book tools only (no market analyzer / playbook / quote)', () => {
    const names = createBookkeeperTools().map((t) => t.name).sort();
    expect(names).toContain('get_household');
    expect(names).toContain('record_property_payment');
    expect(names).toContain('get_portfolio');
    expect(names).toContain('post_opening_balance');
    expect(names).toContain('post_adjustment');
    expect(names).toContain('start_recon');
    expect(names).toContain('get_recon');
    expect(names).toContain('source_recon_channel');
    expect(names).toContain('decide_recon_line');
    expect(names).toContain('apply_recon_channel');
    expect(names).toContain('skip_recon_channel');
    expect(names).not.toContain('set_cash');
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
    expect(book.has('post_opening_balance')).toBe(true);
    expect(book.has('post_adjustment')).toBe(true);
    expect(invage.has('add_holding')).toBe(false);
    expect(invage.has('post_adjustment')).toBe(false);
    expect(invage.has('start_recon')).toBe(false);
    expect(book.has('start_recon')).toBe(true);
    expect(invage.has('set_cash')).toBe(false);
    // Host may read household; must not write books
    expect(book.has('get_household')).toBe(true);
    expect(invage.has('get_household')).toBe(true);
    expect(invage.has('set_treasury')).toBe(false);
    expect(invage.has('record_property_payment')).toBe(false);
    expect(invage.has('save_scenario')).toBe(false);
  });

  it('is the sole agent with books write tools among peers', async () => {
    const { createFinancialPlannerTools, createInvestmentAdvisorTools, createRealEstateExpertTools } =
      await import('../src/tools/index.js');
    const writers = [
      'post_opening_balance',
      'post_adjustment',
      'add_holding',
      'transfer_cash',
      'record_property_payment',
      'add_property',
      'set_treasury',
      'save_snapshot',
      'save_scenario',
      'set_projection_assumptions',
    ];
    const book = new Set(createBookkeeperTools().map((t) => t.name));
    for (const w of writers) {
      expect(book.has(w)).toBe(true);
    }
    for (const factory of [
      createFinancialPlannerTools,
      createInvestmentAdvisorTools,
      createRealEstateExpertTools,
      createInvageTools,
    ]) {
      const names = new Set(factory().map((t) => t.name));
      for (const w of writers) {
        expect(names.has(w)).toBe(false);
      }
    }
  });

  it('registers Bookkeeper purpose and bookkeeping skill', () => {
    expect(bookkeeperExtension.purpose).toMatch(/Bookkeeper/i);
    expect(bookkeeperExtension.purpose).toMatch(/journal/i);
    expect(bookkeeperExtension.purpose).toMatch(/instrument=fund/);
    expect(bookkeeperExtension.purpose).toMatch(/fund_quote_source/);
    expect(bookkeeperExtension.purpose).toMatch(/adjust_cash=false/);
    expect(bookkeeperExtension.purpose).toMatch(/Screenshot fund reconcile/i);
    expect(bookkeeperExtension.purpose).toMatch(/start_recon/);
    expect(bookkeeperExtension.purpose).toMatch(/source_recon_channel/);
    expect(bookkeeperExtension.purpose).toMatch(/agent KB|search_kb/i);
    expect(bookkeeperExtension.purpose).toMatch(/Help-first/i);
    expect(bookkeeperExtension.purpose).toMatch(/create_task/);
    expect(bookkeeperExtension.billing).toBeUndefined();
    expect(bookkeeperExtension.webUi).toBeUndefined();
    const skillIds = bookkeeperExtension.skills.map((s) => s.id);
    expect(skillIds).toContain('bookkeeping');
    expect(skillIds).toContain('family-treasury');
    expect(skillIds).toContain('broker-integration');
    expect(skillIds).toContain('ibkr-flex');
    expect(skillIds).not.toContain('investment-analysis');
    const broker = bookkeeperExtension.skills.find((s) => s.id === 'broker-integration');
    expect(broker?.description).toMatch(/csv_tables|apply_broker_statement/);
    expect(broker?.description).toMatch(/ibkr/);
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
