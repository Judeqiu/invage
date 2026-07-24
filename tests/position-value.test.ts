import { describe, it, expect } from 'vitest';
import {
  buildOptionKey,
  valuePosition,
  valuePortfolio,
  equityKeys,
  optionKeys,
} from '../src/market/position-value.js';
import type { Holding } from '../src/market/types.js';
import { buildLivePositions } from '../src/report/dashboard-model.js';
import { buildAnalysis, runFullAnalysis } from '../src/market/analyzer.js';

describe('buildOptionKey', () => {
  it('builds SPACEX short put key', () => {
    expect(
      buildOptionKey({
        underlying: 'spacex',
        right: 'put',
        strike: 90,
        expiry: '2026-08-07',
        side: 'short',
      }),
    ).toBe('SPACEX-P-90-20260807-S');
  });
});

describe('SpaceX short put economics (100 shares/contract)', () => {
  const holding: Holding = {
    instrument: 'option',
    avg_price: 265,
    units: 1,
    category: 'Private / Secondary',
    option: {
      right: 'put',
      side: 'short',
      strike: 90,
      expiry: '2026-08-07',
      multiplier: 100,
      underlying: 'SPACEX',
      settlement: 'physical',
      mark: 265,
    },
  };

  it('values entry mark: premium $26,500 credit, obligation $9,000, P/L ~0', () => {
    const e = valuePosition('SPACEX-P-90-20260807-S', holding);
    expect(e.premiumAbsolute).toBe(26500);
    expect(e.contingentCashObligation).toBe(9000);
    expect(e.contingentShareObligation).toBe(0);
    expect(e.cost).toBe(-26500);
    expect(e.value).toBe(-26500);
    expect(e.pl).toBe(0);
  });

  it('expires worthless (mark 0): full premium profit +$26,500', () => {
    const expired: Holding = {
      ...holding,
      option: { ...holding.option!, mark: 0 },
    };
    const e = valuePosition('SPACEX-P-90-20260807-S', expired);
    expect(e.value).toBe(0);
    expect(e.pl).toBe(26500);
    expect(e.contingentCashObligation).toBe(9000);
  });

  it('fails without mark', () => {
    const bad = {
      ...holding,
      option: { ...holding.option!, mark: undefined as unknown as number },
    };
    expect(() => valuePosition('X', bad)).toThrow(/mark/);
  });
});

describe('mixed portfolio valuation', () => {
  const portfolio: Record<string, Holding> = {
    AAPL: { avg_price: 100, units: 10, instrument: 'equity' },
    'SPACEX-P-90-20260807-S': {
      instrument: 'option',
      avg_price: 265,
      units: 1,
      option: {
        right: 'put',
        side: 'short',
        strike: 90,
        expiry: '2026-08-07',
        multiplier: 100,
        underlying: 'SPACEX',
        settlement: 'physical',
        mark: 0,
      },
    },
  };

  it('splits equity vs option keys', () => {
    expect(equityKeys(portfolio)).toEqual(['AAPL']);
    expect(optionKeys(portfolio)).toEqual(['SPACEX-P-90-20260807-S']);
  });

  it('values without Yahoo price for the option key', () => {
    const rows = valuePortfolio(portfolio, { AAPL: 110 });
    expect(rows).toHaveLength(2);
    const opt = rows.find((r) => r.instrument === 'option')!;
    expect(opt.pl).toBe(26500);
    expect(opt.contingentCashObligation).toBe(9000);
  });

  it('buildLivePositions surfaces obligation and premium', () => {
    const live = buildLivePositions(portfolio, { AAPL: 110 });
    expect(live.equityValue).toBe(1100);
    expect(live.equityCost).toBe(1000);
    expect(live.optionsPremiumCollected).toBe(26500);
    expect(live.contingentCashObligation).toBe(9000);
    expect(live.optionCount).toBe(1);
    expect(live.equityCount).toBe(1);
    // Equity 1100 + option MTM 0 = 1100; costs 1000 + (-26500) = -25500
    expect(live.totalValue).toBe(1100);
    expect(live.totalCost).toBe(-25500);
    expect(live.totalPL).toBe(1100 - -25500);
  });

  it('analyzer skips options for 3-axis buckets but includes them in fullAnalysis', () => {
    const result = runFullAnalysis(
      portfolio,
      { AAPL: 110 },
      {
        AAPL: {
          ticker: 'AAPL',
          targetLowPrice: 90,
          targetMedianPrice: 100,
          targetMeanPrice: 100,
          targetHighPrice: 120,
        },
      },
    );
    expect(result.fullAnalysis).toHaveLength(2);
    expect(result.fullAnalysis.some((p) => p.instrument === 'option')).toBe(true);
    expect(result.laggards.every((p) => p.instrument !== 'option')).toBe(true);
    expect(result.overpriced.every((p) => p.instrument !== 'option')).toBe(true);
    expect(result.buyOpportunities.every((p) => p.instrument !== 'option')).toBe(true);
  });

  it('buildAnalysis fails fast when equity price missing', () => {
    expect(() => buildAnalysis({ AAPL: { avg_price: 100, units: 1 } }, {}, {})).toThrow(
      /Missing market price for AAPL/,
    );
  });
});
