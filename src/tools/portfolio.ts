import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import type { Holding, OptionSpec } from '../market/types.js';
import {
  assertHolding,
  buildOptionKey,
  formatOptionLabel,
  isOptionHolding,
  valuePosition,
} from '../market/position-value.js';
import {
  getPortfolio,
  setPortfolio,
} from '../state/portfolio-state.js';
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

function formatPortfolio(portfolio: Record<string, Holding>): string {
  const keys = Object.keys(portfolio);
  if (keys.length === 0) return 'Portfolio is empty. Use add_holding to add positions.';

  let equityCost = 0;
  let optionPremiumCollected = 0;
  let optionPremiumPaid = 0;
  let contingentCash = 0;
  let contingentShares = 0;
  let equityCount = 0;
  let optionCount = 0;

  const lines = [`Portfolio — ${keys.length} position${keys.length === 1 ? '' : 's'}:`, ''];

  for (const key of keys) {
    const h = portfolio[key];
    try {
      assertHolding(key, h);
    } catch (e) {
      lines.push(`  ${key}: INVALID — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (isOptionHolding(h)) {
      optionCount += 1;
      const e = valuePosition(key, h);
      const o = h.option!;
      const side = o.side.toUpperCase();
      const right = o.right.toUpperCase();
      lines.push(
        `  ${key}`,
        `    ${formatOptionLabel(o, h.units)} | ${o.settlement} settle | ${o.multiplier} sh/ct`,
        `    Premium $/contract: $${h.avg_price.toFixed(2)} × ${h.units} ct = $${e.premiumAbsolute.toFixed(2)} (${side})`,
        `    Mark: $${o.mark.toFixed(2)}/ct | MTM value: $${e.value.toFixed(2)} | P/L: ${e.pl >= 0 ? '+' : ''}$${e.pl.toFixed(2)} (${e.plPct >= 0 ? '+' : ''}${e.plPct.toFixed(1)}%)`,
      );
      if (e.contingentCashObligation > 0) {
        lines.push(
          `    Contingent cash if assigned (not current MTM): $${e.contingentCashObligation.toFixed(2)}`,
        );
      }
      if (e.contingentShareObligation > 0) {
        lines.push(
          `    Contingent share delivery (if assigned): ${e.contingentShareObligation} shares of ${o.underlying}`,
        );
      }
      if (o.underlying_mark != null) {
        lines.push(`    Underlying mark: $${o.underlying_mark.toFixed(2)}`);
      }
      if (h.category) lines.push(`    Category: ${h.category}`);
      lines.push('');

      if (o.side === 'short') optionPremiumCollected += e.premiumAbsolute;
      else optionPremiumPaid += e.premiumAbsolute;
      contingentCash += e.contingentCashObligation;
      contingentShares += e.contingentShareObligation;
    } else {
      equityCount += 1;
      const cost = h.avg_price * h.units;
      equityCost += cost;
      lines.push(
        `  ${key.padEnd(8)} | ${h.units} shares @ $${h.avg_price.toFixed(2)} | Cost: $${cost.toFixed(2)} | ${h.category ?? 'Uncategorized'}`,
      );
    }
  }

  lines.push('');
  lines.push(`Equities: ${equityCount} · cost basis $${equityCost.toFixed(2)}`);
  if (optionCount > 0) {
    lines.push(`Options: ${optionCount}`);
    if (optionPremiumCollected > 0) {
      lines.push(`  Premium collected (shorts): $${optionPremiumCollected.toFixed(2)}`);
    }
    if (optionPremiumPaid > 0) {
      lines.push(`  Premium paid (longs): $${optionPremiumPaid.toFixed(2)}`);
    }
    if (contingentCash > 0) {
      lines.push(`  Contingent cash obligation (short puts): $${contingentCash.toFixed(2)}`);
    }
    if (contingentShares > 0) {
      lines.push(`  Contingent share delivery (short calls): ${contingentShares} shares`);
    }
  }
  return lines.join('\n');
}

function parseOptionFromParams(p: {
  option_right?: string;
  option_side?: string;
  strike?: number;
  expiry?: string;
  multiplier?: number;
  underlying?: string;
  settlement?: string;
  mark?: number;
  underlying_mark?: number;
  avg_price: number;
}): OptionSpec {
  if (!p.option_right || !p.option_side || p.strike == null || !p.expiry || p.multiplier == null || !p.underlying || !p.settlement) {
    throw new Error(
      'Option positions require: option_right, option_side, strike, expiry, multiplier, underlying, settlement. ' +
        'Example: short put → option_right=put option_side=short strike=90 expiry=2026-08-07 multiplier=100 underlying=SPACEX settlement=physical',
    );
  }
  const right = p.option_right.toLowerCase();
  const side = p.option_side.toLowerCase();
  const settlement = p.settlement.toLowerCase();
  if (right !== 'call' && right !== 'put') {
    throw new Error('option_right must be "call" or "put".');
  }
  if (side !== 'long' && side !== 'short') {
    throw new Error('option_side must be "long" or "short".');
  }
  if (settlement !== 'physical' && settlement !== 'cash') {
    throw new Error('settlement must be "physical" or "cash".');
  }
  if (!(p.strike > 0)) throw new Error('strike must be positive.');
  if (!(p.multiplier > 0)) throw new Error('multiplier must be positive (US equity options: 100).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiry)) {
    throw new Error('expiry must be YYYY-MM-DD.');
  }

  // mark: explicit or trade premium (avg_price) written at entry — not a silent runtime default later
  const mark = p.mark != null ? p.mark : p.avg_price;
  if (!(mark >= 0)) throw new Error('mark must be ≥ 0.');

  const spec: OptionSpec = {
    right,
    side,
    strike: p.strike,
    expiry: p.expiry,
    multiplier: p.multiplier,
    underlying: p.underlying.trim().toUpperCase(),
    settlement,
    mark,
  };
  if (p.underlying_mark != null) {
    if (!(p.underlying_mark >= 0)) throw new Error('underlying_mark must be ≥ 0.');
    spec.underlying_mark = p.underlying_mark;
  }
  return spec;
}

export function createPortfolioTools(): AgentTool[] {
  const addHolding: AgentTool = {
    name: 'add_holding',
    label: 'Add Holding',
    description:
      "Add or update a stock or option position in the user's portfolio. " +
      'Equity: ticker + avg_price + units. ' +
      'Option: set instrument=option with option_right (call|put), option_side (long|short), strike, expiry (YYYY-MM-DD), ' +
      'multiplier (typically 100 shares/contract — assignment size only), underlying, settlement (physical|cash). ' +
      'avg_price = total premium dollars PER CONTRACT (e.g. $265 credit for one put covering 100 shares — do NOT enter per-share ×100). ' +
      'units = contracts. mark = current premium $ per contract. Contingent obligation (strike×mult×cts) is separate from MTM. ' +
      'Option portfolio key auto-builds as UNDERLYING-P|C-STRIKE-YYYYMMDD-L|S unless ticker is provided. ' +
      'Pass telegram_user_id or slack_user_id from the message context — never ask the user for it.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.Optional(
        Type.String({
          description:
            'Portfolio key. Equity: stock ticker (e.g. AAPL). Option: optional override; otherwise auto-generated from contract fields.',
        }),
      ),
      avg_price: Type.Number({
        description:
          'Equity: average cost per share. Option: total premium dollars per contract at trade (e.g. 265 means $265 for one contract).',
      }),
      units: Type.Number({
        description: 'Equity: number of shares. Option: number of contracts.',
      }),
      category: Type.Optional(
        Type.String({ description: 'Fund category (e.g. "SL Technology S1", "Private / Secondary").' }),
      ),
      instrument: Type.Optional(
        Type.Union([Type.Literal('equity'), Type.Literal('option')], {
          description: 'Position type. Default equity when omitted.',
        }),
      ),
      option_right: Type.Optional(
        Type.Union([Type.Literal('call'), Type.Literal('put')], {
          description: 'Option only: call or put.',
        }),
      ),
      option_side: Type.Optional(
        Type.Union([Type.Literal('long'), Type.Literal('short')], {
          description: 'Option only: long (bought) or short (sold/written).',
        }),
      ),
      strike: Type.Optional(Type.Number({ description: 'Option only: strike price per share.' })),
      expiry: Type.Optional(
        Type.String({ description: 'Option only: expiry date YYYY-MM-DD.' }),
      ),
      multiplier: Type.Optional(
        Type.Number({
          description:
            'Option only: shares controlled per contract (US = 100). Used for assignment obligation only — not premium math.',
        }),
      ),
      underlying: Type.Optional(
        Type.String({
          description: 'Option only: underlying symbol (public ticker or private name, e.g. SPACEX).',
        }),
      ),
      settlement: Type.Optional(
        Type.Union([Type.Literal('physical'), Type.Literal('cash')], {
          description: 'Option only: physical delivery or cash settlement.',
        }),
      ),
      mark: Type.Optional(
        Type.Number({
          description:
            'Option only: current premium mark in dollars per contract for MTM. Defaults to avg_price at entry when omitted.',
        }),
      ),
      underlying_mark: Type.Optional(
        Type.Number({
          description: 'Option only: optional underlying price mark (private names / scenarios).',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        ticker?: string;
        avg_price: number;
        units: number;
        category?: string;
        instrument?: 'equity' | 'option';
        option_right?: 'call' | 'put';
        option_side?: 'long' | 'short';
        strike?: number;
        expiry?: string;
        multiplier?: number;
        underlying?: string;
        settlement?: 'physical' | 'cash';
        mark?: number;
        underlying_mark?: number;
      };
      try {
        if (p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units <= 0) return fail('units must be positive.');

        const instrument = p.instrument ?? 'equity';
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);

        let key: string;
        let holding: Holding;

        if (instrument === 'option') {
          const option = parseOptionFromParams(p);
          key = p.ticker?.trim()
            ? p.ticker.trim().toUpperCase()
            : buildOptionKey({
                underlying: option.underlying,
                right: option.right,
                strike: option.strike,
                expiry: option.expiry,
                side: option.side,
              });
          holding = {
            instrument: 'option',
            avg_price: p.avg_price,
            units: p.units,
            category: p.category ?? portfolio[key]?.category,
            option,
          };
          assertHolding(key, holding);
        } else {
          if (!p.ticker?.trim()) {
            return fail('ticker is required for equity holdings.');
          }
          key = p.ticker.trim().toUpperCase();
          holding = {
            instrument: 'equity',
            avg_price: p.avg_price,
            units: p.units,
            category: p.category ?? portfolio[key]?.category,
          };
          assertHolding(key, holding);
        }

        const isUpdate = key in portfolio;
        portfolio[key] = holding;
        setPortfolio(state, portfolio);

        const today = new Date().toISOString().slice(0, 10);
        state.log.push({
          ts: today,
          action: isUpdate ? 'holding_updated' : 'holding_added',
          ticker: key,
          instrument,
          avg_price: p.avg_price,
          units: p.units,
          category: p.category,
          ...(instrument === 'option' ? { option: holding.option } : {}),
        });
        saveState(state);

        const action = isUpdate ? 'Updated' : 'Added';
        if (instrument === 'option') {
          const e = valuePosition(key, holding);
          const o = holding.option!;
          return ok(
            `${action} option ${key}: ${formatOptionLabel(o, p.units)}\n` +
              `Premium: $${e.premiumAbsolute.toFixed(2)} (${o.side}) @ $${p.avg_price.toFixed(2)}/contract × ${p.units} ct\n` +
              `Mark: $${o.mark.toFixed(2)}/ct | MTM: $${e.value.toFixed(2)} | P/L: ${e.pl >= 0 ? '+' : ''}$${e.pl.toFixed(2)}\n` +
              (e.contingentCashObligation > 0
                ? `Contingent cash if assigned (not current MTM): $${e.contingentCashObligation.toFixed(2)}\n`
                : '') +
              (e.contingentShareObligation > 0
                ? `Contingent share delivery if assigned: ${e.contingentShareObligation} ${o.underlying}\n`
                : '') +
              (p.category ? `Category: ${p.category}` : ''),
            {
              ticker: key,
              holding,
              isUpdate,
              economics: e,
            },
          );
        }

        const cost = p.avg_price * p.units;
        return ok(
          `${action} ${key}: ${p.units} shares @ $${p.avg_price.toFixed(2)} (cost: $${cost.toFixed(2)})${p.category ? ` [${p.category}]` : ''}`,
          { ticker: key, avg_price: p.avg_price, units: p.units, category: p.category, isUpdate },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removeHolding: AgentTool = {
    name: 'remove_holding',
    label: 'Remove Holding',
    description:
      "Remove a stock or option position from the user's portfolio. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({
        description: 'Portfolio key to remove (equity ticker or option key, e.g. SPACEX-P-90-20260807-S).',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { ticker: string };
      try {
        const state = resolveInvestorFromChannel(p);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);

        if (!(ticker in portfolio)) {
          return fail(
            `Ticker "${ticker}" not found in portfolio. Current holdings: ${Object.keys(portfolio).join(', ') || 'none'}`,
          );
        }

        const removed = portfolio[ticker];
        delete portfolio[ticker];
        setPortfolio(state, portfolio);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'holding_removed',
          ticker,
          avg_price: removed.avg_price,
          units: removed.units,
          instrument: removed.instrument ?? 'equity',
        });
        saveState(state);

        const kind = isOptionHolding(removed) ? 'option' : 'equity';
        return ok(
          `Removed ${ticker} (${kind}: ${removed.units} @ $${removed.avg_price.toFixed(2)}).`,
          { ticker, removed },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const getPortfolioTool: AgentTool = {
    name: 'get_portfolio',
    label: 'Get Portfolio',
    description:
      "Retrieve the user's saved portfolio (equities + options). Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        return ok(formatPortfolio(portfolio), { portfolio, count: Object.keys(portfolio).length });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateHolding: AgentTool = {
    name: 'update_holding',
    label: 'Update Holding',
    description:
      'Update fields of an existing equity or option position (including option mark for MTM). ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({ description: 'Portfolio key (equity ticker or option key).' }),
      avg_price: Type.Optional(
        Type.Number({
          description: 'New avg cost (equity) or trade premium $ per contract (option).',
        }),
      ),
      units: Type.Optional(Type.Number({ description: 'New shares (equity) or contracts (option).' })),
      category: Type.Optional(Type.String({ description: 'New fund category.' })),
      mark: Type.Optional(
        Type.Number({ description: 'Option only: new premium mark in $ per contract for MTM.' }),
      ),
      underlying_mark: Type.Optional(
        Type.Number({ description: 'Option only: new underlying price mark.' }),
      ),
      strike: Type.Optional(Type.Number({ description: 'Option only: new strike.' })),
      expiry: Type.Optional(Type.String({ description: 'Option only: new expiry YYYY-MM-DD.' })),
      multiplier: Type.Optional(Type.Number({ description: 'Option only: new multiplier.' })),
      settlement: Type.Optional(
        Type.Union([Type.Literal('physical'), Type.Literal('cash')], {
          description: 'Option only: settlement style.',
        }),
      ),
      option_side: Type.Optional(
        Type.Union([Type.Literal('long'), Type.Literal('short')], {
          description: 'Option only: long or short.',
        }),
      ),
      option_right: Type.Optional(
        Type.Union([Type.Literal('call'), Type.Literal('put')], {
          description: 'Option only: call or put.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        ticker: string;
        avg_price?: number;
        units?: number;
        category?: string;
        mark?: number;
        underlying_mark?: number;
        strike?: number;
        expiry?: string;
        multiplier?: number;
        settlement?: 'physical' | 'cash';
        option_side?: 'long' | 'short';
        option_right?: 'call' | 'put';
      };
      try {
        const state = resolveInvestorFromChannel(p);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);

        if (!(ticker in portfolio)) {
          return fail(`Ticker "${ticker}" not found in portfolio. Use add_holding to create it first.`);
        }

        const existing = portfolio[ticker];
        if (p.avg_price != null && p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units != null && p.units <= 0) return fail('units must be positive.');

        if (isOptionHolding(existing)) {
          if (!existing.option) {
            return fail(`Holding ${ticker} is instrument=option but option fields are missing.`);
          }
          const nextOption: OptionSpec = {
            ...existing.option,
            ...(p.mark != null ? { mark: p.mark } : {}),
            ...(p.underlying_mark != null ? { underlying_mark: p.underlying_mark } : {}),
            ...(p.strike != null ? { strike: p.strike } : {}),
            ...(p.expiry != null ? { expiry: p.expiry } : {}),
            ...(p.multiplier != null ? { multiplier: p.multiplier } : {}),
            ...(p.settlement != null ? { settlement: p.settlement } : {}),
            ...(p.option_side != null ? { side: p.option_side } : {}),
            ...(p.option_right != null ? { right: p.option_right } : {}),
          };
          const next: Holding = {
            instrument: 'option',
            avg_price: p.avg_price ?? existing.avg_price,
            units: p.units ?? existing.units,
            category: p.category ?? existing.category,
            option: nextOption,
          };
          assertHolding(ticker, next);
          portfolio[ticker] = next;
        } else {
          if (
            p.mark != null ||
            p.underlying_mark != null ||
            p.strike != null ||
            p.expiry != null ||
            p.multiplier != null ||
            p.settlement != null ||
            p.option_side != null ||
            p.option_right != null
          ) {
            return fail(
              `Holding ${ticker} is equity. To convert to an option, remove it and add_holding with instrument=option.`,
            );
          }
          const next: Holding = {
            instrument: 'equity',
            avg_price: p.avg_price ?? existing.avg_price,
            units: p.units ?? existing.units,
            category: p.category ?? existing.category,
          };
          assertHolding(ticker, next);
          portfolio[ticker] = next;
        }

        setPortfolio(state, portfolio);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'holding_updated',
          ticker,
          ...portfolio[ticker],
        });
        saveState(state);

        const h = portfolio[ticker];
        if (isOptionHolding(h)) {
          const e = valuePosition(ticker, h);
          return ok(
            `Updated option ${ticker}: ${e.label}\n` +
              `Premium basis: $${e.premiumAbsolute.toFixed(2)} | Mark: $${e.price.toFixed(2)} | ` +
              `MTM: $${e.value.toFixed(2)} | P/L: ${e.pl >= 0 ? '+' : ''}$${e.pl.toFixed(2)}` +
              (e.contingentCashObligation > 0
                ? `\nContingent cash obligation: $${e.contingentCashObligation.toFixed(2)}`
                : ''),
            { ticker, holding: h, economics: e },
          );
        }

        return ok(
          `Updated ${ticker}: ${h.units} shares @ $${h.avg_price.toFixed(2)} (cost: $${(h.avg_price * h.units).toFixed(2)})${h.category ? ` [${h.category}]` : ''}`,
          { ticker, holding: h },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const clearPortfolio: AgentTool = {
    name: 'clear_portfolio',
    label: 'Clear Portfolio',
    description:
      "Remove all holdings. Requires confirm=true. Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({
      ...channelIdParams,
      confirm: Type.Boolean({
        description: 'Must be true to proceed. Confirm with the user first.',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { confirm: boolean };
      try {
        if (!p.confirm) return fail('Set confirm=true to clear the portfolio. Confirm with the user first.');

        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        const count = Object.keys(portfolio).length;

        if (count === 0) return fail('Portfolio is already empty.');

        setPortfolio(state, {});
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'portfolio_cleared',
          positions_removed: count,
        });
        saveState(state);

        return ok(`Cleared portfolio — ${count} position${count === 1 ? '' : 's'} removed.`, {
          cleared: count,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  return [addHolding, removeHolding, getPortfolioTool, updateHolding, clearPortfolio];
}
