import { registerPortfolioRefresher } from '../src/state/projection-events.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';
import type { InvestorState } from '../src/state/portfolio-state.js';
vi.mock('../src/market/index.js', () => ({
  resolvePortfolioMarket: vi.fn(async portfolio => ({ portfolio, equityPrices: {}, optionMarks: {} })),
}));
import { capturePortfolioSnapshot } from '../src/state/capture-snapshot.js';

const state: InvestorState = {
  user: { id: 'snapshot-user', slug: 'snapshot-user', created_at: '2026-01-01' },
  profile: { display_name: 'Snapshot', contact_email: 's@example.com' }, log: [],
  cash: { amount: 100, currency: 'USD', updated_at: '2026-10-23' },
};
afterEach(() => vi.useRealTimers());

describe('shared portfolio snapshot capture', () => {
  it('persists the batch date and index even when valuation finishes on a later day', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T17:00:00Z'));
    const result = await capturePortfolioSnapshot(state, '2026-10-23');
    const dir = join(resolveDataRoot(), 'drive', state.user.id);
    expect(result.fileName).toBe('snapshot-2026-10-23.json');
    expect(JSON.parse(readFileSync(join(dir, result.fileName), 'utf8'))).toMatchObject({
      date: '2026-10-23', totalValue: 100, cashAmount: 100, positions: [],
    });
    await capturePortfolioSnapshot(state, '2026-10-23');
    expect(JSON.parse(readFileSync(join(dir, 'snapshots.json'), 'utf8'))).toEqual([result.fileName]);
  });

  it('keeps only the latest snapshot per sync date and preserves other days', async () => {
    const user = { ...state, user: { ...state.user, id: 'latest-daily-snapshot-user' } };
    const capture = (date: string, amount: number) => capturePortfolioSnapshot({ ...user,
      cash: { amount, currency: 'USD', updated_at: date } }, date, { allowEmpty: true });
    await capture('2026-10-22', 80);
    await capture('2026-10-23', 100);
    await capture('2026-10-23', 175);
    await capture('2026-10-24', 200);
    const dir = join(resolveDataRoot(), 'drive', user.user.id);
    const files = JSON.parse(readFileSync(join(dir, 'snapshots.json'), 'utf8')) as string[];
    expect(files).toEqual(['snapshot-2026-10-22.json', 'snapshot-2026-10-23.json', 'snapshot-2026-10-24.json']);
    const snapshots = files.map(file => JSON.parse(readFileSync(join(dir, file), 'utf8')));
    expect(snapshots.map(snapshot => snapshot.totalValue)).toEqual([80, 175, 200]);
    expect(snapshots[1]).toMatchObject({ date: '2026-10-23', cashAmount: 175 });
  });

  it('can record an empty synced account while keeping the manual empty-portfolio guard', async () => {
    const empty = { ...state, cash: undefined };
    await expect(capturePortfolioSnapshot(empty, '2026-10-22')).rejects.toThrow('No portfolio');
    const result = await capturePortfolioSnapshot(empty, '2026-10-22', { allowEmpty: true });
    expect(result.snapshot.totalValue).toBe(0);
    expect(result.snapshot.positions).toEqual([]);
  });
});

it('refreshes persisted aggregates after the dated snapshot is on disk', async () => {
  const refresh = vi.fn(async (userId: string, force?: boolean) => {
    expect(force).toBe(true);
    expect(JSON.parse(readFileSync(join(resolveDataRoot(), 'drive', userId, 'snapshot-2026-10-21.json'), 'utf8')).date).toBe('2026-10-21');
  });
  const unregister = registerPortfolioRefresher(refresh);
  try {
    await capturePortfolioSnapshot(state, '2026-10-21');
    expect(refresh).toHaveBeenCalledOnce();
  } finally { unregister(); }
});
