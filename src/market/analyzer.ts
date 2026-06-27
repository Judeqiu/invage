import { COMPANIES, THRESHOLDS } from './config.js';
import type { Holding, PositionAnalysis, AnalystTarget, AnalysisResult } from './types.js';

export function buildAnalysis(
  holdings: Record<string, Holding>,
  prices: Record<string, number>,
  targets: Record<string, AnalystTarget>,
): PositionAnalysis[] {
  const analysis: PositionAnalysis[] = [];

  for (const [ticker, h] of Object.entries(holdings)) {
    const price = prices[ticker] ?? 0;
    const avg = h.avg_price;
    const units = h.units;
    const cost = avg * units;
    const category = h.category ?? 'Unknown';
    const value = units * price;
    const pl = value - cost;
    const plPct = cost > 0 ? (pl / cost) * 100 : 0;

    const t = targets[ticker] ?? {};
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
      category,
      price,
      avgCost: avg,
      units,
      cost,
      value,
      pl,
      plPct,
      targetLow: low,
      targetMedian: median,
      targetMean: mean,
      targetHigh: high,
      upsideToMedian,
      upsideToMean,
      costVsHigh,
      currentVsCost,
    });
  }

  return analysis.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    return catCmp !== 0 ? catCmp : a.ticker.localeCompare(b.ticker);
  });
}

function classifyLaggard(lossPct: number): string {
  if (lossPct < -30) return 'SELL — Deep loss, no recovery path';
  if (lossPct < -15) return 'HOLD — Monitor for catalyst';
  return 'REDUCE COST — Average down if fundamentals strong';
}

function classifyOverpriced(price: number, targetMedian: number): string {
  const premium = ((price - targetMedian) / targetMedian) * 100;
  if (premium > 20) return 'TAKE PROFIT — Significant overvaluation';
  if (premium > 10) return 'TRAIL STOP — Protect gains';
  return 'HOLD — Slight premium, momentum may continue';
}

function classifyOpportunity(upsidePct: number): string {
  if (upsidePct > 30) return 'STRONG BUY — High conviction, >30% upside';
  if (upsidePct > 20) return 'BUY — Moderate conviction, 20-30% upside';
  return 'WATCH — Interesting, 15-20% upside';
}

export function analyzeLaggards(analysis: PositionAnalysis[]): PositionAnalysis[] {
  return analysis
    .filter((s) => s.targetHigh != null && s.avgCost > s.targetHigh!)
    .map((s) => ({
      ...s,
      recommendation: classifyLaggard((s.price - s.avgCost) / s.avgCost * 100),
    }))
    .sort((a, b) => (b.costVsHigh ?? 0) - (a.costVsHigh ?? 0));
}

export function analyzeOverpriced(analysis: PositionAnalysis[]): PositionAnalysis[] {
  return analysis
    .filter((s) => s.targetMedian != null && s.price > s.targetMedian!)
    .map((s) => ({
      ...s,
      recommendation: classifyOverpriced(s.price, s.targetMedian!),
    }))
    .sort((a, b) => b.plPct - a.plPct);
}

export function analyzeBuyOpportunities(analysis: PositionAnalysis[]): PositionAnalysis[] {
  return analysis
    .filter((s) => {
      if (s.targetMedian == null || s.price >= s.targetMedian) return false;
      const upside = s.upsideToMedian ?? 0;
      return upside > THRESHOLDS.buyMinUpsidePct;
    })
    .map((s) => ({
      ...s,
      recommendation: classifyOpportunity(s.upsideToMedian ?? 0),
    }))
    .sort((a, b) => (b.upsideToMedian ?? 0) - (a.upsideToMedian ?? 0));
}

export function runFullAnalysis(
  holdings: Record<string, Holding>,
  prices: Record<string, number>,
  targets: Record<string, AnalystTarget>,
): AnalysisResult {
  const fullAnalysis = buildAnalysis(holdings, prices, targets);
  return {
    laggards: analyzeLaggards(fullAnalysis),
    overpriced: analyzeOverpriced(fullAnalysis),
    buyOpportunities: analyzeBuyOpportunities(fullAnalysis),
    fullAnalysis,
  };
}
