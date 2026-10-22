import { buildPageProjections } from '../../src/report/page-projections.js';
import { createPortfolioProjectionRefresher } from '../../src/state/portfolio-projections.js';
import type { InvestorState } from '../../src/state/portfolio-state.js';
import type { DashboardPayload } from '../../src/webapp/dashboard-data.js';

/** Test servers prepare the same persisted views as a completed production sync. */
export function withPageProjections<T>(value: T): T {
  if (!value || typeof value !== 'object' || !('model' in value)) return value;
  const payload = value as unknown as DashboardPayload;
  payload.generatedAt ??= '2026-10-23T06:00:00Z';
  const pages = buildPageProjections(payload);
  return Object.assign(value, { pageProjections: { positions: pages.positions, insights: pages.insights }, aggregatedViews: pages.dashboard });
}
export async function persistPortfolioFixture(state: InvestorState, dashboard?: DashboardPayload) {
  const refresh = createPortfolioProjectionRefresher({
    loadInvestor: async () => ({ state: structuredClone(state), revision: 1 }),
    loadDashboardForSlug: async () => dashboard ?? ({ slug: state.user.id, displayName: state.profile.display_name,
      generatedAt: '2026-10-23T06:00:00Z', empty: true, model: null, benchmark: null,
      productProfile: 'full', productName: 'Test' }),
  });
  await refresh(state.user.id, true);
}
