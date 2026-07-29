/**
 * Household treasury CRUD tools + get_household.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import {
  getCashFlows,
  getLiabilities,
  getProjectionAssumptions,
  getProperties,
  getScenarios,
  getTreasury,
  householdGaps,
  removeCashFlow,
  removeLiability,
  removeProperty,
  setProjectionAssumptions,
  setTreasury,
  upsertCashFlow,
  upsertLiability,
  upsertProperty,
  generateHouseholdId,
  type CashFlowLine,
  type HouseholdInvestorState,
  type Liability,
  type ProjectionAssumptions,
  type PropertyAsset,
} from '../state/household-state.js';
import {
  getCashes,
  getDeposits,
  getPortfolio,
  type InvestorState,
} from '../state/portfolio-state.js';
import { cashDeployedForHolding } from '../state/portfolio-state.js';
import { annuityPayment } from '../treasury/amortize.js';
import {
  sumLiabilitiesReporting,
  sumPropertiesReporting,
  toReporting,
} from '../treasury/project.js';
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

function asHousehold(state: InvestorState): HouseholdInvestorState {
  return state as HouseholdInvestorState;
}

/** Portfolio book value = sum cost basis (equity/fund/option premium deployed). */
export function portfolioCostBasis(state: InvestorState): number {
  const portfolio = getPortfolio(state);
  let sum = 0;
  for (const [key, h] of Object.entries(portfolio)) {
    try {
      // Use absolute capital at cost (long premium / equity cost; short uses negative deployed)
      const d = cashDeployedForHolding(h);
      sum += Math.abs(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Cannot value holding ${key} for household: ${msg}`);
    }
  }
  return sum;
}

function formatHouseholdSummary(state: HouseholdInvestorState): string {
  const lines: string[] = ['── HOUSEHOLD BOOKS ──'];
  const treasury = getTreasury(state);
  const assumptions = getProjectionAssumptions(state);
  const props = getProperties(state);
  const liabilities = getLiabilities(state);
  const cfs = getCashFlows(state);
  const scenarios = getScenarios(state);
  const cashes = getCashes(state);
  const deposits = getDeposits(state);
  const portCost = portfolioCostBasis(state);
  const gaps = householdGaps(state);
  const fx = assumptions?.fx;
  const rep = treasury?.reporting_currency;

  lines.push(
    treasury
      ? `Reporting currency: ${treasury.reporting_currency} (updated ${treasury.updated_at})`
      : 'Reporting currency: NOT SET (set_treasury)',
  );

  if (cashes.length === 0) {
    lines.push('Free cash: not recorded');
  } else if (cashes.length === 1) {
    const cash = cashes[0];
    lines.push(
      `Free cash: ${cash.amount.toFixed(2)} ${cash.currency}` +
        (cash.channel ? ` [${cash.channel}]` : ''),
    );
  } else {
    lines.push('Free cash by channel:');
    for (const c of cashes) {
      lines.push(
        `  ${c.channel ?? '(unassigned)'}: ${c.amount.toFixed(2)} ${c.currency}`,
      );
    }
  }
  lines.push(`Portfolio (cost basis): ${portCost.toFixed(2)} (pass portfolio_value for live MTM in projections)`);
  if (deposits.length === 1) {
    lines.push(
      `Deposits principal: ${deposits[0].amount.toFixed(2)} ${deposits[0].currency}`,
    );
  } else if (deposits.length > 1) {
    lines.push('Deposits:');
    for (const d of deposits) {
      lines.push(`  ${d.id}: ${d.amount.toFixed(2)} ${d.currency}`);
    }
  }

  lines.push('', '── PROPERTIES ──');
  if (props.length === 0) lines.push('  None');
  for (const p of props) {
    lines.push(
      `  ${p.id}${p.label ? ` "${p.label}"` : ''}: ${p.value.toFixed(2)} ${p.currency}` +
        (p.mortgage_id ? ` | mortgage=${p.mortgage_id}` : ''),
    );
  }

  lines.push('', '── LIABILITIES ──');
  if (liabilities.length === 0) lines.push('  None');
  for (const L of liabilities) {
    lines.push(
      `  ${L.id} [${L.kind}] principal ${L.principal.toFixed(2)} ${L.currency} @ ${L.annual_rate_pct}%` +
        ` | pay ${L.payment_amount.toFixed(2)}/${L.payment_frequency}` +
        (L.property_id ? ` | property=${L.property_id}` : '') +
        (L.label ? ` | ${L.label}` : ''),
    );
  }

  lines.push('', '── CASH FLOWS ──');
  if (cfs.length === 0) lines.push('  None');
  for (const c of cfs) {
    lines.push(
      `  ${c.id} [${c.kind}] ${c.amount.toFixed(2)} ${c.currency}/${c.frequency}` +
        ` from ${c.start_date}${c.end_date ? ` to ${c.end_date}` : ''}` +
        (c.label ? ` | ${c.label}` : ''),
    );
  }

  lines.push('', '── ASSUMPTIONS ──');
  if (assumptions == null) {
    lines.push('  Not set — required before run_projection');
  } else {
    lines.push(
      `  portfolio return ${assumptions.portfolio_return_annual_pct}%/yr | inflation ${assumptions.inflation_annual_pct}%/yr` +
        ` | property growth ${assumptions.property_appreciation_annual_pct ?? 0}%/yr`,
    );
    if (assumptions.fx && Object.keys(assumptions.fx).length > 0) {
      lines.push(
        `  FX → reporting: ${Object.entries(assumptions.fx)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
      );
    } else {
      lines.push('  FX: none stored');
    }
    if (assumptions.cash_buffer != null) {
      lines.push(`  cash_buffer: ${assumptions.cash_buffer}`);
    }
  }

  lines.push('', `Saved scenarios: ${scenarios.length}`);
  for (const s of scenarios) {
    lines.push(`  ${s.id}: ${s.label} (${s.events.length} event(s))`);
  }

  // Net worth if reporting set and FX available for every foreign ccy
  if (treasury != null && rep != null) {
    try {
      let free = 0;
      for (const c of cashes) {
        free += toReporting(
          c.amount,
          c.currency,
          rep,
          fx,
          `cash ${c.channel ?? 'unassigned'}`,
        );
      }
      let dep = 0;
      for (const d of deposits) {
        dep += toReporting(d.amount, d.currency, rep, fx, `deposit ${d.id}`);
      }
      const prop = sumPropertiesReporting(props, rep, fx);
      const debt = sumLiabilitiesReporting(liabilities, rep, fx);
      // Portfolio cost assumed same unit as free cash / reporting when no multi-ccy portfolio marks
      const nw = free + portCost + dep + prop - debt;
      lines.push(
        '',
        `Net worth (approx, portfolio at cost): ${nw.toFixed(2)} ${rep}`,
      );
    } catch (e) {
      lines.push(
        '',
        `Net worth: not computed — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (gaps.length > 0) {
    lines.push('', `Gaps: ${gaps.join('; ')}`);
  }
  return lines.join('\n');
}

export function createHouseholdTools(): AgentTool[] {
  const getHousehold: AgentTool = {
    name: 'get_household',
    label: 'Get Household Books',
    description:
      'Household treasury summary: reporting currency, free cash, portfolio cost basis, properties, liabilities, cash-flow lines, projection assumptions, scenarios, gaps. ' +
      'Use before projections or affordability. Pass channel user id from message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const text = formatHouseholdSummary(state);
        return ok(text, {
          treasury: getTreasury(state),
          properties: getProperties(state),
          liabilities: getLiabilities(state),
          cash_flows: getCashFlows(state),
          assumptions: getProjectionAssumptions(state),
          scenarios: getScenarios(state).map((s) => ({
            id: s.id,
            label: s.label,
            events: s.events.length,
          })),
          gaps: householdGaps(state),
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const getTreasuryTool: AgentTool = {
    name: 'get_treasury',
    label: 'Get Treasury Settings',
    description: 'Get household reporting_currency and configuration gaps.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const treasury = getTreasury(state);
        const gaps = householdGaps(state);
        const text = treasury
          ? `Reporting currency: ${treasury.reporting_currency} (updated ${treasury.updated_at})\nGaps: ${gaps.join('; ') || 'none'}`
          : `Treasury not set.\nGaps: ${gaps.join('; ')}`;
        return ok(text, { treasury, gaps });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const setTreasuryTool: AgentTool = {
    name: 'set_treasury',
    label: 'Set Treasury Settings',
    description:
      'Set household reporting_currency (e.g. SGD, USD, HKD). Required before projections. No silent default.',
    parameters: Type.Object({
      ...channelIdParams,
      reporting_currency: Type.String({
        description: '3–4 letter currency code for household totals (e.g. SGD).',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { reporting_currency: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        setTreasury(state, {
          reporting_currency: p.reporting_currency,
          updated_at: today,
        });
        state.log.push({
          ts: today,
          action: 'treasury_set',
          reporting_currency: getTreasury(state)!.reporting_currency,
        });
        saveState(state);
        const t = getTreasury(state)!;
        return ok(
          `Treasury reporting currency set to ${t.reporting_currency}.`,
          { treasury: t },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const addProperty: AgentTool = {
    name: 'add_property',
    label: 'Add Property',
    description:
      'Add or update a real-estate property (manual mark). Optional id; auto-generated if omitted. Link mortgage via add_liability kind=mortgage.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.Optional(Type.String({ description: 'Stable id (auto if omitted).' })),
      value: Type.Number({ description: 'Property mark ≥ 0.' }),
      currency: Type.String({ description: 'Currency of value (required).' }),
      label: Type.Optional(Type.String()),
      mortgage_id: Type.Optional(Type.String()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id?: string;
        value: number;
        currency: string;
        label?: string;
        mortgage_id?: string;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        const id =
          p.id?.trim() ||
          generateHouseholdId('prop', getProperties(state));
        const prop: PropertyAsset = {
          id,
          value: p.value,
          currency: p.currency,
          updated_at: today,
        };
        if (p.label != null) prop.label = p.label;
        if (p.mortgage_id != null) prop.mortgage_id = p.mortgage_id;
        upsertProperty(state, prop);
        state.log.push({ ts: today, action: 'property_upserted', id });
        saveState(state);
        const saved = getProperties(state).find((x) => x.id === id)!;
        return ok(
          `Property ${saved.id}: ${saved.value.toFixed(2)} ${saved.currency}` +
            (saved.label ? ` (${saved.label})` : ''),
          { property: saved },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateProperty: AgentTool = {
    name: 'update_property',
    label: 'Update Property',
    description: 'Patch a property by id (value, currency, label, mortgage_id).',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
      value: Type.Optional(Type.Number()),
      currency: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      mortgage_id: Type.Optional(Type.String()),
      clear_mortgage_id: Type.Optional(
        Type.Boolean({ description: 'If true, remove mortgage_id link.' }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id: string;
        value?: number;
        currency?: string;
        label?: string;
        mortgage_id?: string;
        clear_mortgage_id?: boolean;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const existing = getProperties(state).find((x) => x.id === p.id);
        if (existing == null) return fail(`Property id "${p.id}" not found.`);
        const today = todayYmd();
        const next: PropertyAsset = {
          ...existing,
          value: p.value ?? existing.value,
          currency: p.currency ?? existing.currency,
          updated_at: today,
        };
        if (p.label != null) next.label = p.label;
        if (p.clear_mortgage_id) delete next.mortgage_id;
        else if (p.mortgage_id != null) next.mortgage_id = p.mortgage_id;
        upsertProperty(state, next);
        state.log.push({ ts: today, action: 'property_updated', id: p.id });
        saveState(state);
        return ok(`Property ${p.id} updated.`, { property: next });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removePropertyTool: AgentTool = {
    name: 'remove_property',
    label: 'Remove Property',
    description: 'Remove property by id. Fails if a mortgage still references it.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const removed = removeProperty(state, p.id);
        const today = todayYmd();
        state.log.push({ ts: today, action: 'property_removed', id: p.id });
        saveState(state);
        return ok(`Removed property ${removed.id}.`, { property: removed });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const addLiability: AgentTool = {
    name: 'add_liability',
    label: 'Add Liability',
    description:
      'Add or update amortizing liability (mortgage|loan). Mortgage requires property_id. ' +
      'If payment_amount omitted, computes standard monthly annuity payment. ' +
      'If payment_amount provided, must match annuity within tolerance (fail-fast).',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.Optional(Type.String()),
      kind: Type.Union([Type.Literal('mortgage'), Type.Literal('loan')]),
      principal: Type.Number(),
      annual_rate_pct: Type.Number(),
      currency: Type.String(),
      start_date: Type.String({ description: 'YYYY-MM-DD' }),
      term_months: Type.Number(),
      payment_amount: Type.Optional(
        Type.Number({
          description: 'Monthly payment; computed from principal/rate/term if omitted.',
        }),
      ),
      property_id: Type.Optional(
        Type.String({ description: 'Required when kind=mortgage.' }),
      ),
      label: Type.Optional(Type.String()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id?: string;
        kind: 'mortgage' | 'loan';
        principal: number;
        annual_rate_pct: number;
        currency: string;
        start_date: string;
        term_months: number;
        payment_amount?: number;
        property_id?: string;
        label?: string;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        const id =
          p.id?.trim() ||
          generateHouseholdId(p.kind === 'mortgage' ? 'mortgage' : 'loan', getLiabilities(state));
        const payment =
          p.payment_amount ??
          annuityPayment(p.principal, p.annual_rate_pct, p.term_months);
        const L: Liability = {
          id,
          kind: p.kind,
          principal: p.principal,
          annual_rate_pct: p.annual_rate_pct,
          currency: p.currency,
          start_date: p.start_date,
          term_months: p.term_months,
          payment_amount: payment,
          payment_frequency: 'monthly',
          updated_at: today,
        };
        if (p.property_id != null) L.property_id = p.property_id;
        if (p.label != null) L.label = p.label;
        upsertLiability(state, L);
        state.log.push({ ts: today, action: 'liability_upserted', id });
        saveState(state);
        const saved = getLiabilities(state).find((x) => x.id === id)!;
        return ok(
          `Liability ${saved.id} [${saved.kind}]: principal ${saved.principal.toFixed(2)} ${saved.currency}, ` +
            `payment ${saved.payment_amount.toFixed(2)}/mo @ ${saved.annual_rate_pct}%`,
          { liability: saved },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateLiability: AgentTool = {
    name: 'update_liability',
    label: 'Update Liability',
    description: 'Patch liability by id. Re-validates payment vs annuity when principal/rate/term/payment change.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
      principal: Type.Optional(Type.Number()),
      annual_rate_pct: Type.Optional(Type.Number()),
      currency: Type.Optional(Type.String()),
      start_date: Type.Optional(Type.String()),
      term_months: Type.Optional(Type.Number()),
      payment_amount: Type.Optional(Type.Number()),
      recompute_payment: Type.Optional(
        Type.Boolean({
          description: 'If true, recompute payment from principal/rate/term.',
        }),
      ),
      property_id: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id: string;
        principal?: number;
        annual_rate_pct?: number;
        currency?: string;
        start_date?: string;
        term_months?: number;
        payment_amount?: number;
        recompute_payment?: boolean;
        property_id?: string;
        label?: string;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const existing = getLiabilities(state).find((x) => x.id === p.id);
        if (existing == null) return fail(`Liability id "${p.id}" not found.`);
        const today = todayYmd();
        const principal = p.principal ?? existing.principal;
        const annual_rate_pct = p.annual_rate_pct ?? existing.annual_rate_pct;
        const term_months = p.term_months ?? existing.term_months;
        let payment_amount = p.payment_amount ?? existing.payment_amount;
        if (p.recompute_payment) {
          payment_amount = annuityPayment(principal, annual_rate_pct, term_months);
        }
        const next: Liability = {
          ...existing,
          principal,
          annual_rate_pct,
          currency: p.currency ?? existing.currency,
          start_date: p.start_date ?? existing.start_date,
          term_months,
          payment_amount,
          updated_at: today,
        };
        if (p.property_id != null) next.property_id = p.property_id;
        if (p.label != null) next.label = p.label;
        upsertLiability(state, next);
        state.log.push({ ts: today, action: 'liability_updated', id: p.id });
        saveState(state);
        return ok(`Liability ${p.id} updated.`, { liability: next });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removeLiabilityTool: AgentTool = {
    name: 'remove_liability',
    label: 'Remove Liability',
    description: 'Remove liability by id.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const removed = removeLiability(state, p.id);
        const today = todayYmd();
        state.log.push({ ts: today, action: 'liability_removed', id: p.id });
        saveState(state);
        return ok(`Removed liability ${removed.id}.`, { liability: removed });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const addCashFlow: AgentTool = {
    name: 'add_cash_flow',
    label: 'Add Cash Flow Line',
    description:
      'Add or update a recurring income or expense line (amount, currency, frequency monthly|annual, start/end dates).',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.Optional(Type.String()),
      kind: Type.Union([Type.Literal('income'), Type.Literal('expense')]),
      amount: Type.Number(),
      currency: Type.String(),
      frequency: Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
      start_date: Type.String(),
      end_date: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id?: string;
        kind: 'income' | 'expense';
        amount: number;
        currency: string;
        frequency: 'monthly' | 'annual';
        start_date: string;
        end_date?: string;
        label?: string;
        category?: string;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        const id =
          p.id?.trim() ||
          generateHouseholdId(p.kind === 'income' ? 'cf-income' : 'cf-expense', getCashFlows(state));
        const line: CashFlowLine = {
          id,
          kind: p.kind,
          amount: p.amount,
          currency: p.currency,
          frequency: p.frequency,
          start_date: p.start_date,
          updated_at: today,
        };
        if (p.end_date != null) line.end_date = p.end_date;
        if (p.label != null) line.label = p.label;
        if (p.category != null) line.category = p.category;
        upsertCashFlow(state, line);
        state.log.push({ ts: today, action: 'cash_flow_upserted', id });
        saveState(state);
        const saved = getCashFlows(state).find((x) => x.id === id)!;
        return ok(
          `Cash flow ${saved.id} [${saved.kind}]: ${saved.amount.toFixed(2)} ${saved.currency}/${saved.frequency}`,
          { cash_flow: saved },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateCashFlow: AgentTool = {
    name: 'update_cash_flow',
    label: 'Update Cash Flow Line',
    description: 'Patch cash flow line by id.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
      kind: Type.Optional(Type.Union([Type.Literal('income'), Type.Literal('expense')])),
      amount: Type.Optional(Type.Number()),
      currency: Type.Optional(Type.String()),
      frequency: Type.Optional(
        Type.Union([Type.Literal('monthly'), Type.Literal('annual')]),
      ),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      clear_end_date: Type.Optional(Type.Boolean()),
      label: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id: string;
        kind?: 'income' | 'expense';
        amount?: number;
        currency?: string;
        frequency?: 'monthly' | 'annual';
        start_date?: string;
        end_date?: string;
        clear_end_date?: boolean;
        label?: string;
        category?: string;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const existing = getCashFlows(state).find((x) => x.id === p.id);
        if (existing == null) return fail(`Cash flow id "${p.id}" not found.`);
        const today = todayYmd();
        const next: CashFlowLine = {
          ...existing,
          kind: p.kind ?? existing.kind,
          amount: p.amount ?? existing.amount,
          currency: p.currency ?? existing.currency,
          frequency: p.frequency ?? existing.frequency,
          start_date: p.start_date ?? existing.start_date,
          updated_at: today,
        };
        if (p.clear_end_date) delete next.end_date;
        else if (p.end_date != null) next.end_date = p.end_date;
        if (p.label != null) next.label = p.label;
        if (p.category != null) next.category = p.category;
        upsertCashFlow(state, next);
        state.log.push({ ts: today, action: 'cash_flow_updated', id: p.id });
        saveState(state);
        return ok(`Cash flow ${p.id} updated.`, { cash_flow: next });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removeCashFlowTool: AgentTool = {
    name: 'remove_cash_flow',
    label: 'Remove Cash Flow Line',
    description: 'Remove cash flow line by id.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const removed = removeCashFlow(state, p.id);
        const today = todayYmd();
        state.log.push({ ts: today, action: 'cash_flow_removed', id: p.id });
        saveState(state);
        return ok(`Removed cash flow ${removed.id}.`, { cash_flow: removed });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const listCashFlows: AgentTool = {
    name: 'list_cash_flows',
    label: 'List Cash Flow Lines',
    description: 'List all recurring income and expense lines.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const lines = getCashFlows(state);
        if (lines.length === 0) {
          return ok('No cash flow lines.', { cash_flows: [] });
        }
        const text = lines
          .map(
            (c) =>
              `${c.id} [${c.kind}] ${c.amount.toFixed(2)} ${c.currency}/${c.frequency} ` +
              `${c.start_date}${c.end_date ? '→' + c.end_date : ''}` +
              (c.label ? ` ${c.label}` : ''),
          )
          .join('\n');
        return ok(text, { cash_flows: lines });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const getAssumptions: AgentTool = {
    name: 'get_projection_assumptions',
    label: 'Get Projection Assumptions',
    description:
      'Get portfolio return, inflation, property appreciation, FX map, cash_buffer used by run_projection.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const a = getProjectionAssumptions(state);
        if (a == null) {
          return ok(
            'projection_assumptions not set. Use set_projection_assumptions (required fields: portfolio_return_annual_pct, inflation_annual_pct).',
            { assumptions: null },
          );
        }
        return ok(JSON.stringify(a, null, 2), { assumptions: a });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const setAssumptions: AgentTool = {
    name: 'set_projection_assumptions',
    label: 'Set Projection Assumptions',
    description:
      'Set required portfolio_return_annual_pct and inflation_annual_pct. Optional property_appreciation_annual_pct, fx map (foreign→reporting), cash_buffer. No silent defaults.',
    parameters: Type.Object({
      ...channelIdParams,
      portfolio_return_annual_pct: Type.Number({
        description: 'Expected annual portfolio return percent (e.g. 5 for 5%).',
      }),
      inflation_annual_pct: Type.Number({
        description: 'Annual inflation percent (recorded; v1 does not auto-inflate CF lines).',
      }),
      property_appreciation_annual_pct: Type.Optional(Type.Number()),
      cash_buffer: Type.Optional(
        Type.Number({ description: 'Min free-cash buffer for TIGHT verdict (reporting ccy).' }),
      ),
      fx: Type.Optional(
        Type.Record(Type.String(), Type.Number(), {
          description:
            'Map of foreign currency → units of reporting currency per 1 foreign (e.g. {"USD": 1.35} if reporting=SGD).',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        portfolio_return_annual_pct: number;
        inflation_annual_pct: number;
        property_appreciation_annual_pct?: number;
        cash_buffer?: number;
        fx?: Record<string, number>;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        const a: ProjectionAssumptions = {
          portfolio_return_annual_pct: p.portfolio_return_annual_pct,
          inflation_annual_pct: p.inflation_annual_pct,
          updated_at: today,
        };
        if (p.property_appreciation_annual_pct != null) {
          a.property_appreciation_annual_pct = p.property_appreciation_annual_pct;
        }
        if (p.cash_buffer != null) a.cash_buffer = p.cash_buffer;
        if (p.fx != null) a.fx = p.fx;
        setProjectionAssumptions(state, a);
        state.log.push({ ts: today, action: 'projection_assumptions_set' });
        saveState(state);
        const saved = getProjectionAssumptions(state)!;
        return ok(
          `Assumptions set: portfolio ${saved.portfolio_return_annual_pct}%/yr, inflation ${saved.inflation_annual_pct}%/yr.`,
          { assumptions: saved },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [
    getHousehold,
    getTreasuryTool,
    setTreasuryTool,
    addProperty,
    updateProperty,
    removePropertyTool,
    addLiability,
    updateLiability,
    removeLiabilityTool,
    addCashFlow,
    updateCashFlow,
    removeCashFlowTool,
    listCashFlows,
    getAssumptions,
    setAssumptions,
  ];
}
