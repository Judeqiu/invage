/**
 * build_payment_plan — deterministic paydown + cash/deposit funding plan.
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
  type PaydownStrategy,
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
      'Build a deterministic debt paydown + cash/deposit funding plan from household books. ' +
      'Strategies: avalanche (highest APR first — default, minimizes interest) or snowball (smallest balance first). ' +
      'Uses free cash (with optional emergency months reserve), contractual liability minimums, cash_flow surplus, ' +
      'and fixed-deposit maturities (never invents early-break penalties). ' +
      'Does not sell investments. Call get_household / get_portfolio first when books may be stale. ' +
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
        const investor = resolveInvestorFromChannel(ids) as InvestorState;
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

        const plan = buildPaymentPlan({
          asOf,
          strategy: ids.strategy ?? 'avalanche',
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
