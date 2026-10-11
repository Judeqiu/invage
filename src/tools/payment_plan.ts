/**
 * build_payment_plan — single-config paydown plan.
 * optimize_payment_plan — exhaustive combination search for min HARD cost.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  getCashFlows,
  getLiabilities,
  getTreasury,
  type CashFlowLine,
  type HouseholdInvestorState,
} from '../state/household-state.js';
import { getCashes, getDeposits, type InvestorState } from '../state/portfolio-state.js';
import {
  buildPaymentPlan,
  optimizePaymentPlan,
  type OptimizePaymentPlanResult,
  type PaydownStrategy,
  type PaymentPlanBaseInput,
} from '../treasury/payment-plan.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthlyAmount(line: CashFlowLine): number {
  if (line.frequency === 'monthly') return line.amount;
  if (line.frequency === 'annual') return line.amount / 12;
  throw new Error(`Unsupported cash_flow frequency: ${String(line.frequency)}`);
}

function activeOn(line: CashFlowLine, asOf: string): boolean {
  if (line.start_date > asOf) return false;
  if (line.end_date != null && line.end_date < asOf) return false;
  return true;
}

type BooksPlanContext = {
  asOf: string;
  currency: string;
  base: PaymentPlanBaseInput;
};

/**
 * Load liabilities, cash, deposits, cash-flows into PaymentPlanBaseInput.
 * Fail-fast on mixed currency / missing reporting currency.
 */
async function loadPaymentPlanBaseFromBooks(
  ids: ChannelIds & { as_of?: string; currency?: string },
): Promise<BooksPlanContext | AgentToolResult<null>> {
  const { state: investor } = await resolveInvestorFromChannel(ids);
  const hh = investor as HouseholdInvestorState;
  const asOf = ids.as_of?.trim() || todayYmd();
  const treasury = hh.treasury != null ? getTreasury(hh) : null;
  const currencyRaw = ids.currency?.trim() || treasury?.reporting_currency;
  if (!currencyRaw) {
    return fail(
      'Plan currency unknown. set_treasury reporting_currency or pass currency= on this tool.',
    );
  }
  const currency = currencyRaw.toUpperCase();
  const liabilities = getLiabilities(hh).filter((L) => L.principal > 0);
  const cashes = getCashes(investor);
  const deposits = getDeposits(investor);
  const cfs = getCashFlows(hh).filter((c) => activeOn(c, asOf));

  let monthlyIncome = 0;
  let monthlyExpense = 0;
  for (const line of cfs) {
    if (line.currency.toUpperCase() !== currency) {
      return fail(
        `cash_flow ${line.id} currency ${line.currency} ≠ plan ${currency}. ` +
          `Normalize flows to reporting currency or exclude — no silent FX.`,
      );
    }
    const m = monthlyAmount(line);
    if (line.kind === 'income') monthlyIncome += m;
    else if (line.kind === 'expense') monthlyExpense += m;
    else {
      return fail(`cash_flow ${line.id}: unknown kind ${String(line.kind)}`);
    }
  }

  const base: PaymentPlanBaseInput = {
    asOf,
    currency,
    liabilities: liabilities.map((L) => ({
      id: L.id,
      kind: L.kind,
      principal: L.principal,
      annual_rate_pct: L.annual_rate_pct,
      payment_amount: L.payment_amount,
      currency: L.currency,
      label: L.label,
    })),
    freeCash: cashes.map((c) => ({
      amount: c.amount,
      currency: c.currency,
      channel: c.channel,
    })),
    deposits: deposits.map((d) => ({
      id: d.id,
      amount: d.amount,
      interest: d.interest,
      currency: d.currency,
      start_date: d.start_date,
      end_date: d.end_date,
      label: d.label,
      channel: d.channel,
    })),
    monthlyIncome,
    monthlyExpense,
  };
  return { asOf, currency, base };
}

function isFailResult(x: BooksPlanContext | AgentToolResult<null>): x is AgentToolResult<null> {
  return 'content' in x && 'details' in x && !('base' in x);
}

