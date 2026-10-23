import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ daily: vi.fn() }));
vi.mock('../src/brokers/daily-sync.js', () => ({ runDailyBrokerSyncs: mocks.daily }));
import { startBrokerSyncScheduler } from '../src/brokers/scheduler.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('runs recovery and the shared daily batch, serializes ticks, and stops cleanly', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  mocks.daily.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
  const scheduler = startBrokerSyncScheduler();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.daily).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.daily).toHaveBeenCalledOnce();
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
  } finally { release(); await scheduler.stop(); }
});
it('keeps the shared daily scanner available after a failed tick', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.daily.mockRejectedValueOnce(new Error('Temporary scan failure')).mockResolvedValue(undefined);
  const scheduler = startBrokerSyncScheduler();
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.daily).toHaveBeenCalledTimes(2);
  } finally { await scheduler.stop(); log.mockRestore(); }
});
