/**
 * Level-payment amortizing loan math (monthly compounding).
 *
 * monthly rate r = annual_rate_pct / 100 / 12
 * payment = P * r * (1+r)^n / ((1+r)^n - 1)   when r > 0
 * payment = P / n                              when r = 0
 */

const DEFAULT_PAYMENT_TOLERANCE = 0.02; // absolute currency units
const DEFAULT_PAYMENT_TOLERANCE_PCT = 0.005; // 0.5% relative

export function monthlyRateFromAnnualPct(annualRatePct: number): number {
  if (typeof annualRatePct !== 'number' || !Number.isFinite(annualRatePct)) {
    throw new Error('annualRatePct must be a finite number.');
  }
  if (annualRatePct < 0) {
    throw new Error('annualRatePct must be ≥ 0.');
  }
  return annualRatePct / 100 / 12;
}

/** Standard annuity payment for principal P, monthly rate r, n months. */
export function annuityPayment(principal: number, annualRatePct: number, termMonths: number): number {
  if (typeof principal !== 'number' || !Number.isFinite(principal) || principal < 0) {
    throw new Error('principal must be a finite number ≥ 0.');
  }
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new Error('termMonths must be an integer ≥ 1.');
  }
  if (principal === 0) return 0;
  const r = monthlyRateFromAnnualPct(annualRatePct);
  if (r === 0) return principal / termMonths;
  const growth = Math.pow(1 + r, termMonths);
  return (principal * r * growth) / (growth - 1);
}

export function assertPaymentMatchesAnnuity(
  principal: number,
  annualRatePct: number,
  termMonths: number,
  payment: number,
  tolerance?: number,
): void {
  if (principal === 0) return;
  const expected = annuityPayment(principal, annualRatePct, termMonths);
  const absTol = tolerance ?? DEFAULT_PAYMENT_TOLERANCE;
  const relTol = Math.max(absTol, Math.abs(expected) * DEFAULT_PAYMENT_TOLERANCE_PCT);
  if (Math.abs(payment - expected) > relTol) {
    throw new Error(
      `payment_amount ${payment.toFixed(4)} does not match annuity payment ` +
        `${expected.toFixed(4)} for principal=${principal}, rate=${annualRatePct}% , term=${termMonths}m ` +
        `(tolerance ${relTol.toFixed(4)}). Pass the computed payment or fix rate/term/principal.`,
    );
  }
}

export interface AmortizeStepResult {
  interest: number;
  principalPaid: number;
  paymentApplied: number;
  remainingPrincipal: number;
}

/**
 * One monthly payment step. If payment > remaining + interest, pays off early.
 * Does not handle cash availability — caller checks liquidity.
 */
export function amortizeMonth(
  remainingPrincipal: number,
  annualRatePct: number,
  payment: number,
): AmortizeStepResult {
  if (typeof remainingPrincipal !== 'number' || !Number.isFinite(remainingPrincipal)) {
    throw new Error('remainingPrincipal must be finite.');
  }
  if (remainingPrincipal < 0) {
    throw new Error('remainingPrincipal must be ≥ 0.');
  }
  if (typeof payment !== 'number' || !Number.isFinite(payment) || payment < 0) {
    throw new Error('payment must be a finite number ≥ 0.');
  }
  if (remainingPrincipal === 0) {
    return {
      interest: 0,
      principalPaid: 0,
      paymentApplied: 0,
      remainingPrincipal: 0,
    };
  }
  const r = monthlyRateFromAnnualPct(annualRatePct);
  const interest = remainingPrincipal * r;
  const maxPay = remainingPrincipal + interest;
  const paymentApplied = Math.min(payment, maxPay);
  let principalPaid = paymentApplied - interest;
  if (principalPaid < 0) {
    // Payment smaller than interest only — interest accrues (negative amort). Fail-fast.
    throw new Error(
      `Payment ${payment.toFixed(4)} is less than monthly interest ${interest.toFixed(4)}; ` +
        'negative amortization is not supported in v1.',
    );
  }
  let next = remainingPrincipal - principalPaid;
  if (next < 1e-9) {
    principalPaid = remainingPrincipal;
    next = 0;
  }
  return {
    interest,
    principalPaid,
    paymentApplied,
    remainingPrincipal: next,
  };
}

/** Whole months from date A to date B (floor), based on year/month only. */
export function monthsBetween(fromYmd: string, toYmd: string): number {
  const from = parseYmd(fromYmd);
  const to = parseYmd(toYmd);
  return (to.y - from.y) * 12 + (to.m - from.m);
}

export function addMonths(ymd: string, months: number): string {
  const { y, m, d } = parseYmd(ymd);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const dim = daysInMonth(ny, nm);
  const nd = Math.min(d, dim);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function monthKey(ymd: string): string {
  const { y, m } = parseYmd(ymd);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** First day of month for as_of. */
export function startOfMonth(ymd: string): string {
  const { y, m } = parseYmd(ymd);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`Invalid date "${ymd}" (expected YYYY-MM-DD).`);
  }
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`Invalid calendar date "${ymd}".`);
  }
  return { y, m, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Remaining term months from as_of given original start_date + term_months.
 * Floor at 0.
 */
export function remainingTermMonths(
  startDate: string,
  termMonths: number,
  asOf: string,
): number {
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new Error('termMonths must be an integer ≥ 1.');
  }
  const elapsed = monthsBetween(startDate, asOf);
  return Math.max(0, termMonths - Math.max(0, elapsed));
}
