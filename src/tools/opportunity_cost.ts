/**
 * estimate_opportunity_cost — deterministic SOFT opportunity cost.
 * Never invents yield; books or explicit yield_pct required.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { isFundHolding, resolveLookupHoldingKey } from '../market/position-value.js';
import {
  estimateOpportunityCost,
  impliedDepositAnnualPct,
} from '../treasury/opportunity-cost.js';
import { getDeposits, getPortfolio } from '../state/portfolio-state.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';
import { prepareNumericToolArgs } from './coerce-tool-numbers.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

export function createOpportunityCostTool(): AgentTool {
  return {
    name: 'estimate_opportunity_cost',
    label: 'Estimate Opportunity Cost',
    description:
      'Compute a **SOFT** (assumption-labeled) opportunity cost: capital × yield% × years. ' +
      'Never invents yield. Provide ONE yield source: ' +
      '(1) explicit yield_pct from user this turn, or ' +
      '(2) holding_key of a fund with fund.expected_yield_pct on books, or ' +
      '(3) deposit_id (implied annual % from full-term interest/principal/term). ' +
      'years is REQUIRED (horizon). currency is REQUIRED. ' +
      'capital required unless deposit_id (uses principal) or holding_key (uses cost basis avg×units). ' +
      'Result is NOT a hard fee — separate HARD costs (debt APR, stated break penalties, FX with tools).',
    parameters: Type.Object({
      ...channelIdParams,
      years: Type.Number({
        description: 'Forgone horizon in years (> 0). Required — never omit.',
      }),
      currency: Type.String({
        description: 'Currency of capital and result (e.g. SGD, USD). Required — no default.',
      }),
      capital: Type.Optional(
        Type.Number({
          description:
            'Capital redeployed / forgone (> 0). Required unless deposit_id or holding_key supplies it.',
        }),
      ),
      yield_pct: Type.Optional(
        Type.Number({
          description:
            'Explicit annual yield in percent points (3.2 = 3.2% p.a.). User- or factsheet-stated this turn. ' +
            'Do not invent. Mutually exclusive with deposit_id; optional override for holding when set.',
        }),
      ),
      holding_key: Type.Optional(
        Type.String({
          description:
            'Portfolio key (e.g. SCHRODER-ASINC-SGD@ocbc). Uses fund.expected_yield_pct on books when yield_pct omitted.',
        }),
      ),
      deposit_id: Type.Optional(
        Type.String({
          description:
            'Fixed-deposit id. Implied yield from books interest/principal/term; capital defaults to principal.',
        }),
      ),
      label: Type.Optional(Type.String({ description: 'Optional label for the scenario.' })),
    }),
    prepareArguments(args) {
      return prepareNumericToolArgs(args, ['years', 'capital', 'yield_pct']);
    },
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        years: number;
        currency: string;
        capital?: number;
        yield_pct?: number;
        holding_key?: string;
        deposit_id?: string;
        label?: string;
      };
      try {
        if (!p.currency?.trim()) {
          return fail('currency is required (e.g. SGD, USD) — no silent default.');
        }
        if (!(p.years > 0) || !Number.isFinite(p.years)) {
          return fail('years must be a finite number > 0 (forgone horizon is required).');
        }

        const state = resolveInvestorFromChannel(p);
        let capital = p.capital;
        let yieldPct = p.yield_pct;
        let source: 'explicit_yield_pct' | 'fund_expected_yield' | 'deposit_implied_yield' =
          'explicit_yield_pct';
        let sourceDetail = 'user-stated yield_pct this turn';
        let yieldBasis: string | undefined;
        let productClass: string | undefined;
        let label = p.label;

        if (p.deposit_id?.trim() && p.holding_key?.trim()) {
          return fail('Pass deposit_id OR holding_key, not both.');
        }

        if (p.deposit_id?.trim()) {
          const deposits = getDeposits(state);
          const dep = deposits.find((d) => d.id === p.deposit_id!.trim());
          if (!dep) {
            return fail(
              `No deposit id "${p.deposit_id}". Recorded: ${deposits.map((d) => d.id).join(', ') || 'none'}.`,
            );
          }
          if (dep.currency.toUpperCase() !== p.currency.trim().toUpperCase()) {
            return fail(
              `deposit ${dep.id} is ${dep.currency}; plan currency is ${p.currency}. ` +
                'Convert with live FX tools first or match currency — no silent FX.',
            );
          }
          capital = capital ?? dep.amount;
          if (yieldPct == null) {
            yieldPct = impliedDepositAnnualPct(
              dep.amount,
              dep.interest,
              dep.start_date,
              dep.end_date,
            );
            source = 'deposit_implied_yield';
            sourceDetail = `deposit ${dep.id} interest=${dep.interest} / principal=${dep.amount} / term`;
          } else {
            source = 'explicit_yield_pct';
            sourceDetail = `explicit yield_pct override on deposit ${dep.id}`;
          }
          label = label ?? dep.label ?? dep.id;
        } else if (p.holding_key?.trim()) {
          const portfolio = getPortfolio(state);
          const key = resolveLookupHoldingKey(
            portfolio,
            p.holding_key.trim(),
            undefined,
            false,
          );
          const h = portfolio[key];
          if (!h) {
            return fail(`Holding ${key} not found.`);
          }
          const cost = h.avg_price * h.units;
          capital = capital ?? cost;
          if (yieldPct == null) {
            if (!isFundHolding(h) || h.fund?.expected_yield_pct == null) {
              return fail(
                `Holding ${key} has no fund.expected_yield_pct on books. ` +
                  'Pass yield_pct explicitly (user/factsheet this turn), or update_holding with ' +
                  'expected_yield_pct + yield_basis + yield_as_of. Never invent a yield.',
              );
            }
            yieldPct = h.fund.expected_yield_pct;
            source = 'fund_expected_yield';
            sourceDetail = `${key} expected_yield_pct (basis=${h.fund.yield_basis}, as_of=${h.fund.yield_as_of})`;
            yieldBasis = h.fund.yield_basis;
            productClass = h.fund.product_class;
          } else {
            source = 'explicit_yield_pct';
            sourceDetail = `explicit yield_pct on holding ${key}`;
            if (isFundHolding(h)) {
              yieldBasis = h.fund?.yield_basis;
              productClass = h.fund?.product_class;
            }
          }
          label = label ?? (isFundHolding(h) ? h.fund?.name : undefined) ?? key;
        } else {
          if (capital == null) {
            return fail(
              'capital is required when neither deposit_id nor holding_key is set.',
            );
          }
          if (yieldPct == null) {
            return fail(
              'yield_pct is required when neither deposit_id nor holding_key supplies a books yield. ' +
                'Never invent ~3% "balanced fund" defaults.',
            );
          }
          source = 'explicit_yield_pct';
          sourceDetail = 'user-stated capital + yield_pct this turn';
        }

        if (capital == null || yieldPct == null) {
          return fail('Internal: capital and yield_pct unresolved.');
        }

        const result = estimateOpportunityCost({
          capital,
          yieldPct,
          years: p.years,
          currency: p.currency,
          source,
          sourceDetail,
          yieldBasis,
          productClass,
          label,
        });

        const lines = [
          '── OPPORTUNITY COST (SOFT) ──',
          result.label ? `Label: ${result.label}` : null,
          `Formula: ${result.formula}`,
          `Source: ${result.source} — ${result.source_detail}`,
          result.yield_basis ? `Yield basis: ${result.yield_basis}` : null,
          result.product_class ? `Product class: ${result.product_class}` : null,
          `Per year: ${result.soft_cost_per_year.toFixed(2)} ${result.currency}`,
          `Over ${result.years} yr: ${result.soft_cost_total.toFixed(2)} ${result.currency}`,
          '',
          'Caveats:',
          ...result.caveats.map((c) => `  • ${c}`),
          '',
          'HARD costs (debt interest, fees, stated break penalties, tool-backed FX) are separate — do not mix into this number.',
        ].filter((x): x is string => x != null);

        return ok(lines.join('\n'), result);
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
