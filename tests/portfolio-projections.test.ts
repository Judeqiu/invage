import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, statSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPortfolioProjectionRefresher } from '../src/state/portfolio-projections.js';
import { portfolioFingerprint, readPortfolioProjection } from '../src/state/projection-store.js';
import { registerPortfolioRefresher, refreshPortfolioAfterSync } from '../src/state/projection-events.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';
let root: string, state: InvestorState;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'portfolio-projections-'));
  process.env.UTARUS_DATA_ROOT = root;
  state = { user: { id: '00000000-0000-4000-8000-000000000021', slug: '00000000-0000-4000-8000-000000000021', created_at: '2026-01-01' },
    profile: { display_name: 'Owner', contact_email: 'test@example.com' }, log: [],
    portfolio: { AAPL: { units: 10, avg_price: 100, currency: 'USD', channel: 'main' } },
    cash: { amount: 500, currency: 'USD', updated_at: '2026-10-23', channel: 'main' } };
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function fixture(now = () => '2026-10-23T06:00:00Z') {
  const calculate = vi.fn(async (_slug, _prices, _benchmark, _progress, options): Promise<DashboardPayload> => {
    const source = options.snapshot.state;
    const live = buildLivePositions(source.portfolio ?? {}, { AAPL: 120 }, {}, source.cash, null, undefined,
      { reportingCurrency: 'USD', fxRates: {} }, { allowEmpty: true });
    return { slug: source.user.id, displayName: 'Owner', generatedAt: now(),
      empty: false, model: buildDashboardModel(live, []), benchmark: null, productProfile: 'full', productName: 'Test' };
  });
  const refresh = createPortfolioProjectionRefresher({
    loadInvestor: async () => ({ state: structuredClone(state), revision: 1 }), loadDashboardForSlug: calculate,
  });
  return { calculate, refresh };
}
it('persists NAV, account scopes and Positions/Insights together as a private atomic generation', async () => {
  const { refresh } = fixture();
  await refresh('00000000-0000-4000-8000-000000000021');
  const saved = readPortfolioProjection(state)!;
  expect(saved.dashboard.model?.live).toMatchObject({ totalValue: 1700, totalCost: 1000, totalPL: 200, cashAmount: 500 });
  expect((saved.dashboard.aggregatedViews?.live.main as any).view.totalValue).toBe(1700);
  expect((saved.dashboard.pageProjections?.positions.all as any).totals).toMatchObject({ cost: 1000, value: 1200, pnl: 200 });
  expect((saved.dashboard.pageProjections?.insights.all as any).nav).toBe(1700);
  expect(saved.openTrades.rows).toEqual([]);
  const directory = join(root, 'derived/portfolio');
  expect(readdirSync(directory)).toHaveLength(1);
  expect(statSync(join(directory, readdirSync(directory)[0])).mode & 0o777).toBe(0o600);
  expect(readPortfolioProjection({ ...state, user: { ...state.user, id: 'other' } })).toBeNull();
});
it('deduplicates overlapping refreshes and ignores scheduling metadata and notes', async () => {
  const { refresh, calculate } = fixture();
  await Promise.all([refresh('00000000-0000-4000-8000-000000000021'), refresh('00000000-0000-4000-8000-000000000021'), refresh('00000000-0000-4000-8000-000000000021')]);
  expect(calculate).toHaveBeenCalledOnce();
  const fingerprint = portfolioFingerprint(state);
  state.daily_broker_sync = { date: '2026-10-23', synced_accounts: {} };
  state.log.push({ ts: '2026-10-23', action: 'test' });
  state.option_journal = { note: { thesis: 'test', updated_at: '2026-10-23' } };
  expect(portfolioFingerprint(state)).toBe(fingerprint);
  await refresh('00000000-0000-4000-8000-000000000021');
  expect(calculate).toHaveBeenCalledOnce();
  state.portfolio!.AAPL.units = 20;
  expect(readPortfolioProjection(state)).toBeNull();
  await refresh('00000000-0000-4000-8000-000000000021');
  expect(calculate).toHaveBeenCalledTimes(2);
  expect(readPortfolioProjection(state)!.dashboard.model!.live.totalValue).toBe(2900);
});
it('discards a generation if financial data changes while it is calculated', async () => {
  const { refresh, calculate } = fixture();
  const original = calculate.getMockImplementation()!;
  calculate.mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    state.portfolio!.AAPL.units = 20;
    return result;
  });
  await refresh('00000000-0000-4000-8000-000000000021');
  expect(calculate).toHaveBeenCalledTimes(2);
  expect(readPortfolioProjection(state)!.dashboard.model!.live.totalValue).toBe(2900);
});
it('keeps the previous generation on failed refresh and safely rejects corrupt disk data', async () => {
  const { refresh, calculate } = fixture();
  await refresh('00000000-0000-4000-8000-000000000021');
  calculate.mockRejectedValueOnce(new Error('quote service unavailable'));
  await expect(refresh('00000000-0000-4000-8000-000000000021', true)).rejects.toThrow('quote service unavailable');
  expect(readPortfolioProjection(state)!.dashboard.model!.live.totalValue).toBe(1700);
  state.portfolio!.AAPL.units = 20;
  expect(readPortfolioProjection(state)).toBeNull();
  await refresh('00000000-0000-4000-8000-000000000021');
  const dir = join(root, 'derived/portfolio');
  writeFileSync(join(dir, readdirSync(dir)[0]), '{broken');
  expect(readPortfolioProjection(state)).toBeNull();
});
it('awaits calculation on sync completion and exposes calculation failure separately from broker import', async () => {
  const f = fixture();
  const unregister = registerPortfolioRefresher(f.refresh);
  try {
    expect(await refreshPortfolioAfterSync('00000000-0000-4000-8000-000000000021')).toEqual({ status: 'ready' });
    expect(readPortfolioProjection(state)).not.toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    f.calculate.mockRejectedValueOnce(new Error('calculation failed'));
    expect(await refreshPortfolioAfterSync('00000000-0000-4000-8000-000000000021', true)).toEqual({ status: 'failed' });
  } finally { unregister(); }
});

