/**
 * Projection + scenario tools.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import {
  assertSavedScenario,
  findScenarioById,
  generateHouseholdId,
  getCashFlows,
  getLiabilities,
  getProjectionAssumptions,
  getProperties,
  getScenarios,
  getTreasury,
  removeScenario,
  upsertScenario,
  type HouseholdInvestorState,
  type SavedScenario,
  type ScenarioEvent,
} from '../state/household-state.js';
import {
  getCashes,
  getDeposits,
  totalCash,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  evaluateAffordability,
  formatAffordability,
} from '../treasury/affordability.js';
import {
  project,
  toReporting,
  type ProjectBooks,
  type ProjectionResult,
} from '../treasury/project.js';
import { portfolioCostBasis } from './household.js';
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

function buildBooks(
  state: HouseholdInvestorState,
  portfolioValue: number | undefined,
): { books: ProjectBooks; portfolioValuation: string } {
  const treasury = getTreasury(state);
  if (treasury == null) {
    throw new Error('treasury.reporting_currency not set. Call set_treasury first.');
  }
  const assumptions = getProjectionAssumptions(state);
  if (assumptions == null) {
    throw new Error(
      'projection_assumptions not set. Call set_projection_assumptions first (portfolio_return_annual_pct, inflation_annual_pct).',
    );
  }
  const rep = treasury.reporting_currency;
  const fx = assumptions.fx;
  const cash = totalCash(getCashes(state));
  if (cash == null) {
    throw new Error(
      'Free cash not recorded. Call set_cash before projections (cannot invent 0 cash).',
    );
  }
  const freeCash = toReporting(cash.amount, cash.currency, rep, fx, 'free cash');
  const deposits = getDeposits(state).map((d) => ({
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    end_date: d.end_date,
  }));
  // Validate deposit FX early
  for (const d of deposits) {
    toReporting(d.amount, d.currency, rep, fx, `deposit ${d.id}`);
  }
  const port =
    portfolioValue != null && Number.isFinite(portfolioValue)
      ? portfolioValue
      : portfolioCostBasis(state);
  if (port < 0) throw new Error('portfolio_value must be ≥ 0.');
  const portfolioValuation =
    portfolioValue != null ? 'explicit_portfolio_value' : 'cost_basis';

  return {
    books: {
      reportingCurrency: rep,
      freeCash,
      portfolioValue: port,
      deposits,
      properties: getProperties(state),
      liabilities: getLiabilities(state),
      cashFlows: getCashFlows(state),
    },
    portfolioValuation,
  };
}

function formatProjection(result: ProjectionResult, portfolioValuation: string): string {
  const s = result.summary;
  const lines = [
    `Projection — ${result.horizonMonths} months from ${result.asOf}`,
    `Reporting: ${result.reportingCurrency}` +
      (result.scenarioId ? ` | scenario=${result.scenarioId}` : ' | base (no scenario)'),
    `Portfolio valuation: ${portfolioValuation}`,
    `End net worth: ${s.endNetWorth.toFixed(2)} ${result.reportingCurrency}`,
    `Min free cash: ${s.minFreeCash.toFixed(2)} (${s.minFreeCashMonth})`,
    `Shortfall months: ${s.shortfallMonths}`,
    `Total income (period): ${s.totalIncome.toFixed(2)} | total expense: ${s.totalExpense.toFixed(2)}`,
    '',
    'Assumptions used:',
    `  portfolio return ${result.assumptionsUsed.portfolio_return_annual_pct}%/yr`,
    `  inflation ${result.assumptionsUsed.inflation_annual_pct}%/yr (not auto-applied to CF lines)`,
    `  property growth ${result.assumptionsUsed.property_appreciation_annual_pct}%/yr`,
    '',
    'Year-end snapshot (Dec or last month of each year in horizon):',
  ];
  const byYear = new Map<string, (typeof result.months)[0]>();
  for (const m of result.months) {
    byYear.set(m.month.slice(0, 4), m);
  }
  for (const [, m] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(
      `  ${m.month}: NW ${m.netWorth.toFixed(2)} | cash ${m.freeCash.toFixed(2)} | port ${m.portfolio.toFixed(2)}` +
        ` | prop ${m.property.toFixed(2)} | debt ${m.debt.toFixed(2)}` +
        (m.flags.length ? ` | ${m.flags.join(',')}` : ''),
    );
  }
  // Also show last month always
  const last = result.months[result.months.length - 1];
  lines.push(
    '',
    `Final month ${last.month}: NW ${last.netWorth.toFixed(2)} | free cash ${last.freeCash.toFixed(2)}`,
  );
  return lines.join('\n');
}

function parseInlineEvents(raw: unknown): ScenarioEvent[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('events must be an array.');
  }
  // Validate via assertSavedScenario wrapper
  const scenario = assertSavedScenario({
    id: 'inline-temp',
    label: 'inline',
    updated_at: todayYmd(),
    events: raw,
  });
  return scenario.events;
}

export function createProjectionTools(): AgentTool[] {
  const saveScenarioTool: AgentTool = {
    name: 'save_scenario',
    label: 'Save Projection Scenario',
    description:
      'Save a named scenario overlay (events + optional assumption_overrides). Does not change base books. ' +
      'Event types: buy_property, add_expense, add_income, one_off.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.Optional(Type.String()),
      label: Type.String(),
      events: Type.Array(Type.Unknown(), {
        description:
          'Scenario events array. buy_property needs date, property_value, currency, down_payment, optional mortgage{annual_rate_pct,term_months,payment_amount}.',
      }),
      assumption_overrides: Type.Optional(
        Type.Object({
          portfolio_return_annual_pct: Type.Optional(Type.Number()),
          inflation_annual_pct: Type.Optional(Type.Number()),
          property_appreciation_annual_pct: Type.Optional(Type.Number()),
          cash_buffer: Type.Optional(Type.Number()),
          fx: Type.Optional(Type.Record(Type.String(), Type.Number())),
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id?: string;
        label: string;
        events: unknown[];
        assumption_overrides?: SavedScenario['assumption_overrides'];
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const today = todayYmd();
        const id =
          p.id?.trim() || generateHouseholdId('sc', getScenarios(state));
        const scenario = assertSavedScenario({
          id,
          label: p.label,
          updated_at: today,
          events: p.events,
          assumption_overrides: p.assumption_overrides,
        });
        upsertScenario(state, scenario);
        state.log.push({ ts: today, action: 'scenario_saved', id });
        saveState(state);
        return ok(
          `Scenario ${scenario.id} saved: ${scenario.label} (${scenario.events.length} event(s)).`,
          { scenario },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const getScenarioTool: AgentTool = {
    name: 'get_scenario',
    label: 'Get Scenario',
    description: 'Get a saved scenario by id.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const s = findScenarioById(getScenarios(state), p.id);
        if (s == null) return fail(`Scenario id "${p.id}" not found.`);
        return ok(JSON.stringify(s, null, 2), { scenario: s });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const listScenariosTool: AgentTool = {
    name: 'list_scenarios',
    label: 'List Scenarios',
    description: 'List saved projection scenarios.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const list = getScenarios(state);
        if (list.length === 0) return ok('No saved scenarios.', { scenarios: [] });
        const text = list
          .map((s) => `${s.id}: ${s.label} (${s.events.length} events, updated ${s.updated_at})`)
          .join('\n');
        return ok(text, { scenarios: list });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const deleteScenarioTool: AgentTool = {
    name: 'delete_scenario',
    label: 'Delete Scenario',
    description: 'Delete a saved scenario by id.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String(),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const removed = removeScenario(state, p.id);
        const today = todayYmd();
        state.log.push({ ts: today, action: 'scenario_deleted', id: p.id });
        saveState(state);
        return ok(`Deleted scenario ${removed.id}.`, { scenario: removed });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const runProjectionTool: AgentTool = {
    name: 'run_projection',
    label: 'Run Household Projection',
    description:
      'Deterministic monthly projection of free cash, portfolio, property, debt, net worth. ' +
      'Requires set_treasury, set_projection_assumptions, set_cash. Optional scenario_id or inline events. ' +
      'Optional portfolio_value (reporting ccy); default = portfolio cost basis. Does not invent FX/returns.',
    parameters: Type.Object({
      ...channelIdParams,
      horizon_months: Type.Number({ description: 'Horizon in months (e.g. 60 for 5 years).' }),
      as_of: Type.Optional(Type.String({ description: 'Anchor date YYYY-MM-DD (default today).' })),
      scenario_id: Type.Optional(Type.String()),
      events: Type.Optional(
        Type.Array(Type.Unknown(), {
          description: 'Inline scenario events (ignored if scenario_id set).',
        }),
      ),
      portfolio_value: Type.Optional(
        Type.Number({
          description:
            'Portfolio MTM in reporting currency. If omitted, uses cost basis of holdings.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        horizon_months: number;
        as_of?: string;
        scenario_id?: string;
        events?: unknown[];
        portfolio_value?: number;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const assumptions = getProjectionAssumptions(state);
        if (assumptions == null) {
          return fail(
            'projection_assumptions not set. Call set_projection_assumptions first.',
          );
        }
        const { books, portfolioValuation } = buildBooks(state, p.portfolio_value);
        let scenario: SavedScenario | null = null;
        if (p.scenario_id) {
          scenario = findScenarioById(getScenarios(state), p.scenario_id);
          if (scenario == null) return fail(`Scenario id "${p.scenario_id}" not found.`);
        } else if (p.events != null && p.events.length > 0) {
          scenario = {
            id: 'inline',
            label: 'inline',
            updated_at: todayYmd(),
            events: parseInlineEvents(p.events),
          };
        }
        const asOf = p.as_of ?? todayYmd();
        const result = project({
          books,
          assumptions,
          scenario,
          horizonMonths: p.horizon_months,
          asOf,
        });
        let text = formatProjection(result, portfolioValuation);
        if (result.purchaseMonth != null) {
          const aff = evaluateAffordability({
            projection: result,
            purchaseMonth: result.purchaseMonth,
            peakCashNeed: result.peakCashNeed,
          });
          text += '\n\n' + formatAffordability(aff);
          return ok(text, { projection: result, affordability: aff, portfolioValuation });
        }
        return ok(text, { projection: result, portfolioValuation });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const compareScenariosTool: AgentTool = {
    name: 'compare_scenarios',
    label: 'Compare Projection Scenarios',
    description:
      'Run base projection vs one or more saved scenarios (or one inline events set). ' +
      'Returns end NW, min cash, shortfall months, and affordability when a buy_property event exists.',
    parameters: Type.Object({
      ...channelIdParams,
      horizon_months: Type.Number(),
      as_of: Type.Optional(Type.String()),
      scenario_ids: Type.Optional(Type.Array(Type.String())),
      events: Type.Optional(Type.Array(Type.Unknown())),
      portfolio_value: Type.Optional(Type.Number()),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        horizon_months: number;
        as_of?: string;
        scenario_ids?: string[];
        events?: unknown[];
        portfolio_value?: number;
      };
      try {
        const state = asHousehold(resolveInvestorFromChannel(p));
        const assumptions = getProjectionAssumptions(state);
        if (assumptions == null) {
          return fail('projection_assumptions not set.');
        }
        const { books, portfolioValuation } = buildBooks(state, p.portfolio_value);
        const asOf = p.as_of ?? todayYmd();

        const scenarios: Array<SavedScenario | null> = [null];
        if (p.scenario_ids != null) {
          for (const id of p.scenario_ids) {
            const s = findScenarioById(getScenarios(state), id);
            if (s == null) return fail(`Scenario id "${id}" not found.`);
            scenarios.push(s);
          }
        }
        if (p.events != null && p.events.length > 0) {
          scenarios.push({
            id: 'inline',
            label: 'inline',
            updated_at: todayYmd(),
            events: parseInlineEvents(p.events),
          });
        }
        if (scenarios.length === 1) {
          return fail('Provide scenario_ids and/or events to compare against base.');
        }

        const lines: string[] = [
          `Compare scenarios — horizon ${p.horizon_months}m from ${asOf}`,
          `Portfolio valuation: ${portfolioValuation}`,
          '',
        ];
        const results: Array<{
          label: string;
          projection: ProjectionResult;
          affordability?: ReturnType<typeof evaluateAffordability>;
        }> = [];

        for (const sc of scenarios) {
          const result = project({
            books,
            assumptions,
            scenario: sc,
            horizonMonths: p.horizon_months,
            asOf,
          });
          const label = sc == null ? 'BASE' : `${sc.id} (${sc.label})`;
          lines.push(
            `### ${label}`,
            `  End NW: ${result.summary.endNetWorth.toFixed(2)} ${result.reportingCurrency}`,
            `  Min cash: ${result.summary.minFreeCash.toFixed(2)} (${result.summary.minFreeCashMonth})`,
            `  Shortfall months: ${result.summary.shortfallMonths}`,
          );
          let affordability: ReturnType<typeof evaluateAffordability> | undefined;
          if (result.purchaseMonth != null) {
            affordability = evaluateAffordability({
              projection: result,
              purchaseMonth: result.purchaseMonth,
              peakCashNeed: result.peakCashNeed,
            });
            lines.push(formatAffordability(affordability));
          }
          lines.push('');
          results.push({ label, projection: result, affordability });
        }

        return ok(lines.join('\n'), { results, portfolioValuation });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [
    saveScenarioTool,
    getScenarioTool,
    listScenariosTool,
    deleteScenarioTool,
    runProjectionTool,
    compareScenariosTool,
  ];
}
