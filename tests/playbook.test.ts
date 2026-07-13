import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYBOOK,
  applyPlaybookPatch,
  formatPlaybookSummary,
  playbookAgentGuidance,
  resolvePlaybook,
  thresholdsForPlaybook,
} from '../src/playbook/index.js';
import { runFullAnalysis } from '../src/market/analyzer.js';
import type { Holding, AnalystTarget } from '../src/market/types.js';

describe('resolvePlaybook', () => {
  it('returns default when raw is null', () => {
    const pb = resolvePlaybook(null);
    expect(pb.strategy).toBe(DEFAULT_PLAYBOOK.strategy);
    expect(pb.philosophy).toBe(DEFAULT_PLAYBOOK.philosophy);
    expect(pb.risk.profile).toBe('balanced');
    expect(pb.allocation.max_position_pct).toBe(10);
  });

  it('merges partial stored playbook with defaults', () => {
    const pb = resolvePlaybook({
      risk: { profile: 'conservative' },
      philosophy: 'dividend_investing',
    });
    expect(pb.risk.profile).toBe('conservative');
    expect(pb.philosophy).toBe('dividend_investing');
    expect(pb.strategy).toBe(DEFAULT_PLAYBOOK.strategy);
    expect(pb.rebalancing.mode).toBe('quarterly');
  });

  it('fails fast on invalid strategy', () => {
    expect(() => resolvePlaybook({ strategy: 'momentum' })).toThrow(/strategy/);
  });

  it('fails fast on invalid percent range', () => {
    expect(() =>
      resolvePlaybook({ allocation: { max_position_pct: 150 } }),
    ).toThrow(/max_position_pct/);
  });
});

describe('applyPlaybookPatch', () => {
  it('updates risk and keeps allocation caps in sync', () => {
    const base = resolvePlaybook(null);
    const next = applyPlaybookPatch(base, {
      risk: { profile: 'aggressive', position_limit_pct: 15 },
    });
    expect(next.risk.profile).toBe('aggressive');
    expect(next.risk.position_limit_pct).toBe(15);
    expect(next.allocation.max_position_pct).toBe(15);
  });

  it('sets watchlist themes', () => {
    const next = applyPlaybookPatch(resolvePlaybook(null), {
      watchlists: { themes: ['AI', 'energy transition'] },
    });
    expect(next.watchlists.themes).toEqual(['AI', 'energy transition']);
    expect(next.watchlists.markets).toEqual(['US']);
  });
});

describe('thresholdsForPlaybook', () => {
  it('raises buy bar for conservative risk', () => {
    const cons = thresholdsForPlaybook(
      applyPlaybookPatch(resolvePlaybook(null), { risk: { profile: 'conservative' } }),
    );
    const bal = thresholdsForPlaybook(resolvePlaybook(null));
    expect(cons.buyMinUpsidePct).toBeGreaterThan(bal.buyMinUpsidePct);
    expect(cons.takeProfitPremiumPct).toBeLessThan(bal.takeProfitPremiumPct);
  });

  it('lowers buy bar for aggressive risk', () => {
    const agg = thresholdsForPlaybook(
      applyPlaybookPatch(resolvePlaybook(null), { risk: { profile: 'aggressive' } }),
    );
    const bal = thresholdsForPlaybook(resolvePlaybook(null));
    expect(agg.buyMinUpsidePct).toBeLessThan(bal.buyMinUpsidePct);
  });

  it('tilts value bias for value philosophy', () => {
    const value = thresholdsForPlaybook(
      applyPlaybookPatch(resolvePlaybook(null), { philosophy: 'value_investing' }),
    );
    const growth = thresholdsForPlaybook(
      applyPlaybookPatch(resolvePlaybook(null), { philosophy: 'growth_investing' }),
    );
    expect(value.valueBias).toBeGreaterThan(growth.valueBias);
    expect(growth.peAttractive).toBeGreaterThan(value.peAttractive);
  });
});

describe('playbookAgentGuidance', () => {
  it('includes strategy, risk caps, and buy criteria', () => {
    const text = playbookAgentGuidance(resolvePlaybook(null));
    expect(text).toMatch(/Investment Playbook/);
    expect(text).toMatch(/value_investing|value/);
    expect(text).toMatch(/Position limit/);
    expect(text).toMatch(/Buy rules/);
  });
});

describe('formatPlaybookSummary', () => {
  it('prints a scannable summary', () => {
    const s = formatPlaybookSummary(resolvePlaybook(null));
    expect(s).toMatch(/Investment Playbook/);
    expect(s).toMatch(/Strategy:/);
    expect(s).toMatch(/Risk:/);
  });
});

describe('runFullAnalysis with playbook thresholds', () => {
  const holdings: Record<string, Holding> = {
    AAPL: { avg_price: 200, units: 10, category: 'SL Technology S1' },
  };
  const prices = { AAPL: 180 };
  const targets: Record<string, AnalystTarget> = {
    AAPL: {
      ticker: 'AAPL',
      targetLowPrice: 150,
      targetMedianPrice: 200, // ~11% upside — under default 15%, over aggressive bar
      targetMeanPrice: 200,
      targetHighPrice: 250,
    },
  };

  it('excludes marginal upside under default thresholds', () => {
    const result = runFullAnalysis(holdings, prices, targets);
    expect(result.buyOpportunities.map((p) => p.ticker)).not.toContain('AAPL');
  });

  it('includes marginal upside under aggressive thresholds', () => {
    const th = thresholdsForPlaybook(
      applyPlaybookPatch(resolvePlaybook(null), {
        risk: { profile: 'aggressive' },
        buy_sell: { ai_recommendation_style: 'aggressive' },
      }),
    );
    // 11% upside; aggressive buyMin is ~10
    expect(th.buyMinUpsidePct).toBeLessThanOrEqual(11);
    const result = runFullAnalysis(holdings, prices, targets, th);
    expect(result.buyOpportunities.map((p) => p.ticker)).toContain('AAPL');
  });
});