function formatPlanText(plan: ReturnType<typeof buildPaymentPlan>): string {
  const lines: string[] = [];
  lines.push(`── PAYMENT PLAN (${plan.strategy.toUpperCase()}) ──`);
  lines.push(`As of: ${plan.as_of} | Currency: ${plan.currency}`);
  lines.push(
    `Income/mo: ${plan.monthly_income.toFixed(2)} | Expense/mo: ${plan.monthly_expense.toFixed(2)} | Net CF: ${plan.monthly_net_cash_flow.toFixed(2)}`,
  );
  lines.push(
    `Minimums/mo: ${plan.monthly_minimum_total.toFixed(2)} | Surplus→debt/mo: ${plan.monthly_surplus_for_debt.toFixed(2)}`,
  );
  lines.push(
    `Free cash: ${plan.free_cash_total.toFixed(2)} | Emergency reserve: ${plan.emergency_reserve.toFixed(2)} | Deployable now: ${plan.deployable_cash_now.toFixed(2)}`,
  );
  lines.push('');
  lines.push('── LIABILITY ORDER ──');
  if (plan.liability_order.length === 0) lines.push('  (none)');
  for (const L of plan.liability_order) {
    lines.push(
      `  ${L.id}${L.label ? ` "${L.label}"` : ''}: principal ${L.principal.toFixed(2)} @ ${L.annual_rate_pct}% | min ${L.payment_amount.toFixed(2)} — ${L.rankReason}`,
    );
  }
  lines.push('');
  lines.push('── FUNDING WATERFALL ──');
  for (const w of plan.funding_waterfall) lines.push(`  ${w}`);
  lines.push('');
  lines.push('── DEPOSIT GUIDANCE ──');
  if (plan.deposit_guidance.length === 0) lines.push('  (none)');
  for (const d of plan.deposit_guidance) {
    const y = d.implied_annual_pct != null ? `~${d.implied_annual_pct.toFixed(2)}% ann.` : 'yield n/a';
    lines.push(
      `  ${d.id}${d.label ? ` "${d.label}"` : ''}: ${d.amount.toFixed(2)} ${d.currency} | end ${d.end_date} (${d.days_to_maturity}d) | ${y} | ${d.action}`,
    );
    lines.push(`    ${d.detail}`);
  }
  lines.push('');
  lines.push('── SUMMARY ──');
  lines.push(
    plan.summary.debt_free
      ? `Debt-free in ${plan.summary.months_to_debt_free ?? 0} month(s).`
      : `Not debt-free within horizon. months_to_debt_free=${String(plan.summary.months_to_debt_free)}`,
  );
  lines.push(
    `Total paid (sim): ${plan.summary.total_paid.toFixed(2)} | Interest (sim): ${plan.summary.total_interest.toFixed(2)}`,
  );
  for (const n of plan.summary.notes) lines.push(`• ${n}`);
  lines.push('');
  lines.push('── SCHEDULE (first 12 rows; full in details) ──');
  for (const row of plan.schedule.slice(0, 12)) {
    const parts = row.allocations
      .map((a) => `${a.liability_id}=${a.payment.toFixed(2)}(i${a.interest.toFixed(2)})→${a.principal_after.toFixed(2)}`)
      .join('; ');
    lines.push(
      `  m${row.month} ${row.as_of}: paid ${row.total_paid.toFixed(2)} | rem ${row.remaining_debt.toFixed(2)}` +
        (row.deposit_unlocks.length ? ` | unlock ${row.deposit_unlocks.join(',')}` : '') +
        (parts ? ` | ${parts}` : ''),
    );
  }
  if (plan.schedule.length > 12) {
    lines.push(`  … ${plan.schedule.length - 12} more month(s) in details.schedule`);
  }
  return lines.join('\n');
}

