/**
 * Structured affordability verdict from a projection (and optional base compare).
 */

import type { ProjectionResult } from './project.js';

export type AffordabilityVerdict =
  | 'AFFORDABLE'
  | 'TIGHT'
  | 'NOT_AFFORDABLE'
  | 'UNKNOWN';

export interface AffordabilityResult {
  verdict: AffordabilityVerdict;
  peakCashNeed: number | null;
  minFreeCash: number;
  minFreeCashMonth: string;
  postPurchaseMonthlyNetCf: number | null;
  shortfallMonths: number;
  gaps: string[];
  notes: string[];
}

export interface AffordabilityInput {
  projection: ProjectionResult;
  /** First month key (YYYY-MM) of a buy_property event, if any. */
  purchaseMonth: string | null;
  /** Explicit cash out at purchase (down payment + fees) in reporting ccy. */
  peakCashNeed?: number | null;
  gaps?: string[];
}

/**
 * v1 rules:
 * - UNKNOWN if projection has unknown gaps or caller passes gaps
 * - NOT_AFFORDABLE if any liquidity_shortfall or purchase made free cash negative
 * - TIGHT if no shortfall but post-buy net CF ≤ 0, or min free cash < cash_buffer when set
 * - else AFFORDABLE
 */
export function evaluateAffordability(input: AffordabilityInput): AffordabilityResult {
  const gaps = input.gaps ?? [];
  const { projection, purchaseMonth } = input;
  const notes: string[] = [];

  if (gaps.length > 0) {
    return {
      verdict: 'UNKNOWN',
      peakCashNeed: input.peakCashNeed ?? null,
      minFreeCash: projection.summary.minFreeCash,
      minFreeCashMonth: projection.summary.minFreeCashMonth,
      postPurchaseMonthlyNetCf: null,
      shortfallMonths: projection.summary.shortfallMonths,
      gaps,
      notes: ['Missing inputs — cannot assess affordability.'],
    };
  }

  const shortfallMonths = projection.summary.shortfallMonths;
  const minFreeCash = projection.summary.minFreeCash;
  const minFreeCashMonth = projection.summary.minFreeCashMonth;
  const peakCashNeed = input.peakCashNeed ?? null;

  let postPurchaseMonthlyNetCf: number | null = null;
  if (purchaseMonth != null) {
    const idx = projection.months.findIndex((m) => m.month === purchaseMonth);
    if (idx >= 0 && idx + 1 < projection.months.length) {
      postPurchaseMonthlyNetCf = projection.months[idx + 1].netCashFlow;
    } else if (idx >= 0) {
      postPurchaseMonthlyNetCf = projection.months[idx].netCashFlow;
      notes.push('No full month after purchase in horizon; used purchase month net CF.');
    }
  }

  if (shortfallMonths > 0 || minFreeCash < 0) {
    return {
      verdict: 'NOT_AFFORDABLE',
      peakCashNeed,
      minFreeCash,
      minFreeCashMonth,
      postPurchaseMonthlyNetCf,
      shortfallMonths,
      gaps: [],
      notes: [
        shortfallMonths > 0
          ? `${shortfallMonths} month(s) with liquidity shortfall.`
          : 'Projected free cash goes negative.',
      ],
    };
  }

  const buffer =
    typeof projection.assumptionsUsed.cash_buffer === 'number'
      ? (projection.assumptionsUsed.cash_buffer as number)
      : null;

  const tightReasons: string[] = [];
  if (postPurchaseMonthlyNetCf != null && postPurchaseMonthlyNetCf <= 0) {
    tightReasons.push('Post-purchase monthly net cash flow ≤ 0.');
  }
  if (buffer != null && minFreeCash < buffer) {
    tightReasons.push(
      `Min free cash ${minFreeCash.toFixed(2)} is below cash_buffer ${buffer.toFixed(2)}.`,
    );
  }

  if (tightReasons.length > 0) {
    return {
      verdict: 'TIGHT',
      peakCashNeed,
      minFreeCash,
      minFreeCashMonth,
      postPurchaseMonthlyNetCf,
      shortfallMonths,
      gaps: [],
      notes: tightReasons,
    };
  }

  return {
    verdict: 'AFFORDABLE',
    peakCashNeed,
    minFreeCash,
    minFreeCashMonth,
    postPurchaseMonthlyNetCf,
    shortfallMonths,
    gaps: [],
    notes: notes.length > 0 ? notes : ['No liquidity shortfall; post-purchase cash flow positive or N/A.'],
  };
}

export function formatAffordability(a: AffordabilityResult): string {
  const lines = [
    `Affordability: ${a.verdict}`,
    `  Peak cash need: ${a.peakCashNeed != null ? a.peakCashNeed.toFixed(2) : 'n/a'}`,
    `  Min projected free cash: ${a.minFreeCash.toFixed(2)} (${a.minFreeCashMonth})`,
    `  Post-purchase monthly net CF: ${
      a.postPurchaseMonthlyNetCf != null ? a.postPurchaseMonthlyNetCf.toFixed(2) : 'n/a'
    }`,
    `  Shortfall months: ${a.shortfallMonths}`,
  ];
  if (a.gaps.length > 0) lines.push(`  Gaps: ${a.gaps.join('; ')}`);
  if (a.notes.length > 0) lines.push(`  Notes: ${a.notes.join(' ')}`);
  return lines.join('\n');
}
