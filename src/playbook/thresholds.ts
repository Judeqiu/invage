import { THRESHOLDS } from '../market/config.js';
import type { InvestmentPlaybook, Philosophy, RiskProfile, Strategy } from './types.js';

/**
 * Analyzer / recommendation thresholds derived from the user playbook.
 * Base numbers come from market THRESHOLDS; risk + philosophy + strategy tilt them.
 */
export interface PlaybookThresholds {
  buyMinUpsidePct: number;
  strongBuyUpsidePct: number;
  deepLossSellPct: number;
  holdLossMonitorPct: number;
  takeProfitPremiumPct: number;
  trailStopPremiumPct: number;
  pegAttractive: number;
  pegExpensive: number;
  peAttractive: number;
  peExpensive: number;
  forwardPeAttractive: number;
  forwardPeExpensive: number;
  fcfYieldAttractive: number;
  /** Soft weight for ranking: how much to prefer yield names (0–1). */
  incomeBias: number;
  /** Soft weight for ranking: how much to prefer growth metrics (0–1). */
  growthBias: number;
  /** Soft weight for ranking: how much to prefer classic value cheapness (0–1). */
  valueBias: number;
}

function riskTilt(profile: RiskProfile): {
  buyDelta: number;
  strongDelta: number;
  deepLoss: number;
  holdLoss: number;
  takeProfit: number;
  trailStop: number;
} {
  switch (profile) {
    case 'conservative':
      return {
        buyDelta: 5,
        strongDelta: 5,
        deepLoss: -20,
        holdLoss: -10,
        takeProfit: 12,
        trailStop: 6,
      };
    case 'aggressive':
      return {
        buyDelta: -5,
        strongDelta: -5,
        deepLoss: -40,
        holdLoss: -20,
        takeProfit: 30,
        trailStop: 15,
      };
    case 'balanced':
      return {
        buyDelta: 0,
        strongDelta: 0,
        deepLoss: -30,
        holdLoss: -15,
        takeProfit: 20,
        trailStop: 10,
      };
  }
}

function philosophyMultiples(philosophy: Philosophy): Pick<
  PlaybookThresholds,
  | 'pegAttractive'
  | 'pegExpensive'
  | 'peAttractive'
  | 'peExpensive'
  | 'forwardPeAttractive'
  | 'forwardPeExpensive'
  | 'fcfYieldAttractive'
  | 'incomeBias'
  | 'growthBias'
  | 'valueBias'
> {
  switch (philosophy) {
    case 'growth_investing':
      return {
        pegAttractive: THRESHOLDS.pegAttractive,
        pegExpensive: THRESHOLDS.pegExpensive + 0.5,
        peAttractive: THRESHOLDS.peAttractive + 8,
        peExpensive: THRESHOLDS.peExpensive + 10,
        forwardPeAttractive: THRESHOLDS.forwardPeAttractive + 6,
        forwardPeExpensive: THRESHOLDS.forwardPeExpensive + 8,
        fcfYieldAttractive: THRESHOLDS.fcfYieldAttractive - 0.01,
        incomeBias: 0.15,
        growthBias: 0.7,
        valueBias: 0.35,
      };
    case 'dividend_investing':
      return {
        pegAttractive: THRESHOLDS.pegAttractive,
        pegExpensive: THRESHOLDS.pegExpensive,
        peAttractive: THRESHOLDS.peAttractive - 2,
        peExpensive: THRESHOLDS.peExpensive - 2,
        forwardPeAttractive: THRESHOLDS.forwardPeAttractive - 2,
        forwardPeExpensive: THRESHOLDS.forwardPeExpensive - 2,
        fcfYieldAttractive: THRESHOLDS.fcfYieldAttractive + 0.01,
        incomeBias: 0.75,
        growthBias: 0.2,
        valueBias: 0.5,
      };
    case 'value_investing':
      return {
        pegAttractive: THRESHOLDS.pegAttractive - 0.2,
        pegExpensive: THRESHOLDS.pegExpensive - 0.2,
        peAttractive: THRESHOLDS.peAttractive - 3,
        peExpensive: THRESHOLDS.peExpensive - 3,
        forwardPeAttractive: THRESHOLDS.forwardPeAttractive - 2,
        forwardPeExpensive: THRESHOLDS.forwardPeExpensive - 2,
        fcfYieldAttractive: THRESHOLDS.fcfYieldAttractive,
        incomeBias: 0.25,
        growthBias: 0.25,
        valueBias: 0.8,
      };
  }
}

function strategyBias(strategy: Strategy): Partial<
  Pick<PlaybookThresholds, 'incomeBias' | 'growthBias' | 'valueBias'>
> {
  switch (strategy) {
    case 'income':
      return { incomeBias: 0.2 };
    case 'growth':
      return { growthBias: 0.15 };
    case 'capital_preservation':
      return { valueBias: 0.1, growthBias: -0.1 };
  }
}

export function thresholdsForPlaybook(pb: InvestmentPlaybook): PlaybookThresholds {
  // Prefer risk.profile; AI recommendation style can tighten/loosen buy language further.
  const risk = riskTilt(pb.risk.profile);
  const style = riskTilt(pb.buy_sell.ai_recommendation_style);
  const buyDelta = (risk.buyDelta + style.buyDelta) / 2;
  const strongDelta = (risk.strongDelta + style.strongDelta) / 2;

  const mult = philosophyMultiples(pb.philosophy);
  const sb = strategyBias(pb.strategy);

  const clampBias = (n: number) => Math.max(0, Math.min(1, n));

  return {
    buyMinUpsidePct: Math.max(5, THRESHOLDS.buyMinUpsidePct + buyDelta),
    strongBuyUpsidePct: Math.max(10, THRESHOLDS.strongBuyUpsidePct + strongDelta),
    deepLossSellPct: Math.min(risk.deepLoss, style.deepLoss),
    holdLossMonitorPct: Math.min(risk.holdLoss, style.holdLoss),
    takeProfitPremiumPct: Math.min(risk.takeProfit, style.takeProfit),
    trailStopPremiumPct: Math.min(risk.trailStop, style.trailStop),
    pegAttractive: mult.pegAttractive,
    pegExpensive: mult.pegExpensive,
    peAttractive: mult.peAttractive,
    peExpensive: mult.peExpensive,
    forwardPeAttractive: mult.forwardPeAttractive,
    forwardPeExpensive: mult.forwardPeExpensive,
    fcfYieldAttractive: mult.fcfYieldAttractive,
    incomeBias: clampBias(mult.incomeBias + (sb.incomeBias ?? 0)),
    growthBias: clampBias(mult.growthBias + (sb.growthBias ?? 0)),
    valueBias: clampBias(mult.valueBias + (sb.valueBias ?? 0)),
  };
}
