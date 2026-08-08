/**
 * Deterministic opportunity-cost calculator.
 *
 * Fail-fast: never invent yield. Inputs must come from books (deposit interest,
 * fund.expected_yield_pct) or an explicit yield_pct argument.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type OpportunityCostSource =
  | 'explicit_yield_pct'
  | 'fund_expected_yield'
  | 'deposit_implied_yield';

export interface OpportunityCostInput {
  /** Capital at risk / redeployed. Must be > 0. */
  capital: number;
  /** Annual yield in percent points (3.2 = 3.2% p.a.). */
  yieldPct: number;
  /** Holding / forgone horizon in years (> 0). */
  years: number;
  currency: string;
  source: OpportunityCostSource;
  /** Human-readable source detail (holding key, deposit id, user-stated). */
  sourceDetail: string;
  yieldBasis?: string;
  productClass?: string;
  label?: string;
}

export interface OpportunityCostResult {
  capital: number;
  yield_pct: number;
  years: number;
  currency: string;
  /** Simple (undiscounted) forgone amount over the full horizon. */
  soft_cost_total: number;
  /** capital × yield% / 100 (one year run-rate). */
  soft_cost_per_year: number;
  source: OpportunityCostSource;
  source_detail: string;
  yield_basis?: string;
  product_class?: string;
  label?: string;
  cost_class: 'SOFT';
  formula: string;
  caveats: string[];
}

/**
 * Simple opportunity cost: capital × (yield%/100) × years.
 * No compounding, no FX — caller supplies capital already in the desired currency.
 */
export function estimateOpportunityCost(input: OpportunityCostInput): OpportunityCostResult {
  if (!(input.capital > 0) || !Number.isFinite(input.capital)) {
    throw new Error('capital must be a finite number > 0.');
  }
  if (!(input.yieldPct >= 0) || !Number.isFinite(input.yieldPct)) {
    throw new Error('yield_pct must be a finite number ≥ 0.');
  }
  if (input.yieldPct > 100) {
    throw new Error(
      `yield_pct=${input.yieldPct} looks implausible as percent points. Use 3.2 for 3.2% p.a.`,
    );
  }
  if (!(input.years > 0) || !Number.isFinite(input.years)) {
    throw new Error('years must be a finite number > 0 (forgone horizon is required).');
  }
  const ccy = input.currency?.trim().toUpperCase();
  if (!ccy || ccy.length < 3) {
    throw new Error('currency is required (e.g. SGD, USD) — no silent default.');
  }

  const perYear = input.capital * (input.yieldPct / 100);
  const total = perYear * input.years;
  const caveats: string[] = [
    'SOFT opportunity cost only — not a hard fee, tax, or contractual interest charge.',
    'Simple (undiscounted) product of capital × yield × years; not compound growth.',
  ];
  if (input.productClass === 'equity' || input.productClass === 'balanced') {
    caveats.push(
      `product_class=${input.productClass}: total-return risk, not pure coupon income — ` +
        'do not treat soft_cost as a guaranteed distribution.',
    );
  }
  if (input.yieldBasis === 'total_return') {
    caveats.push('yield_basis=total_return includes price path risk, not cash distributions alone.');
  }

  const formula =
    `${input.capital.toFixed(2)} ${ccy} × ${input.yieldPct}% × ${input.years} yr ` +
    `= ${total.toFixed(2)} ${ccy} total ` +
    `(${perYear.toFixed(2)} ${ccy}/yr)`;

  return {
    capital: input.capital,
    yield_pct: input.yieldPct,
    years: input.years,
    currency: ccy,
    soft_cost_total: total,
    soft_cost_per_year: perYear,
    source: input.source,
    source_detail: input.sourceDetail,
    yield_basis: input.yieldBasis,
    product_class: input.productClass,
    label: input.label,
    cost_class: 'SOFT',
    formula,
    caveats,
  };
}

/**
 * Implied simple annual % from full-term deposit interest on books.
 * Same convention as payment-plan deposit guidance.
 */
export function impliedDepositAnnualPct(
  principal: number,
  fullTermInterest: number,
  startDate: string,
  endDate: string,
): number {
  if (!(principal > 0) || !Number.isFinite(principal)) {
    throw new Error('deposit principal must be > 0.');
  }
  if (!(fullTermInterest >= 0) || !Number.isFinite(fullTermInterest)) {
    throw new Error('deposit interest must be ≥ 0.');
  }
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new Error('deposit start_date and end_date must be YYYY-MM-DD.');
  }
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('deposit end_date must be after start_date.');
  }
  const years = (end - start) / (365.25 * 24 * 3600 * 1000);
  if (!(years > 0)) {
    throw new Error('deposit term years must be > 0.');
  }
  return (fullTermInterest / principal / years) * 100;
}