it('invalidates a replaced same-date snapshot even when the snapshot index is unchanged', async () => {
  const directory = join(root, 'drive', state.user.id);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'snapshot-2026-10-23.json');
  writeFileSync(join(directory, 'snapshots.json'), JSON.stringify(['snapshot-2026-10-23.json']));
  writeFileSync(file, JSON.stringify({ date: '2026-10-23', totalValue: 1700, totalCost: 1000, totalPL: 200, positions: [] }));
  const f = fixture();
  await f.refresh(state.user.id);
  expect(readPortfolioProjection(state)).not.toBeNull();
  const modified = new Date(Date.now() + 2000);
  utimesSync(file, modified, modified);
  expect(readPortfolioProjection(state)).toBeNull();
  await f.refresh(state.user.id);
  expect(f.calculate).toHaveBeenCalledTimes(2);
});

it('retains daily baselines across changed source fingerprints and worker restarts', async () => {
  let date = '2026-10-22T06:00:00Z';
  const first = fixture(() => date);
  await first.refresh(state.user.id);
  (state.cash as import('../src/state/portfolio-state.js').CashBalance).amount += 100;
  date = '2026-10-23T06:00:00Z';
  const restarted = fixture(() => date);
  await restarted.refresh(state.user.id);
  const scope = (readPortfolioProjection(state)!.dashboard.aggregatedViews!.live.merged as any);
  expect(scope.dailyChanges.metrics.totalValue).toMatchObject({ delta: 100 });
  (state.cash as import('../src/state/portfolio-state.js').CashBalance).amount += 50;
  await restarted.refresh(state.user.id);
  expect((readPortfolioProjection(state)!.dashboard.aggregatedViews!.live.merged as any).dailyChanges.metrics.totalValue.delta).toBe(150);
});
