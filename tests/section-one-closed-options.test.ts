import { expect, it } from 'vitest';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import type { Holding } from '../src/market/types.js';

const channel = 'moomoo-account';
function dashboard(includeClosed: boolean) {
  const holdings: Record<string, Holding> = {
    BE: { instrument: 'option', units: 1, avg_price: 575, currency: 'USD', channel,
      option: { underlying: 'BE', right: 'put', side: 'short', strike: 210,
        expiry: '2026-11-13', multiplier: 100, settlement: 'physical', mark: 1695 } },
  };
  if (includeClosed) for (const strike of [85, 82.5]) {
    holdings[`INTC-${strike}`] = { instrument: 'option', units: 0, avg_price: 0, currency: 'USD', channel,
      option: { underlying: 'INTC', right: 'put', side: 'short', strike,
        expiry: '2026-11-20', multiplier: 100, settlement: 'physical', mark: 1975 } };
  }
  const model = buildDashboardModel(buildLivePositions(holdings, { BE: 203.84, INTC: 65.55 }, {},
    [{ channel, currency: 'USD', amount: -4876.03 }], [], '2026-10-30',
    { reportingCurrency: 'USD', fxRates: {} }), []);
  const be = model.live.positions.find(p => p.option?.underlying === 'BE')!;
  be.providerIv = { iv: .79, source: 'yahoo', fetchedAt: '2026-10-30T17:09:13Z', asOf: null };
  return { model, generatedAt: '2026-10-30T17:09:13Z', brokerAsOf: { [channel]: '2026-10-30' },
    equityPrices: { BE: 203.84, INTC: 65.55 } };
}

it('excludes the two closed INTC contracts from Section 01 rows, counts and totals in both modes', () => {
  const active = buildPageProjections(dashboard(false) as any).dashboard.live as any;
  const payload = dashboard(true), before = structuredClone(payload);
  const actual = buildPageProjections(payload as any).dashboard.live as any;
  for (const scope of ['merged', channel]) for (const mode of ['wheel', 'matching']) {
    const risk = actual[scope].risk[mode], expected = active[scope].risk[mode];
    expect(risk).toEqual(expected);
    expect(risk.rows).toHaveLength(1);
    expect(risk.rows[0].p.option.underlying).toBe('BE');
    expect(risk.exposure).toBe(21000);
    expect(actual[scope].view.positions.filter((p: any) => p.units === 0)).toHaveLength(2);
  }
  expect(actual.merged.risk.wheel.weighted).toBeGreaterThan(0);
  expect(actual.merged.risk.wheel.cover).toBeCloseTo(-4876.03 / 21000 * 100);
  expect(payload).toEqual(before);
});

it('excludes closed puts and calls even when their probability evidence is missing', () => {
  const payload = dashboard(true);
  payload.model.live.positions = payload.model.live.positions.filter(p => p.units === 0);
  payload.model.live.positions[0].option!.right = 'call';
  const scopes = buildPageProjections(payload as any).dashboard.live as any;
  for (const scope of ['merged', channel]) for (const mode of ['wheel', 'matching']) {
    expect(scopes[scope].risk[mode]).toMatchObject({ rows: [], missing: 0, exposure: 0, weighted: 0, cover: null });
  }
});