export function createPaymentPlanTool(): AgentTool {
  return {
    name: 'build_payment_plan',
    label: 'Build Payment Plan',
    description:
      'Build one deterministic debt paydown + cash/deposit funding plan from household books. ' +
      'Strategies: avalanche (highest APR first — default, minimizes interest) or snowball (smallest balance first). ' +
      'Uses free cash (with optional emergency months reserve), contractual liability minimums, cash_flow surplus, ' +
      'and fixed-deposit maturities (never invents early-break penalties). ' +
      'Does not sell investments. For best-of-N search across strategies/reserves/extra payments, prefer optimize_payment_plan. ' +
      'Call get_household / get_portfolio first when books may be stale. ' +
      'Fail-fast if liability/cash currencies mix without a single plan currency.',
    parameters: Type.Object({
      ...channelIdParams,
      strategy: Type.Optional(
        Type.Union([Type.Literal('avalanche'), Type.Literal('snowball')], {
          description: 'avalanche (default) saves interest; snowball prioritizes small balances',
        }),
      ),
      as_of: Type.Optional(Type.String({ description: 'YYYY-MM-DD; default today UTC' })),
      currency: Type.Optional(
        Type.String({
          description:
            'Plan currency. Default: treasury.reporting_currency. All included liabilities/cash must match.',
        }),
      ),
      preserve_emergency_months: Type.Optional(
        Type.Number({
          description:
            'Keep N months of expenses as untouchable free cash (e.g. 3). Omit = no reserve in plan.',
        }),
      ),
      extra_monthly: Type.Optional(
        Type.Number({
          description:
            'Override monthly surplus applied to debt after minimums. When omitted, uses income−expense−minimums from books.',
        }),
      ),
      max_months: Type.Optional(
        Type.Number({ description: 'Simulation cap (default 360). Integer ≥ 1.' }),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
      try {
        const ids = params as ChannelIds & {
          strategy?: PaydownStrategy;
          as_of?: string;
          currency?: string;
          preserve_emergency_months?: number;
          extra_monthly?: number;
          max_months?: number;
        };
        const loaded = await loadPaymentPlanBaseFromBooks(ids);
        if (isFailResult(loaded)) return loaded;
        const plan = buildPaymentPlan({
          ...loaded.base,
          strategy: ids.strategy ?? 'avalanche',
          preserveEmergencyMonths: ids.preserve_emergency_months,
          extraMonthly: ids.extra_monthly,
          maxMonths: ids.max_months,
        });
        return ok(formatPlanText(plan), plan);
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}

function formatOptimizeText(result: OptimizePaymentPlanResult): string {
  const lines: string[] = [];
  lines.push('── OPTIMIZE PAYMENT PLAN (HARD cost search) ──');
  lines.push(`As of: ${result.as_of} | Currency: ${result.currency}`);
  lines.push(`Objective: ${result.objective}`);
  lines.push(`Candidates evaluated: ${result.candidates_evaluated}`);
  lines.push(
    `Interest saved vs worst: ${result.interest_saved_vs_worst.toFixed(2)} ${result.currency}` +
      (result.interest_saved_vs_second != null
        ? ` | vs #2: ${result.interest_saved_vs_second.toFixed(2)}`
        : ''),
  );
  lines.push('');
  lines.push('── RANKING (best → worst) ──');
  for (const c of result.ranking) {
    const m =
      c.summary.months_to_debt_free != null
        ? `${c.summary.months_to_debt_free} mo`
        : 'not free in horizon';
    lines.push(
      `  #${c.rank} ${c.label}: interest ${c.summary.total_interest.toFixed(2)} | paid ${c.summary.total_paid.toFixed(2)} | ${m}` +
        (c.interest_vs_best > 0 ? ` | +${c.interest_vs_best.toFixed(2)} interest vs best` : ' | BEST'),
    );
    lines.push(
      `      deployable_now=${c.deployable_cash_now.toFixed(2)} reserve=${c.emergency_reserve.toFixed(2)} surplus/mo=${c.monthly_surplus_for_debt.toFixed(2)}`,
    );
  }
  lines.push('');
  lines.push('── NOTES ──');
  for (const n of result.comparison_notes) lines.push(`• ${n}`);
  lines.push('');
  lines.push('── BEST FULL PLAN ──');
  lines.push(formatPlanText(result.best_plan));
  return lines.join('\n');
}

/**
 * Default search axes when the caller does not pin them.
 * Explicit lists on the tool override these; empty is fail-fast (no silent empty product).
 */
const DEFAULT_OPTIMIZE_STRATEGIES: PaydownStrategy[] = ['avalanche', 'snowball'];
/** none + 3mo + 6mo — common reserve scenarios, labeled not silent defaults for a single plan. */
const DEFAULT_EMERGENCY_MONTHS: Array<number | undefined> = [undefined, 3, 6];
/** books-derived surplus only unless caller expands extra_monthly_candidates. */
const DEFAULT_EXTRA_MONTHLIES: Array<number | undefined> = [undefined];

export function createOptimizePaymentPlanTool(): AgentTool {
  return {
    name: 'optimize_payment_plan',
    label: 'Optimize Payment Plan',
    description:
      'Search multiple payment-plan combinations from household books and rank by lowest HARD interest ' +
      '(then fastest debt-free, then lower total paid). Cartesian product of strategies × emergency-reserve months × ' +
      'extra monthly amounts. Default axes: strategies=avalanche+snowball, emergency=none/3/6 months, ' +
      'extra=books surplus — override any axis with explicit arrays. Returns ranked table + full best plan schedule. ' +
      'Does NOT invent yields or mix SOFT opportunity cost into ranking (use estimate_opportunity_cost separately). ' +
      'Does not sell investments or break FDs early. Prefer this over a single build_payment_plan when the goal is ' +
      'minimize payment cost / max financial gain. Fail-fast on mixed currency or empty search axes.',
    parameters: Type.Object({
      ...channelIdParams,
      as_of: Type.Optional(Type.String({ description: 'YYYY-MM-DD; default today UTC' })),
      currency: Type.Optional(
        Type.String({
          description:
            'Plan currency. Default: treasury.reporting_currency. All included liabilities/cash must match.',
        }),
      ),
      strategies: Type.Optional(
        Type.Array(Type.Union([Type.Literal('avalanche'), Type.Literal('snowball')]), {
          description:
            'Strategies to try. Default: both avalanche and snowball. Must be non-empty when provided.',
        }),
      ),
      emergency_months_candidates: Type.Optional(
        Type.Array(Type.Number(), {
          description:
            'Emergency reserve months to try (e.g. [0,3,6]). 0 = no reserve. ' +
            'Default when omitted: none + 3 + 6 months as labeled scenarios. Must be non-empty when provided.',
        }),
      ),
      extra_monthly_candidates: Type.Optional(
        Type.Array(Type.Number(), {
          description:
            'Extra monthly paydown amounts to try after minimums (e.g. [500,1000,2000]). ' +
            'Default when omitted: single candidate using books income−expense−minimums. ' +
            'Must be non-empty when provided. Do not invent amounts the user cannot fund.',
        }),
      ),
      max_months: Type.Optional(
        Type.Number({ description: 'Simulation cap per candidate (default 360). Integer ≥ 1.' }),
      ),
    }),
    execute: async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
      try {
        const ids = params as ChannelIds & {
          as_of?: string;
          currency?: string;
          strategies?: PaydownStrategy[];
          emergency_months_candidates?: number[];
          extra_monthly_candidates?: number[];
          max_months?: number;
        };
        const loaded = await loadPaymentPlanBaseFromBooks(ids);
        if (isFailResult(loaded)) return loaded;

        let strategies: PaydownStrategy[];
        if (ids.strategies != null) {
          if (!Array.isArray(ids.strategies) || ids.strategies.length === 0) {
            return fail(
              'strategies must be a non-empty array when provided (avalanche and/or snowball).',
            );
          }
          strategies = ids.strategies;
        } else {
          strategies = [...DEFAULT_OPTIMIZE_STRATEGIES];
        }

        let emergencyMonths: Array<number | undefined>;
        if (ids.emergency_months_candidates != null) {
          if (
            !Array.isArray(ids.emergency_months_candidates) ||
            ids.emergency_months_candidates.length === 0
          ) {
            return fail(
              'emergency_months_candidates must be a non-empty array when provided (use 0 for no reserve).',
            );
          }
          emergencyMonths = ids.emergency_months_candidates.map((n) => {
            if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
              throw new Error(
                'Each emergency_months_candidates entry must be a finite number ≥ 0 (0 = no reserve).',
              );
            }
            return n === 0 ? undefined : n;
          });
        } else {
          emergencyMonths = [...DEFAULT_EMERGENCY_MONTHS];
        }

        let extraMonthlies: Array<number | undefined>;
        if (ids.extra_monthly_candidates != null) {
          if (
            !Array.isArray(ids.extra_monthly_candidates) ||
            ids.extra_monthly_candidates.length === 0
          ) {
            return fail(
              'extra_monthly_candidates must be a non-empty array when provided (positive surplus amounts).',
            );
          }
          for (const n of ids.extra_monthly_candidates) {
            if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
              return fail(
                'Each extra_monthly_candidates entry must be a finite number ≥ 0.',
              );
            }
          }
          extraMonthlies = ids.extra_monthly_candidates;
        } else {
          extraMonthlies = [...DEFAULT_EXTRA_MONTHLIES];
        }

        // Cap cartesian size to keep tool responses bounded (fail-fast if too large)
        const product = strategies.length * emergencyMonths.length * extraMonthlies.length;
        const MAX_CANDIDATES = 48;
        if (product > MAX_CANDIDATES) {
          return fail(
            `Search space has ${product} candidates (max ${MAX_CANDIDATES}). ` +
              `Narrow strategies, emergency_months_candidates, or extra_monthly_candidates.`,
          );
        }

        const result = optimizePaymentPlan(loaded.base, {
          strategies,
          emergencyMonths,
          extraMonthlies,
          maxMonths: ids.max_months,
        });

        return ok(formatOptimizeText(result), result);
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
