/**
 * Deterministic household projection engine (monthly).
 *
 * Every total in reporting currency requires explicit FX when source currency differs.
 * No silent defaults for returns, inflation, or FX.
 */

import type {
  CashFlowFrequency,
  CashFlowLine,
  Liability,
  ProjectionAssumptions,
  PropertyAsset,
  SavedScenario,
  ScenarioEvent,
} from '../state/household-state.js';
import {
  addMonths,
  amortizeMonth,
  annuityPayment,
  monthKey,
  remainingTermMonths,
  startOfMonth,
} from './amortize.js';

export interface DepositSnapshot {
  id: string;
  amount: number;
  currency: string;
  end_date: string;
}

export interface ProjectBooks {
  reportingCurrency: string;
  /** Free cash already in reporting currency (caller converts). */
  freeCash: number;
  /** Portfolio MTM in reporting currency. */
  portfolioValue: number;
  deposits: DepositSnapshot[];
  properties: PropertyAsset[];
  liabilities: Liability[];
  cashFlows: CashFlowLine[];
}

export interface ProjectionMonthRow {
  month: string;
  freeCash: number;
  portfolio: number;
  deposits: number;
  property: number;
  debt: number;
  netWorth: number;
  netCashFlow: number;
  flags: string[];
}

export interface ProjectionSummary {
  endNetWorth: number;
  minFreeCash: number;
  minFreeCashMonth: string;
  shortfallMonths: number;
  totalIncome: number;
  totalExpense: number;
}

export interface ProjectionResult {
  asOf: string;
  horizonMonths: number;
  reportingCurrency: string;
  scenarioId: string | null;
  months: ProjectionMonthRow[];
  summary: ProjectionSummary;
  assumptionsUsed: Record<string, unknown>;
  /** Purchase month key if scenario had buy_property. */
  purchaseMonth: string | null;
  /** Peak cash need for buy events (down payment + negative one_offs that month). */
  peakCashNeed: number | null;
}

export interface ProjectInput {
  books: ProjectBooks;
  assumptions: ProjectionAssumptions;
  scenario?: SavedScenario | null;
  horizonMonths: number;
  asOf: string;
}

function annualToMonthlyFactor(annualPct: number): number {
  return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
}

/**
 * Convert amount to reporting currency. Same ccy → passthrough.
 * FX map: units of reporting per 1 unit of foreign.
 */
export function toReporting(
  amount: number,
  currency: string,
  reportingCurrency: string,
  fx: Record<string, number> | undefined,
  context: string,
): number {
  const ccy = currency.trim().toUpperCase();
  const rep = reportingCurrency.trim().toUpperCase();
  if (ccy === rep) return amount;
  if (fx == null || fx[ccy] == null) {
    throw new Error(
      `Missing FX rate for ${ccy}→${rep} (${context}). ` +
        `Set projection_assumptions.fx.${ccy} = units of ${rep} per 1 ${ccy}.`,
    );
  }
  const rate = fx[ccy];
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new Error(`Invalid FX rate for ${ccy}: ${rate}`);
  }
  return amount * rate;
}

function mergeAssumptions(
  base: ProjectionAssumptions,
  scenario: SavedScenario | null | undefined,
): ProjectionAssumptions {
  if (scenario?.assumption_overrides == null) return base;
  const o = scenario.assumption_overrides;
  const merged: ProjectionAssumptions = {
    ...base,
    portfolio_return_annual_pct:
      o.portfolio_return_annual_pct ?? base.portfolio_return_annual_pct,
    inflation_annual_pct: o.inflation_annual_pct ?? base.inflation_annual_pct,
    updated_at: base.updated_at,
  };
  if (o.property_appreciation_annual_pct != null) {
    merged.property_appreciation_annual_pct = o.property_appreciation_annual_pct;
  } else if (base.property_appreciation_annual_pct != null) {
    merged.property_appreciation_annual_pct = base.property_appreciation_annual_pct;
  }
  if (o.cash_buffer != null) merged.cash_buffer = o.cash_buffer;
  else if (base.cash_buffer != null) merged.cash_buffer = base.cash_buffer;
  if (o.fx != null || base.fx != null) {
    merged.fx = { ...(base.fx ?? {}), ...(o.fx ?? {}) };
  }
  return merged;
}

