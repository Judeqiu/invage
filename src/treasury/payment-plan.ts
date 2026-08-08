/**
 * Deterministic household payment-plan engine.
 *
 * Strategies (research-backed defaults):
 * - avalanche: highest APR first → typically lowest total interest
 *   (CFPB "highest interest rate method"; Fidelity / Experian comparisons)
 * - snowball: smallest principal first → faster psychological wins, usually more interest
 *
 * Liquidity / asset order of funding (save money without reckless liquidation):
 * 1) Free cash above optional emergency reserve
 * 2) Deposits only after maturity (never invent early-break penalties)
 * 3) Never auto-sell equities/funds/options — surface as optional last resort only
 *
 * Fail-fast: no silent FX, no invented rates, missing surplus → explicit UNKNOWN path.
 */

import { amortizeMonth } from './amortize.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type PaydownStrategy = 'avalanche' | 'snowball';

export interface PlanLiability {
  id: string;
  kind: string;
  principal: number;
  annual_rate_pct: number;
  payment_amount: number;
  currency: string;
  label?: string;
}

export interface PlanCash {
  amount: number;
  currency: string;
  channel?: string;
}

export interface PlanDeposit {
  id: string;
  amount: number;
  /** Full-term interest amount (not annual rate) — same as books. */
  interest: number;
  currency: string;
  start_date: string;
  end_date: string;
  label?: string;
  channel?: string;
}

export interface PaymentPlanInput {
  asOf: string;
  strategy: PaydownStrategy;
  currency: string;
  liabilities: PlanLiability[];
  freeCash: PlanCash[];
  deposits: PlanDeposit[];
  /** Monthly income in plan currency (from cash_flows). */
  monthlyIncome: number;
  /** Monthly expense in plan currency (from cash_flows). */
  monthlyExpense: number;
  /**
   * Keep this many months of expenses as untouchable free cash.
   * Omit → no emergency reserve reserved by the plan.
   */
  preserveEmergencyMonths?: number;
  /**
   * Extra monthly paydown capacity beyond (income - expense - minimums).
   * When set, replaces computed surplus for the schedule (still fail-fast if < 0).
   */
  extraMonthly?: number;
  /** Cap simulation length (default 360). */
  maxMonths?: number;
}

export interface LiabilityOrderEntry {
  id: string;
  label?: string;
  kind: string;
  principal: number;
  annual_rate_pct: number;
  payment_amount: number;
  rankReason: string;
}

export interface DepositGuidance {
  id: string;
  label?: string;
  amount: number;
  currency: string;
  end_date: string;
  implied_annual_pct: number | null;
  days_to_maturity: number;
  action: 'hold_to_maturity' | 'maturing_soon_consider_paydown' | 'matured_deploy_to_debt' | 'compare_to_debt';
  detail: string;
}

export interface ScheduleMonth {
  month: number;
  as_of: string;
  allocations: Array<{
    liability_id: string;
    payment: number;
    interest: number;
    principal_paid: number;
    principal_after: number;
  }>;
  interest_paid: number;
  total_paid: number;
  remaining_debt: number;
  deposit_unlocks: string[];
}

export interface PaymentPlanResult {
  strategy: PaydownStrategy;
  currency: string;
  as_of: string;
  monthly_minimum_total: number;
  monthly_income: number;
  monthly_expense: number;
  monthly_net_cash_flow: number;
  monthly_surplus_for_debt: number;
  emergency_reserve: number;
  free_cash_total: number;
  deployable_cash_now: number;
  liability_order: LiabilityOrderEntry[];
  deposit_guidance: DepositGuidance[];
  funding_waterfall: string[];
  schedule: ScheduleMonth[];
  summary: {
    months_to_debt_free: number | null;
    total_interest: number;
    total_paid: number;
    debt_free: boolean;
    notes: string[];
  };
}

