import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chart } = vi.hoisted(() => ({ chart: vi.fn() }));
vi.mock('../src/market/yf-client.js', () => ({ yf: { chart } }));
import { fetchHistoricalCloses as fetchHistory } from '../src/market/fetch-history.js';
import { cachedDashboardCalculation, readDashboardCache, writeDashboardCache } from '../src/webapp/dashboard-cache.js';
const fetchHistoricalCloses = (ticker: string, dates: string[], options: { refresh?: boolean } = {}) =>
  fetchHistory(ticker, dates, { cache: true, ...options });

let root: string;
const originalRoot = process.env.UTARUS_DATA_ROOT;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashboard-calculation-cache-'));
  process.env.UTARUS_DATA_ROOT = root;
  chart.mockResolvedValue({ quotes: [{ date: new Date('2026-09-14'), adjclose: 100 }] });
});
afterEach(() => {
  vi.restoreAllMocks(); chart.mockReset();
  process.env.UTARUS_DATA_ROOT = originalRoot;
  rmSync(root, { recursive: true, force: true });
});

it('persists independent copies of calculated results, with source and account isolation', () => {
  const compute = vi.fn(() => ({ amount: 348, gaps: ['missing opening'] }));
  const first = cachedDashboardCalculation('trade-results', 'victor', { trades: 1 }, compute);
  first.amount = 999;
  expect(cachedDashboardCalculation('trade-results', 'victor', { trades: 1 }, compute).amount).toBe(348);
  expect(compute).toHaveBeenCalledTimes(1);
  cachedDashboardCalculation('trade-results', 'victor', { trades: 2 }, compute);
  cachedDashboardCalculation('trade-results', 'another-user', { trades: 2 }, compute);
  expect(compute).toHaveBeenCalledTimes(3);
  const directory = join(root, 'cache/dashboard/trade-results');
  for (const file of readdirSync(directory)) expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
});

it('treats corrupted, expired, or incompatible cache entries as misses', () => {
  writeDashboardCache('snapshots', 'victor', 'revision-one', { value: 123 });
  expect(readDashboardCache('snapshots', 'victor', 'revision-two', 1000)).toBeNull();
  const file = join(root, 'cache/dashboard/snapshots', readdirSync(join(root, 'cache/dashboard/snapshots'))[0]);
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...entry, epoch: 'old-code' }));
  expect(readDashboardCache('snapshots', 'victor', 'revision-one', 1000)).toBeNull();
  writeFileSync(file, '{truncated');
  expect(readDashboardCache('snapshots', 'victor', 'revision-one', 1000)).toBeNull();
  writeFileSync(file, JSON.stringify({ ...entry, at: Date.now() - 2000 }));
  expect(readDashboardCache('snapshots', 'victor', 'revision-one', 1000)).toBeNull();
});

it('still calculates fresh results when cache storage is unavailable', () => {
  writeFileSync(join(root, 'cache'), 'not a directory');
  expect(cachedDashboardCalculation('trade-results', 'victor', [1], () => ({ value: 348 }))).toEqual({ value: 348 });
});

it('reuses historical adjusted closes, preserves holiday mapping, and revalidates on explicit refresh', async () => {
  expect(await fetchHistoricalCloses('AMD', ['2026-09-15', '2026-09-14'])).toEqual({ '2026-09-14': 100, '2026-09-15': 100 });
  expect(await fetchHistoricalCloses('AMD', ['2026-09-14', '2026-09-15'])).toEqual({ '2026-09-14': 100, '2026-09-15': 100 });
  expect(chart).toHaveBeenCalledTimes(1);
  chart.mockResolvedValue({ quotes: [{ date: new Date('2026-09-14'), adjclose: 50 }] });
  expect((await fetchHistoricalCloses('AMD', ['2026-09-14', '2026-09-15'], { refresh: true }))['2026-09-14']).toBe(50);
  expect(chart).toHaveBeenCalledTimes(2);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 7 * 60 * 60 * 1000);
  await fetchHistoricalCloses('AMD', ['2026-09-14', '2026-09-15']);
  expect(chart).toHaveBeenCalledTimes(3);
});

it('shares historical requests, does not cache failures, and does not fall back to stale prices', async () => {
  let release!: (value: unknown) => void;
  chart.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const first = fetchHistoricalCloses('AMD', ['2026-09-14']);
  const second = fetchHistoricalCloses('AMD', ['2026-09-14']);
  expect(chart).toHaveBeenCalledTimes(1);
  release({ quotes: [{ date: new Date('2026-09-14'), adjclose: 100 }] });
  expect(await first).toEqual(await second);
  chart.mockRejectedValueOnce(new Error('unavailable'));
  await expect(fetchHistoricalCloses('AMD', ['2026-09-14'], { refresh: true })).rejects.toThrow('unavailable');
  chart.mockRejectedValueOnce(new Error('retry failed'));
  await expect(fetchHistoricalCloses('OTHER', ['2026-09-14'])).rejects.toThrow('retry failed');
  await expect(fetchHistoricalCloses('OTHER', ['2026-09-14'])).resolves.toEqual({ '2026-09-14': 100 });
});
