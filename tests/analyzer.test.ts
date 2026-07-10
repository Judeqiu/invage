import { describe, it, expect } from 'vitest';
import { runFullAnalysis } from '../src/market/analyzer.js';
import type { Holding, AnalystTarget } from '../src/market/types.js';

describe('runFullAnalysis', () => {
  const holdings: Record<string, Holding> = {
    AAPL: { avg_price: 200, units: 10, category: 'SL Technology S1' },
    EXPENSIVE: { avg_price: 50, units: 5, category: 'Test' },
    LAGGARD: { avg_price: 100, units: 2, category: 'Test' },
  };

  const prices: Record<string, number> = {
    AAPL: 180,
    EXPENSIVE: 120,
    LAGGARD: 40,
  };

  const targets: Record<string, AnalystTarget> = {
    AAPL: {
      ticker: 'AAPL',
      targetLowPrice: 150,
      targetMedianPrice: 220,
      targetMeanPrice: 215,
      targetHighPrice: 250,
    },
    EXPENSIVE: {
      ticker: 'EXPENSIVE',
      targetLowPrice: 80,
      targetMedianPrice: 100,
      targetMeanPrice: 100,
      targetHighPrice: 110,
    },
    LAGGARD: {
      ticker: 'LAGGARD',
      targetLowPrice: 30,
      targetMedianPrice: 50,
      targetMeanPrice: 50,
      targetHighPrice: 60,
    },
  };

  it('classifies buy opportunities when upside > 15%', () => {
    const result = runFullAnalysis(holdings, prices, targets);
    const buyTickers = result.buyOpportunities.map((p) => p.ticker);
    expect(buyTickers).toContain('AAPL');
  });

  it('classifies overpriced when price > median target', () => {
    const result = runFullAnalysis(holdings, prices, targets);
    const over = result.overpriced.map((p) => p.ticker);
    expect(over).toContain('EXPENSIVE');
  });

  it('classifies laggards when avg cost > high target', () => {
    const result = runFullAnalysis(holdings, prices, targets);
    const lag = result.laggards.map((p) => p.ticker);
    expect(lag).toContain('LAGGARD');
  });
});
