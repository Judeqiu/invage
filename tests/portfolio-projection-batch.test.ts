import { expect, it, vi } from 'vitest';
import type { InvestorSnapshot } from '../src/state/investor-store.js';
import { portfolioRefreshDeferred, portfolioStateSaved, refreshPortfolioAfterSync, registerPortfolioRefresher, withPortfolioRefreshBatch } from '../src/state/projection-events.js';

const snapshot = (id: string) => ({ state: { user: { id } } }) as InvestorSnapshot;

it('calculates once after multiple imports and allows another user to refresh independently', async () => {
  const refresh = vi.fn(async () => {});
  const unregister = registerPortfolioRefresher(refresh);
  const calculated = vi.fn();
  try {
    await withPortfolioRefreshBatch('owner', async () => {
      portfolioStateSaved(snapshot('owner'));
      expect(await refreshPortfolioAfterSync('owner')).toEqual({ status: 'pending' });
      portfolioStateSaved(snapshot('owner'));
      expect(portfolioRefreshDeferred('owner')).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
      expect(await refreshPortfolioAfterSync('other')).toEqual({ status: 'ready' });
    }, calculated);
    expect(refresh.mock.calls).toEqual([['other', false], ['owner', false]]);
    expect(calculated).toHaveBeenCalledWith({ status: 'ready' });
    expect(portfolioRefreshDeferred('owner')).toBe(false);
    await refreshPortfolioAfterSync('owner');
    expect(refresh).toHaveBeenCalledTimes(3);
  } finally { unregister(); }
});

it('awaits snapshot calculations without running them again at batch completion', async () => {
  const refresh = vi.fn(async () => {});
  const unregister = registerPortfolioRefresher(refresh);
  const calculated = vi.fn();
  try {
    await withPortfolioRefreshBatch('owner', async () => {
      portfolioStateSaved(snapshot('owner'));
      await refreshPortfolioAfterSync('owner');
      expect(await refreshPortfolioAfterSync('owner', true)).toEqual({ status: 'ready' });
    }, calculated);
    expect(refresh.mock.calls).toEqual([['owner', true]]);
    expect(calculated).not.toHaveBeenCalled();
  } finally { unregister(); }
});

it('still prepares partial imports when the batch fails', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const refresh = vi.fn(async () => { await gate; });
  const unregister = registerPortfolioRefresher(refresh);
  const calculated = vi.fn();
  try {
    const batch = withPortfolioRefreshBatch('owner', async () => {
      portfolioStateSaved(snapshot('owner'));
      throw new Error('Broker unavailable');
    }, calculated);
    const rejected = expect(batch).rejects.toThrow('Broker unavailable');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(calculated).not.toHaveBeenCalled();
    finish();
    await rejected;
    expect(calculated).toHaveBeenCalledWith({ status: 'ready' });
    expect(portfolioRefreshDeferred('owner')).toBe(false);
  } finally { finish(); unregister(); }
});
