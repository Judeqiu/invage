import { expect, it, vi } from 'vitest';
import { blankState } from 'utarus';
import { DEMO_EMAIL, DEMO_NAME, seedSyntheticPortfolio, syntheticDashboard, isSyntheticDemo } from '../src/demo/showcase.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import { loadDashboardForSlug } from '../src/webapp/dashboard-data.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

it('builds a labelled, isolated showcase with matching executions, fixed prices and no live lookups', async () => {
  const state = blankState({ displayName: DEMO_NAME, contactEmail: DEMO_EMAIL, language: 'en' }) as InvestorState;
  seedSyntheticPortfolio(state);
  const before = structuredClone(state);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Demo must not fetch live sources'));
  try {
    const dashboard = await loadDashboardForSlug(state.user.id, undefined, undefined, undefined, { snapshot: { state, revision: 1 } });
    expect(dashboard).toEqual(syntheticDashboard(state));
    expect(dashboard.displayName).toContain('Synthetic Data');
    expect(dashboard.warnings?.[0]?.code).toBe('synthetic_demo');
    expect(dashboard.model?.live.positions).toHaveLength(5);
    expect(dashboard.model?.live.cashAmount).toBe(40000);
    expect(Object.keys(dashboard.optionTradeDetails ?? {})).toHaveLength(4);
    expect(dashboard.optionAnalytics?.profits).toHaveLength(22);
    expect(dashboard.optionAnalytics?.profits.every(row => row.net === 148)).toBe(true);
    expect(dashboard.optionAnalytics?.gaps).toEqual([]);
    const pages: any = buildPageProjections(dashboard);
    expect(new Map(pages.dashboard.live.merged.monthly.byMonth).get('2025-01')).toBe(150);
    expect(new Map(pages.dashboard.live.merged.monthly.byMonth).get('2026-10')).toBe(1350);
    expect(state.broker_connections).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(state).toEqual(before);
    expect(() => seedSyntheticPortfolio(state)).toThrow('empty');
  } finally { fetch.mockRestore(); }
});
it('does not seed or activate for a real customer account', () => {
  const state = blankState({ displayName: 'Customer', contactEmail: 'customer@example.com', language: 'en' }) as InvestorState;
  expect(isSyntheticDemo(state)).toBe(false);
  expect(() => seedSyntheticPortfolio(state)).toThrow('designated demo');
  expect(() => syntheticDashboard(state)).toThrow('Not the synthetic');
  expect(state.portfolio).toBeUndefined();
});
