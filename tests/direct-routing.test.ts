import { describe, expect, it } from 'vitest';
import { buildHostPurpose } from '../src/extension.js';
import { createInvageTools } from '../src/tools/index.js';
import { helpFirstAndAsyncTasks } from '../src/agents/help-first.js';

describe('direct lookup routing boundaries', () => {
  it.each(['full', 'consultant'] as const)('%s host skips experts for retrieval but preserves escalation', profile => {
    const purpose = buildHostPurpose(profile);
    expect(purpose).toContain('Direct lookup — zero expert calls');
    expect(purpose).toContain('Do not invoke OptionsExpert, Bookkeeper or Factchecker for these requests');
    expect(purpose).toContain('Explicit requests for an installed expert or independent audit');
    expect(purpose).toContain('disputed evidence');
    expect(purpose).toContain('Bookkeeper owns writes, sync and unresolved reconciliation');
    expect(purpose).not.toMatch(/always-last|always route real work|DIY is forbidden|must consult options-expert/i);
    expect(purpose).toContain('Do not widen the date range');
    expect(purpose).toContain('next_offset and expected_revision');
    expect(purpose).toContain('Scheduled runs follow the same routing policy');
  });

  it('host can retrieve dates and exact quotes without gaining ledger writes or strategy tools', () => {
    const names = createInvageTools().map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_portfolio', 'list_option_trades', 'query_data', 'get_quote', 'get_option_quotes']));
    expect(new Set(names).size).toBe(names.length);
    for (const name of ['sync_broker', 'add_holding', 'set_cash', 'post_adjustment', 'options_insight', 'optimize_payment_plan']) {
      expect(names).not.toContain(name);
    }
  });

  it('consultant monitoring does not force expert consultations for routine quotes', () => {
    const guidance = helpFirstAndAsyncTasks('consultant');
    expect(guidance).toContain('retrieve records and quotes directly');
    expect(guidance).not.toContain('must consult options-expert');
  });
});
