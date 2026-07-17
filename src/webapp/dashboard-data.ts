/**
 * Load a live portfolio dashboard model for a user slug.
 * Used by the WebUI domain API (dynamic tab) — same math as the HTML report.
 */

import { loadState } from 'utarus';
import { fetchPrices } from '../market/index.js';
import { getPortfolio, type InvestorState } from '../state/portfolio-state.js';
import { loadSnapshots } from '../state/snapshot.js';
import {
  buildDashboardModel,
  buildLivePositions,
  type DashboardModel,
} from '../report/dashboard-model.js';

export interface DashboardPayload {
  slug: string;
  displayName: string;
  generatedAt: string;
  empty: boolean;
  message?: string;
  model: DashboardModel | null;
}

/**
 * Build dashboard JSON for a user.
 * Empty portfolio → empty:true (no invented holdings).
 * Missing price for a held ticker → throws (fail-fast).
 */
export async function loadDashboardForSlug(
  slug: string,
  priceOverride?: Record<string, number>,
): Promise<DashboardPayload> {
  const state = loadState(slug) as InvestorState;
  const portfolio = getPortfolio(state);
  const displayName = state.profile.display_name;
  const generatedAt = new Date().toISOString();
  const tickers = Object.keys(portfolio);

  if (tickers.length === 0) {
    return {
      slug,
      displayName,
      generatedAt,
      empty: true,
      message: 'No holdings yet. Add positions in chat, then refresh this dashboard.',
      model: null,
    };
  }

  const prices = priceOverride ?? (await fetchPrices(tickers));
  const live = buildLivePositions(portfolio, prices);
  const snapshots = loadSnapshots(slug);
  const model = buildDashboardModel(live, snapshots);

  return {
    slug,
    displayName,
    generatedAt,
    empty: false,
    model,
  };
}