function assertDate(value: string, field: string): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new Error(`${field} must be YYYY-MM-DD.`);
  }
  return value;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  if (!y || !m || !d) throw new Error(`Invalid date: ${ymd}`);
  return new Date(Date.UTC(y, m - 1, d));
}

function addMonthsYmd(ymd: string, months: number): string {
  const dt = parseYmd(ymd);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  const d = dt.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(a: string, b: string): number {
  const ms = parseYmd(b).getTime() - parseYmd(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Implied simple annual % from full-term interest / principal over term days.
 * Returns null when amount is 0 or term length is 0.
 */
export function impliedDepositAnnualPct(
  amount: number,
  interest: number,
  startDate: string,
  endDate: string,
): number | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  if (!(interest >= 0) || !Number.isFinite(interest)) {
    throw new Error('deposit.interest must be a finite number ≥ 0.');
  }
  const days = daysBetween(startDate, endDate);
  if (days <= 0) return null;
  return (interest / amount) * (365 / days) * 100;
}

function sortLiabilities(
  liabilities: PlanLiability[],
  strategy: PaydownStrategy,
): LiabilityOrderEntry[] {
  const copy = [...liabilities].filter((L) => L.principal > 0);
  if (strategy === 'avalanche') {
    copy.sort((a, b) => {
      if (b.annual_rate_pct !== a.annual_rate_pct) return b.annual_rate_pct - a.annual_rate_pct;
      if (a.principal !== b.principal) return a.principal - b.principal;
      return a.id.localeCompare(b.id);
    });
  } else {
    copy.sort((a, b) => {
      if (a.principal !== b.principal) return a.principal - b.principal;
      if (b.annual_rate_pct !== a.annual_rate_pct) return b.annual_rate_pct - a.annual_rate_pct;
      return a.id.localeCompare(b.id);
    });
  }
  return copy.map((L, i) => ({
    id: L.id,
    label: L.label,
    kind: L.kind,
    principal: L.principal,
    annual_rate_pct: L.annual_rate_pct,
    payment_amount: L.payment_amount,
    rankReason:
      strategy === 'avalanche'
        ? `Avalanche rank #${i + 1}: APR ${L.annual_rate_pct}% (highest rate first → minimize total interest)`
        : `Snowball rank #${i + 1}: principal ${L.principal} (smallest first → faster payoff milestones)`,
  }));
}

function buildDepositGuidance(
  deposits: PlanDeposit[],
  asOf: string,
  orderedDebts: LiabilityOrderEntry[],
  currency: string,
): DepositGuidance[] {
  const topDebt = orderedDebts[0];
  const out: DepositGuidance[] = [];
  for (const d of deposits) {
    if (d.currency.toUpperCase() !== currency.toUpperCase()) {
      out.push({
        id: d.id,
        label: d.label,
        amount: d.amount,
        currency: d.currency,
        end_date: d.end_date,
        implied_annual_pct: null,
        days_to_maturity: daysBetween(asOf, d.end_date),
        action: 'hold_to_maturity',
        detail:
          `Currency ${d.currency} ≠ plan currency ${currency}. ` +
          `Do not auto-convert; set FX / convert on books before using for paydown.`,
      });
      continue;
    }
    const implied = impliedDepositAnnualPct(d.amount, d.interest, d.start_date, d.end_date);
    const days = daysBetween(asOf, d.end_date);
    let action: DepositGuidance['action'];
    let detail: string;
    if (days <= 0) {
      action = 'matured_deploy_to_debt';
      detail = topDebt
        ? `Matured (or past end_date). Prefer deploying principal toward ${topDebt.id} ` +
          `(${topDebt.annual_rate_pct}% APR) before rolling the deposit, if liquidity buffer is intact.`
        : 'Matured. No open debt in plan — keep as free cash or reinvest per goals.';
    } else if (days <= 31) {
      action = 'maturing_soon_consider_paydown';
      detail = topDebt
        ? `Matures in ${days} day(s) on ${d.end_date}. Plan to apply principal to ${topDebt.id} ` +
          `after maturity if still the avalanche target and emergency reserve is met.`
        : `Matures in ${days} day(s). No debt target — decide roll vs free cash.`;
    } else if (
      topDebt != null &&
      implied != null &&
      topDebt.annual_rate_pct > implied + 1
    ) {
      action = 'compare_to_debt';
      detail =
        `Implied ~${implied.toFixed(2)}% simple annual vs debt ${topDebt.id} at ${topDebt.annual_rate_pct}%. ` +
        `Debt costs more than this deposit earns — after maturity, prioritize paydown over re-locking. ` +
        `Do not break early unless the user states early-break cost and still nets savings.`;
    } else {
      action = 'hold_to_maturity';
      detail =
        implied != null
          ? `Hold to ${d.end_date} (implied ~${implied.toFixed(2)}% simple annual). ` +
            `Breaking early is not modeled (penalty unknown).`
          : `Hold to ${d.end_date}. Implied yield unavailable (zero principal or zero term).`;
    }
    out.push({
      id: d.id,
      label: d.label,
      amount: d.amount,
      currency: d.currency,
      end_date: d.end_date,
      implied_annual_pct: implied,
      days_to_maturity: days,
      action,
      detail,
    });
  }
  out.sort((a, b) => a.days_to_maturity - b.days_to_maturity || a.id.localeCompare(b.id));
  return out;
}

export function buildPaymentPlan(input: PaymentPlanInput): PaymentPlanResult {
  const asOf = assertDate(input.asOf, 'asOf');
  if (input.strategy !== 'avalanche' && input.strategy !== 'snowball') {
    throw new Error('strategy must be "avalanche" or "snowball".');
  }
  if (typeof input.currency !== 'string' || input.currency.trim().length === 0) {
    throw new Error('currency is required for the payment plan.');
  }
  const currency = input.currency.trim().toUpperCase();
  if (typeof input.monthlyIncome !== 'number' || !Number.isFinite(input.monthlyIncome) || input.monthlyIncome < 0) {
    throw new Error('monthlyIncome must be a finite number ≥ 0.');
  }
  if (typeof input.monthlyExpense !== 'number' || !Number.isFinite(input.monthlyExpense) || input.monthlyExpense < 0) {
    throw new Error('monthlyExpense must be a finite number ≥ 0.');
  }
  if (!Array.isArray(input.liabilities)) {
    throw new Error('liabilities must be an array.');
  }
  if (!Array.isArray(input.freeCash)) {
    throw new Error('freeCash must be an array.');
  }
  if (!Array.isArray(input.deposits)) {
    throw new Error('deposits must be an array.');
  }

  for (const L of input.liabilities) {
    if (L.currency.toUpperCase() !== currency) {
      throw new Error(
        `Liability ${L.id} currency ${L.currency} ≠ plan currency ${currency}. ` +
          `Convert on books or pass FX-consistent values — no silent FX.`,
      );
    }
    if (!(L.principal >= 0) || !Number.isFinite(L.principal)) {
      throw new Error(`Liability ${L.id}: principal must be finite ≥ 0.`);
    }
    if (!(L.annual_rate_pct >= 0) || !Number.isFinite(L.annual_rate_pct)) {
      throw new Error(`Liability ${L.id}: annual_rate_pct must be finite ≥ 0.`);
    }
    if (!(L.payment_amount >= 0) || !Number.isFinite(L.payment_amount)) {
      throw new Error(`Liability ${L.id}: payment_amount must be finite ≥ 0.`);
    }
  }
  for (const c of input.freeCash) {
    if (c.currency.toUpperCase() !== currency) {
      throw new Error(
        `Free cash channel ${c.channel ?? '(unassigned)'} currency ${c.currency} ≠ plan ${currency}.`,
      );
    }
  }

  const active = input.liabilities.filter((L) => L.principal > 0);
  const liability_order = sortLiabilities(active, input.strategy);
  const monthly_minimum_total = active.reduce((s, L) => s + L.payment_amount, 0);
  const monthly_net = input.monthlyIncome - input.monthlyExpense;

  let monthly_surplus_for_debt: number;
  if (input.extraMonthly != null) {
    if (typeof input.extraMonthly !== 'number' || !Number.isFinite(input.extraMonthly)) {
      throw new Error('extraMonthly must be a finite number when provided.');
    }
    if (input.extraMonthly < 0) {
      throw new Error('extraMonthly must be ≥ 0.');
    }
    monthly_surplus_for_debt = input.extraMonthly;
  } else {
    // Surplus available after contractual minimums from net CF
    monthly_surplus_for_debt = monthly_net - monthly_minimum_total;
  }

  const free_cash_total = input.freeCash.reduce((s, c) => s + c.amount, 0);
  let emergency_reserve = 0;
  if (input.preserveEmergencyMonths != null) {
    if (
      typeof input.preserveEmergencyMonths !== 'number' ||
      !Number.isFinite(input.preserveEmergencyMonths) ||
      input.preserveEmergencyMonths < 0
    ) {
      throw new Error('preserveEmergencyMonths must be a finite number ≥ 0.');
    }
    emergency_reserve = input.monthlyExpense * input.preserveEmergencyMonths;
  }
  const deployable_cash_now = Math.max(0, free_cash_total - emergency_reserve);

  const notes: string[] = [];
  if (active.length === 0) {
    notes.push('No positive-principal liabilities — plan is cash/deposit allocation only.');
  }
  if (monthly_surplus_for_debt < 0 && input.extraMonthly == null) {
    notes.push(
      `Monthly net cash flow ${monthly_net.toFixed(2)} is below contractual minimums ` +
        `${monthly_minimum_total.toFixed(2)}. Schedule uses minimums only where cash allows; ` +
        `surplus is treated as 0. Raise income, cut expense, or set extraMonthly after fixing CF.`,
    );
  }
  if (input.strategy === 'avalanche') {
    notes.push(
      'Default paydown order is avalanche (highest APR first) — typically minimizes total interest ' +
        '(CFPB highest-rate method; industry comparisons vs snowball).',
    );
  } else {
    notes.push(
      'Snowball order (smallest balance first) prioritizes milestones; usually costs more interest than avalanche.',
    );
  }
  notes.push(
    'Funding waterfall: (1) free cash above emergency reserve (2) deposits only after maturity ' +
      '(3) do not auto-sell investments — equity liquidation is a last-resort discussion with opportunity cost.',
  );

  const deposit_guidance = buildDepositGuidance(input.deposits, asOf, liability_order, currency);

  const funding_waterfall = [
    `1. Free cash above emergency reserve (${deployable_cash_now.toFixed(2)} ${currency} deployable now; reserve ${emergency_reserve.toFixed(2)})`,
    '2. Contractual minimum payments every month on all open debts',
    `3. Apply monthly surplus (${Math.max(0, monthly_surplus_for_debt).toFixed(2)} ${currency}) to #1 target in ${input.strategy} order`,
    '4. After each deposit maturity, re-check: if top debt APR > deposit implied yield + ~1pp, deploy principal to debt before re-locking',
    '5. Do not break fixed deposits early unless user provides break cost and net interest savings still positive',
    '6. Portfolio holdings (equities/funds/options): not auto-sold for paydown — ask @Invester for MTM/tax/opportunity cost first',
  ];

  // ── Simulate month by month ──────────────────────────────────────────
  type RuntimeDebt = {
    id: string;
    annual_rate_pct: number;
    payment_amount: number;
    principal: number;
  };
  const runtime: RuntimeDebt[] = liability_order.map((L) => ({
    id: L.id,
    annual_rate_pct: L.annual_rate_pct,
    payment_amount: L.payment_amount,
    principal: L.principal,
  }));

  const maxMonths = input.maxMonths ?? 360;
  if (!Number.isInteger(maxMonths) || maxMonths < 1) {
    throw new Error('maxMonths must be an integer ≥ 1.');
  }

  let cashPool = deployable_cash_now;
  // Unlock deposits that are already matured into cash pool for month 0 extra (one-time)
  for (const g of deposit_guidance) {
    if (g.action === 'matured_deploy_to_debt' && g.currency.toUpperCase() === currency) {
      cashPool += g.amount;
      notes.push(`Included matured deposit ${g.id} (${g.amount.toFixed(2)}) in deployable cash for paydown.`);
    }
  }

  const schedule: ScheduleMonth[] = [];
  let total_interest = 0;
  let total_paid = 0;
  let months_to_debt_free: number | null = null;

  // Month 0: optional lump-sum from deployable cash onto avalanche/snowball target
  if (cashPool > 0 && runtime.some((r) => r.principal > 0)) {
    const allocations: ScheduleMonth['allocations'] = [];
    let remainingCash = cashPool;
    // Apply lump sum in strategy order (full payoff of each before next)
    const orderIds = sortLiabilities(
      runtime.map((r) => ({
        id: r.id,
        kind: 'loan',
        principal: r.principal,
        annual_rate_pct: r.annual_rate_pct,
        payment_amount: r.payment_amount,
        currency,
      })),
      input.strategy,
    ).map((x) => x.id);

    for (const id of orderIds) {
      if (remainingCash <= 0) break;
      const debt = runtime.find((r) => r.id === id);
      if (!debt || debt.principal <= 0) continue;
      const pay = Math.min(remainingCash, debt.principal);
      if (pay <= 0) continue;
      // Lump sum treated as principal-only reduction (no interest step for day-0 extra)
      debt.principal = Math.round((debt.principal - pay) * 100) / 100;
      if (debt.principal < 0.005) debt.principal = 0;
      remainingCash = Math.round((remainingCash - pay) * 100) / 100;
      total_paid += pay;
      allocations.push({
        liability_id: id,
        payment: pay,
        interest: 0,
        principal_paid: pay,
        principal_after: debt.principal,
      });
    }
    cashPool = remainingCash;
    if (allocations.length > 0) {
      schedule.push({
        month: 0,
        as_of: asOf,
        allocations,
        interest_paid: 0,
        total_paid: allocations.reduce((s, a) => s + a.payment, 0),
        remaining_debt: runtime.reduce((s, r) => s + r.principal, 0),
        deposit_unlocks: deposit_guidance
          .filter((g) => g.action === 'matured_deploy_to_debt')
          .map((g) => g.id),
      });
    }
  }

  const monthlyExtra = Math.max(0, monthly_surplus_for_debt);

  for (let m = 1; m <= maxMonths; m++) {
    if (runtime.every((r) => r.principal <= 0)) {
      months_to_debt_free = schedule.some((s) => s.month === 0) ? Math.max(0, m - 1) : m - 1;
      break;
    }
    const monthDate = addMonthsYmd(asOf, m);
    const deposit_unlocks: string[] = [];
    // Unlock deposits maturing this month (between previous month date and this)
    const prevDate = addMonthsYmd(asOf, m - 1);
    for (const d of input.deposits) {
      if (d.currency.toUpperCase() !== currency) continue;
      if (d.end_date > prevDate && d.end_date <= monthDate) {
        cashPool += d.amount;
        deposit_unlocks.push(d.id);
      }
    }

    // Minimums first
    const open = runtime.filter((r) => r.principal > 0);
    const minTotal = open.reduce((s, r) => s + r.payment_amount, 0);
    // Capacity this month: surplus + any unlocked cash still in pool
    // Contractual mins come from cash flow; extra from surplus + cashPool
    let budget = minTotal + monthlyExtra + cashPool;
    cashPool = 0;

    // If budget < minTotal, pay pro-rata? Fail-fast note: pay what we can in strategy order mins first
    const allocations: ScheduleMonth['allocations'] = [];
    let monthInterest = 0;
    let monthPaid = 0;

    // Phase 1: try to fund each minimum in strategy order
    const order = sortLiabilities(
      open.map((r) => ({
        id: r.id,
        kind: 'loan',
        principal: r.principal,
        annual_rate_pct: r.annual_rate_pct,
        payment_amount: r.payment_amount,
        currency,
      })),
      input.strategy,
    );

    for (const entry of order) {
      const debt = runtime.find((r) => r.id === entry.id);
      if (!debt || debt.principal <= 0) continue;
      const desired = Math.min(debt.payment_amount, budget);
      if (desired <= 0) continue;
      const step = amortizeMonth(debt.principal, debt.annual_rate_pct, desired);
      debt.principal = step.remainingPrincipal;
      budget = Math.round((budget - step.paymentApplied) * 100) / 100;
      monthInterest += step.interest;
      monthPaid += step.paymentApplied;
      allocations.push({
        liability_id: debt.id,
        payment: step.paymentApplied,
        interest: step.interest,
        principal_paid: step.principalPaid,
        principal_after: debt.principal,
      });
    }

    // Phase 2: dump remaining budget on #1 target (avalanche/snowball)
    while (budget > 0.009 && runtime.some((r) => r.principal > 0)) {
      const targets = sortLiabilities(
        runtime
          .filter((r) => r.principal > 0)
          .map((r) => ({
            id: r.id,
            kind: 'loan',
            principal: r.principal,
            annual_rate_pct: r.annual_rate_pct,
            payment_amount: r.payment_amount,
            currency,
          })),
        input.strategy,
      );
      const top = targets[0];
      if (!top) break;
      const debt = runtime.find((r) => r.id === top.id);
      if (!debt || debt.principal <= 0) break;
      // Additional payment in same month: interest already accrued once on mins;
      // treat residual as principal-only to avoid double-charging monthly interest.
      const pay = Math.min(budget, debt.principal);
      debt.principal = Math.round((debt.principal - pay) * 100) / 100;
      if (debt.principal < 0.005) debt.principal = 0;
      budget = Math.round((budget - pay) * 100) / 100;
      monthPaid += pay;
      const existing = allocations.find((a) => a.liability_id === debt.id);
      if (existing) {
        existing.payment += pay;
        existing.principal_paid += pay;
        existing.principal_after = debt.principal;
      } else {
        allocations.push({
          liability_id: debt.id,
          payment: pay,
          interest: 0,
          principal_paid: pay,
          principal_after: debt.principal,
        });
      }
    }

    total_interest += monthInterest;
    total_paid += monthPaid;
    schedule.push({
      month: m,
      as_of: monthDate,
      allocations,
      interest_paid: monthInterest,
      total_paid: monthPaid,
      remaining_debt: runtime.reduce((s, r) => s + r.principal, 0),
      deposit_unlocks,
    });

    if (runtime.every((r) => r.principal <= 0)) {
      months_to_debt_free = m;
      break;
    }
  }

  if (months_to_debt_free == null && runtime.every((r) => r.principal <= 0)) {
    months_to_debt_free = 0;
  }
  if (months_to_debt_free == null) {
    notes.push(
      `Debts remain after ${maxMonths} months under this surplus. Increase extraMonthly or income, or cut expenses.`,
    );
  }

  return {
    strategy: input.strategy,
    currency,
    as_of: asOf,
    monthly_minimum_total,
    monthly_income: input.monthlyIncome,
    monthly_expense: input.monthlyExpense,
    monthly_net_cash_flow: monthly_net,
    monthly_surplus_for_debt: Math.max(0, monthly_surplus_for_debt),
    emergency_reserve,
    free_cash_total,
    deployable_cash_now,
    liability_order,
    deposit_guidance,
    funding_waterfall,
    schedule,
    summary: {
      months_to_debt_free,
      total_interest: Math.round(total_interest * 100) / 100,
      total_paid: Math.round(total_paid * 100) / 100,
      debt_free: runtime.every((r) => r.principal <= 0),
      notes,
    },
  };
}
