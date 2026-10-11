import { describe, expect, it } from 'vitest';
import { createAidealTools, createBookkeeperTools, createInvageTools } from '../src/tools/index.js';
import { aidealExtension } from '../src/agents/aideal.js';

describe('AIDeal local agent', () => {
  it('owns production tools plus read/research helpers', () => {
    const names = createAidealTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_aideal_sleeves',
        'compute_sleeve_index',
        'save_aideal_newsletter',
        'get_portfolio',
        'get_quote',
        'portfolio_analyzer',
        'save_report',
      ]),
    );
    expect(names).toHaveLength(7);
  });

  it('excludes ledger mutations', () => {
    const names = new Set(createAidealTools().map((t) => t.name));
    for (const forbidden of ['add_holding', 'set_cash', 'update_playbook', 'submit_factcheck_verdict']) {
      expect(names.has(forbidden)).toBe(false);
    }
    expect(createBookkeeperTools().map((t) => t.name)).toContain('add_holding');
    expect(createInvageTools().map((t) => t.name)).not.toContain('compute_sleeve_index');
  });

  it('purpose is production-only and hands off thesis and books', () => {
    expect(aidealExtension.purpose).toMatch(/AIDeal/);
    expect(aidealExtension.purpose).toMatch(/compute_sleeve_index/);
    expect(aidealExtension.purpose).toMatch(/save_aideal_newsletter/);
    expect(aidealExtension.purpose).toMatch(/@Bookkeeper/);
    expect(aidealExtension.purpose).toMatch(/@InvestmentAdvisor/);
    expect(aidealExtension.purpose).toMatch(/Not installed/);
    expect(aidealExtension.purpose).toMatch(/Help-first/i);
    const skill = aidealExtension.skills.find((s) => s.id === 'aideal-production');
    expect(skill).toBeDefined();
  });

  it('list_aideal_sleeves returns the catalog without network', async () => {
    const tool = createAidealTools().find((t) => t.name === 'list_aideal_sleeves');
    expect(tool).toBeDefined();
    const result = await tool!.execute('1', {});
    const text = result.content.map((c) => ('text' in c ? c.text : '')).join('\n');
    expect(text).toMatch(/healthcare/);
    expect(text).toMatch(/IYH/);
    expect(result.details).toMatchObject({
      sleeves: expect.arrayContaining([expect.objectContaining({ id: 'overall', benchmark: 'SPY' })]),
    });
  });

  it('compute_sleeve_index fails fast without report_date shape or lots', async () => {
    const tool = createAidealTools().find((t) => t.name === 'compute_sleeve_index');
    expect(tool).toBeDefined();
    const badDate = await tool!.execute('1', { sleeve_id: 'healthcare', report_date: 'Aug 18' });
    expect(badDate.content.map((c) => ('text' in c ? c.text : '')).join('')).toMatch(
      /YYYY-MM-DD/,
    );
    const noLots = await tool!.execute('1', {
      sleeve_id: 'healthcare',
      report_date: '2026-08-18',
      user_slug: 'nobody-aideal-test',
    });
    const noLotsText = noLots.content.map((c) => ('text' in c ? c.text : '')).join('');
    expect(noLotsText.length).toBeGreaterThan(0);
  });
});
