import { COMPANIES, THRESHOLDS } from './config.js';
import type { PlaybookThresholds } from '../playbook/thresholds.js';
import type { Holding, PositionAnalysis, AnalystTarget, AnalysisResult } from './types.js';
import { isOptionHolding, valuePosition } from './position-value.js';

/** Default thresholds when no playbook is supplied (matches global THRESHOLDS). */
export function defaultAnalysisThresholds(): Pick<
  PlaybookThresholds,
  | 'buyMinUpsidePct'
  | 'strongBuyUpsidePct'
  | 'deepLossSellPct'
  | 'holdLossMonitorPct'
  | 'takeProfitPremiumPct'
  | 'trailStopPremiumPct'
> {
  return {
    buyMinUpsidePct: THRESHOLDS.buyMinUpsidePct,
    strongBuyUpsidePct: THRESHOLDS.strongBuyUpsidePct,
    deepLossSellPct: -30,
    holdLossMonitorPct: -15,
    takeProfitPremiumPct: 20,
    trailStopPremiumPct: 10,
  };
}

export function buildAnalysis(
  holdings: Record<string, Holding>,
  prices: Record<string, number>,
  targets: Record<string, AnalystTarget>,
): PositionAnalysis[] {
  const analysis: PositionAnalysis[] = [];

  for (const [ticker, h] of Object.entries(holdings)) {
    if (isOptionHolding(h)) {
      const e = valuePosition(ticker, h);
      analysis.push({
        ticker,
        company: e.label,
        category: e.category,
        price: e.price,
        avgCost: e.avgCost,
        units: e.units,
        cost: e.cost,
        value: e.value,
        pl: e.pl,
        plPct: e.plPct,
        targetLow: null,
        targetMedian: null,
        targetMean: null,
        targetHigh: null,
        upsideToMedian: null,
        upsideToMean: null,
        costVsHigh: null,
        currentVsCost: e.avgCost > 0 ? ((e.price - e.avgCost) / e.avgCost) * 100 : null,
        instrument: 'option',
        option: e.option,
        contingentCashObligation: e.contingentCashObligation,
        contingentShareObligation: e.contingentShareObligation,
        premiumAbsolute: e.premiumAbsolute,
      });
      continue;
    }

    const price = prices[ticker];
    if (price == null || !Number.isFinite(price)) {
      throw new Error(`Missing market price for ${ticker}. Cannot analyze equity position.`);
    }
    const e = valuePosition(ticker, h, price);
    const avg = h.avg_price;

    const t = targets[ticker] ?? {
      ticker,
      targetLowPrice: null,
      targetMedianPrice: null,
      targetMeanPrice: null,
      targetHighPrice: null,
    };
    const low = t.targetLowPrice ?? null;
    const median = t.targetMedianPrice ?? null;
    const mean = t.targetMeanPrice ?? null;
    const high = t.targetHighPrice ?? null;

    const upsideToMedian = median && price > 0 ? ((median - price) / price) * 100 : null;
    const upsideToMean = mean && price > 0 ? ((mean - price) / price) * 100 : null;
    const costVsHigh = high && avg > 0 ? ((avg - high) / avg) * 100 : null;
    const currentVsCost = avg > 0 ? ((price - avg) / avg) * 100 : null;

    analysis.push({
      ticker,
      company: COMPANIES[ticker] ?? ticker,
      category: e.category,
      price,
      avgCost: avg,
      units: h.units,
      cost: e.cost,
      value: e.value,
      pl: e.pl,
      plPct: e.plPct,
      targetLow: low,
      targetMedian: median,
      targetMean: mean,
      targetHigh: high,
      upsideToMedian,
      upsideToMean,
      costVsHigh,
      currentVsCost,
      instrument: 'equity',
    });
  }

  return analysis.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    return catCmp !== 0 ? catCmp : a.ticker.localeCompare(b.ticker);
  });
}

function classifyLaggard(
  lossPct: number,
  t: ReturnType<typeof defaultAnalysisThresholds>,
): string {
  if (lossPct <= t.deepLossSellPct) return `SELL — Deep loss (≤${t.deepLossSellPct}%), weak recovery path`;
  if (lossPct <= t.holdLossMonitorPct) return `HOLD — Monitor for catalyst (loss ≤${t.holdLossMonitorPct}%)`;
  return 'REDUCE COST — Average down if fundamentals strong';
}