interface RuntimeLiability {
  id: string;
  principal: number;
  annual_rate_pct: number;
  payment_amount: number;
  currency: string;
}

interface RuntimeProperty {
  id: string;
  value: number;
  currency: string;
  label?: string;
}

interface RuntimeCf {
  id: string;
  kind: 'income' | 'expense';
  amount: number;
  currency: string;
  frequency: CashFlowFrequency;
  start_date: string;
  end_date?: string;
}

export function project(input: ProjectInput): ProjectionResult {
  const { books, horizonMonths, asOf } = input;
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1) {
    throw new Error('horizonMonths must be an integer ≥ 1.');
  }
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error('asOf must be YYYY-MM-DD.');
  }
  if (typeof books.reportingCurrency !== 'string' || books.reportingCurrency.trim().length === 0) {
    throw new Error('reportingCurrency is required.');
  }
  if (typeof books.freeCash !== 'number' || !Number.isFinite(books.freeCash)) {
    throw new Error('freeCash must be a finite number (use 0 only when cash is recorded as 0).');
  }
  if (typeof books.portfolioValue !== 'number' || !Number.isFinite(books.portfolioValue)) {
    throw new Error('portfolioValue must be a finite number.');
  }
  if (books.portfolioValue < 0) {
    throw new Error('portfolioValue must be ≥ 0.');
  }

  const scenario = input.scenario ?? null;
  const assumptions = mergeAssumptions(input.assumptions, scenario);
  const rep = books.reportingCurrency.trim().toUpperCase();
  const fx = assumptions.fx;
  const portMonthly = annualToMonthlyFactor(assumptions.portfolio_return_annual_pct);
  const propMonthly = annualToMonthlyFactor(
    assumptions.property_appreciation_annual_pct ?? 0,
  );

  let freeCash = books.freeCash;
  let portfolio = books.portfolioValue;

  const deposits = books.deposits.map((d) => ({ ...d }));
  const properties: RuntimeProperty[] = books.properties.map((p) => ({
    id: p.id,
    value: p.value,
    currency: p.currency,
    label: p.label,
  }));
  const liabilities: RuntimeLiability[] = books.liabilities.map((L) => {
    const rem = remainingTermMonths(L.start_date, L.term_months, asOf);
    // If fully past term, principal still tracked until paid — keep principal as stored
    void rem;
    return {
      id: L.id,
      principal: L.principal,
      annual_rate_pct: L.annual_rate_pct,
      payment_amount: L.payment_amount,
      currency: L.currency,
    };
  });
  const cashFlows: RuntimeCf[] = books.cashFlows.map((c) => ({
    id: c.id,
    kind: c.kind,
    amount: c.amount,
    currency: c.currency,
    frequency: c.frequency,
    start_date: c.start_date,
    end_date: c.end_date,
  }));

  const events = scenario?.events ? [...scenario.events] : [];
  let purchaseMonth: string | null = null;
  let peakCashNeed: number | null = null;
  let propSeq = 0;
  let loanSeq = 0;
  let cfSeq = 0;

  const months: ProjectionMonthRow[] = [];
  let totalIncome = 0;
  let totalExpense = 0;
  let shortfallMonths = 0;
  let minFreeCash = Infinity;
  let minFreeCashMonth = monthKey(asOf);

  const anchor = startOfMonth(asOf);

  for (let t = 0; t < horizonMonths; t++) {
    const monthStart = addMonths(anchor, t);
    const monthEnd = addMonths(monthStart, 1);
    // last day-ish: use day before next month start by using dates as strings
    // Event window: [monthStart, nextMonthStart)
    const nextMonthStart = addMonths(monthStart, 1);
    const mKey = monthKey(monthStart);
    const flags: string[] = [];
    let netCf = 0;

    // 1) Scheduled cash flows
    for (const line of cashFlows) {
      // Active if start_date < nextMonthStart and (no end or end_date >= monthStart)
      if (line.start_date >= nextMonthStart) continue;
      if (line.end_date != null && line.end_date < monthStart) continue;
      if (line.frequency === 'annual') {
        if (monthKey(line.start_date).slice(5, 7) !== mKey.slice(5, 7)) continue;
        // Not before first anniversary month of start
        if (monthKey(line.start_date) > mKey) continue;
      } else {
        // monthly: include if started on or before this month
        if (monthKey(line.start_date) > mKey) continue;
      }
      const signed =
        line.kind === 'income'
          ? toReporting(line.amount, line.currency, rep, fx, `cash_flow ${line.id}`)
          : -toReporting(line.amount, line.currency, rep, fx, `cash_flow ${line.id}`);
      freeCash += signed;
      netCf += signed;
      if (signed >= 0) totalIncome += signed;
      else totalExpense += -signed;
    }

    // 2) Service liabilities
    for (const L of liabilities) {
      if (L.principal <= 0) continue;
      const paymentRep = toReporting(
        L.payment_amount,
        L.currency,
        rep,
        fx,
        `liability ${L.id} payment`,
      );
      if (freeCash + 1e-9 < paymentRep) {
        flags.push('liquidity_shortfall');
        // Apply partial: still try to pay what we can? Design: flag shortfall, do not invent borrowing.
        // We still apply amortize if cash covers — else skip payment and keep principal (flag only).
        // Strict: do not reduce principal if unpaid.
        continue;
      }
      // Amortize in liability currency space for accuracy, then convert cash delta
      const step = amortizeMonth(L.principal, L.annual_rate_pct, L.payment_amount);
      L.principal = step.remainingPrincipal;
      freeCash -= paymentRep;
      netCf -= paymentRep;
      totalExpense += paymentRep;
    }

    // 3) Deposit maturities (principal only) — end_date within this month
    for (const d of deposits) {
      if (d.amount <= 0) continue;
      if (d.end_date >= monthStart && d.end_date < nextMonthStart) {
        const principalRep = toReporting(
          d.amount,
          d.currency,
          rep,
          fx,
          `deposit ${d.id} maturity`,
        );
        freeCash += principalRep;
        netCf += principalRep;
        d.amount = 0;
      }
    }

    // 4) Portfolio growth (on start-of-month portfolio after CF? Design: apply to start-of-month MTM)
    // Apply growth after cash ops so surplus isn't auto-invested (stays cash).
    portfolio = portfolio * (1 + portMonthly);

    // 5) Property appreciation
    for (const p of properties) {
      p.value = p.value * (1 + propMonthly);
    }

    // 6) Scenario events
    const monthEvents = events.filter(
      (e) => e.date >= monthStart && e.date < nextMonthStart,
    );
    for (const ev of monthEvents) {
      if (ev.type === 'buy_property') {
        purchaseMonth = mKey;
        const valueRep = toReporting(
          ev.property_value,
          ev.currency,
          rep,
          fx,
          'buy_property value',
        );
        const downRep = toReporting(
          ev.down_payment,
          ev.currency,
          rep,
          fx,
          'buy_property down_payment',
        );
        peakCashNeed = (peakCashNeed ?? 0) + downRep;
        if (freeCash + 1e-9 < downRep) {
          flags.push('liquidity_shortfall');
        }
        freeCash -= downRep;
        netCf -= downRep;
        totalExpense += downRep;
        propSeq += 1;
        const propId = `scenario-prop-${propSeq}`;
        properties.push({
          id: propId,
          value: ev.property_value, // store in native; convert on sum
          currency: ev.currency,
          label: ev.label,
        });
        // valueRep used for NW via conversion each row
        void valueRep;
        const financed = ev.property_value - ev.down_payment;
        if (financed > 1e-9) {
          if (ev.mortgage == null) {
            throw new Error(
              `buy_property on ${ev.date}: property_value - down_payment > 0 but mortgage terms missing.`,
            );
          }
          const payment =
            ev.mortgage.payment_amount ??
            annuityPayment(
              financed,
              ev.mortgage.annual_rate_pct,
              ev.mortgage.term_months,
            );
          loanSeq += 1;
          liabilities.push({
            id: `scenario-loan-${loanSeq}`,
            principal: financed,
            annual_rate_pct: ev.mortgage.annual_rate_pct,
            payment_amount: payment,
            currency: ev.currency,
          });
        }
      } else if (ev.type === 'add_expense' || ev.type === 'add_income') {
        cfSeq += 1;
        cashFlows.push({
          id: `scenario-cf-${cfSeq}`,
          kind: ev.type === 'add_expense' ? 'expense' : 'income',
          amount: ev.amount,
          currency: ev.currency,
          frequency: ev.frequency,
          start_date: ev.date,
        });
        // Also apply in this month if monthly/annual matches
        if (ev.frequency === 'monthly' || monthKey(ev.date).slice(5, 7) === mKey.slice(5, 7)) {
          const signed =
            ev.type === 'add_income'
              ? toReporting(ev.amount, ev.currency, rep, fx, 'scenario add_income')
              : -toReporting(ev.amount, ev.currency, rep, fx, 'scenario add_expense');
          freeCash += signed;
          netCf += signed;
          if (signed >= 0) totalIncome += signed;
          else totalExpense += -signed;
        }
      } else if (ev.type === 'one_off') {
        const delta = toReporting(ev.amount, ev.currency, rep, fx, 'scenario one_off');
        if (delta < 0) {
          peakCashNeed = (peakCashNeed ?? 0) + -delta;
          if (freeCash + 1e-9 < -delta) flags.push('liquidity_shortfall');
        }
        freeCash += delta;
        netCf += delta;
        if (delta >= 0) totalIncome += delta;
        else totalExpense += -delta;
      }
    }

    // Totals in reporting ccy
    let depSum = 0;
    for (const d of deposits) {
      if (d.amount <= 0) continue;
      depSum += toReporting(d.amount, d.currency, rep, fx, `deposit ${d.id}`);
    }
    let propSum = 0;
    for (const p of properties) {
      propSum += toReporting(p.value, p.currency, rep, fx, `property ${p.id}`);
    }
    let debtSum = 0;
    for (const L of liabilities) {
      if (L.principal <= 0) continue;
      debtSum += toReporting(L.principal, L.currency, rep, fx, `liability ${L.id}`);
    }

    const netWorth = freeCash + portfolio + depSum + propSum - debtSum;
    if (flags.includes('liquidity_shortfall')) shortfallMonths += 1;
    if (freeCash < minFreeCash) {
      minFreeCash = freeCash;
      minFreeCashMonth = mKey;
    }

    months.push({
      month: mKey,
      freeCash,
      portfolio,
      deposits: depSum,
      property: propSum,
      debt: debtSum,
      netWorth,
      netCashFlow: netCf,
      flags: [...new Set(flags)],
    });
  }

  if (minFreeCash === Infinity) {
    minFreeCash = books.freeCash;
  }

  const end = months[months.length - 1];
  return {
    asOf,
    horizonMonths,
    reportingCurrency: rep,
    scenarioId: scenario?.id ?? null,
    months,
    summary: {
      endNetWorth: end.netWorth,
      minFreeCash,
      minFreeCashMonth,
      shortfallMonths,
      totalIncome,
      totalExpense,
    },
    assumptionsUsed: {
      portfolio_return_annual_pct: assumptions.portfolio_return_annual_pct,
      inflation_annual_pct: assumptions.inflation_annual_pct,
      property_appreciation_annual_pct:
        assumptions.property_appreciation_annual_pct ?? 0,
      cash_buffer: assumptions.cash_buffer ?? null,
      fx: assumptions.fx ?? {},
      inflation_note:
        'v1 does not auto-inflate cash_flow lines; inflation is recorded for transparency only.',
    },
    purchaseMonth,
    peakCashNeed,
  };
}

/** Sum property values in reporting ccy. */
export function sumPropertiesReporting(
  properties: PropertyAsset[],
  reportingCurrency: string,
  fx: Record<string, number> | undefined,
): number {
  let s = 0;
  for (const p of properties) {
    s += toReporting(p.value, p.currency, reportingCurrency, fx, `property ${p.id}`);
  }
  return s;
}

export function sumLiabilitiesReporting(
  liabilities: Liability[],
  reportingCurrency: string,
  fx: Record<string, number> | undefined,
): number {
  let s = 0;
  for (const L of liabilities) {
    s += toReporting(L.principal, L.currency, reportingCurrency, fx, `liability ${L.id}`);
  }
  return s;
}