function classifyOverpriced(
  price: number,
  targetMedian: number,
  t: ReturnType<typeof defaultAnalysisThresholds>,
): string {
  const premium = ((price - targetMedian) / targetMedian) * 100;
  if (premium >= t.takeProfitPremiumPct) {
    return `TAKE PROFIT — ≥${t.takeProfitPremiumPct}% over median target`;
  }
  if (premium >= t.trailStopPremiumPct) {
    return `TRAIL STOP — ≥${t.trailStopPremiumPct}% over median; protect gains`;
  }
  return 'HOLD — Slight premium, momentum may continue';
}

function classifyOpportunity(
  upsidePct: number,
  t: ReturnType<typeof defaultAnalysisThresholds>,
): string {
  if (upsidePct >= t.strongBuyUpsidePct) {
    return `STRONG BUY — High conviction, ≥${t.strongBuyUpsidePct}% upside`;
  }
  if (upsidePct >= t.buyMinUpsidePct + 5) {
    return `BUY — Moderate conviction, ~${(t.buyMinUpsidePct + 5).toFixed(0)}–${t.strongBuyUpsidePct}% upside`;
  }
  return `WATCH — Interesting, ≥${t.buyMinUpsidePct}% upside`;
}

function isEquityRow(s: PositionAnalysis): boolean {
  return s.instrument !== 'option';
}

export function analyzeLaggards(
  analysis: PositionAnalysis[],
  thresholds: ReturnType<typeof defaultAnalysisThresholds> = defaultAnalysisThresholds(),
): PositionAnalysis[] {
  return analysis
    .filter((s) => isEquityRow(s) && s.targetHigh != null && s.avgCost > s.targetHigh!)
    .map((s) => ({
      ...s,
      recommendation: classifyLaggard((s.price - s.avgCost) / s.avgCost * 100, thresholds),
    }))
    .sort((a, b) => (b.costVsHigh ?? 0) - (a.costVsHigh ?? 0));
}

export function analyzeOverpriced(
  analysis: PositionAnalysis[],
  thresholds: ReturnType<typeof defaultAnalysisThresholds> = defaultAnalysisThresholds(),
): PositionAnalysis[] {
  return analysis
    .filter((s) => isEquityRow(s) && s.targetMedian != null && s.price > s.targetMedian!)
    .map((s) => ({
      ...s,
      recommendation: classifyOverpriced(s.price, s.targetMedian!, thresholds),
    }))
    .sort((a, b) => b.plPct - a.plPct);
}

export function analyzeBuyOpportunities(
  analysis: PositionAnalysis[],
  thresholds: ReturnType<typeof defaultAnalysisThresholds> = defaultAnalysisThresholds(),
): PositionAnalysis[] {
  return analysis
    .filter((s) => {
      if (!isEquityRow(s)) return false;
      if (s.targetMedian == null || s.price >= s.targetMedian) return false;
      const upside = s.upsideToMedian ?? 0;
      return upside >= thresholds.buyMinUpsidePct;
    })
    .map((s) => ({
      ...s,
      recommendation: classifyOpportunity(s.upsideToMedian ?? 0, thresholds),
    }))
    .sort((a, b) => (b.upsideToMedian ?? 0) - (a.upsideToMedian ?? 0));
}

export function runFullAnalysis(
  holdings: Record<string, Holding>,
  prices: Record<string, number>,
  targets: Record<string, AnalystTarget>,
  thresholds: ReturnType<typeof defaultAnalysisThresholds> = defaultAnalysisThresholds(),
): AnalysisResult {
  const fullAnalysis = buildAnalysis(holdings, prices, targets);
  return {
    laggards: analyzeLaggards(fullAnalysis, thresholds),
    overpriced: analyzeOverpriced(fullAnalysis, thresholds),
    buyOpportunities: analyzeBuyOpportunities(fullAnalysis, thresholds),
    fullAnalysis,
  };
}
