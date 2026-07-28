import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import type { Holding, OptionSpec } from '../market/types.js';
import {
  assertHolding,
  buildOptionKey,
  formatOptionLabel,
  isOptionHolding,
  normalizeOptionalChannel,
  valuePosition,
} from '../market/position-value.js';
import {
  applyCashDelta,
  cashDeltaForHoldingChange,
  clearCash,
  getCash,
  getPlaybook,
  getPortfolio,
  setCash,
  setPortfolio,
  type CashApplyResult,
  type CashBalance,
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

function formatCashApplyNote(result: CashApplyResult): string {
  if (result.adjusted) return result.note;
  if (result.note) return `Cash ledger: ${result.note}`;
  return '';
}

function formatChannelTag(channel: string | undefined): string {
  return channel != null && channel.length > 0 ? ` | channel: ${channel}` : '';
}

function formatCashSection(cash: CashBalance | null, cashTargetPct: number): string {
  const lines = ['── CASH ──'];
  if (cash == null) {
    lines.push(
      '  Cash: not recorded. Use set_cash so strategy can size vs dry powder and cash_target_pct.',
      `  Playbook cash target: ${cashTargetPct}% (unknown actual weight until cash is set).`,
    );
    return lines.join('\n');
  }
  lines.push(
    `  Cash: ${cash.amount.toFixed(2)} ${cash.currency} (updated ${cash.updated_at})${formatChannelTag(cash.channel)}`,
    `  Playbook cash target: ${cashTargetPct}% — compare after live NAV (portfolio_analyzer / save_snapshot).`,
  );
  return lines.join('\n');
}

/** Resolve optional channel for add/update: omit param keeps prior; empty clears. */
function resolveChannelParam(
  raw: string | undefined,
  previous: string | undefined,
  paramProvided: boolean,
): string | undefined {
  if (!paramProvided) return previous;
  return normalizeOptionalChannel(raw, 'channel');
}

function formatPortfolio(
  portfolio: Record<string, Holding>,
  cash: CashBalance | null,
  cashTargetPct: number,
): string {
  const keys = Object.keys(portfolio);
  if (keys.length === 0) {
    return [
      'Portfolio is empty. Use add_holding to add positions.',
      '',
      formatCashSection(cash, cashTargetPct),
    ].join('\n');
  }

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
      if (h.channel) lines.push(`    Channel: ${h.channel}`);
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
        `  ${key.padEnd(8)} | ${h.units} shares @ $${h.avg_price.toFixed(2)} | Cost: $${cost.toFixed(2)} | ${h.category ?? 'Uncategorized'}${formatChannelTag(h.channel)}`,
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
  lines.push('');
  lines.push(formatCashSection(cash, cashTargetPct));
  if (cash != null && contingentCash > 0) {
    const cover = cash.amount - contingentCash;
    lines.push(
      `  Short-put assignment cover: cash ${cash.amount.toFixed(2)} ${cash.currency} vs obligation $${contingentCash.toFixed(2)} → ` +
        (cover >= 0 ? `surplus ${cover.toFixed(2)}` : `shortfall ${Math.abs(cover).toFixed(2)}`),
    );
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
  quote_source?: 'manual' | 'yahoo';
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
  if (p.quote_source === 'manual' || p.quote_source === 'yahoo') {
    spec.quote_source = p.quote_source;
  }
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
      'units = contracts. mark = stored premium $ per contract. Live MTM: Yahoo chain for listed underlyings (auto), manual mark for private. ' +
      'quote_source=manual|yahoo optional. Contingent obligation (strike×mult×cts) is separate from MTM. ' +
      'Option portfolio key auto-builds as UNDERLYING-P|C-STRIKE-YYYYMMDD-L|S unless ticker is provided. ' +
      'When cash is recorded, equity/long buys DECREASE cash by cost/premium; short option opens INCREASE cash by premium credit. ' +
      'Updates adjust cash by the cost delta. Fails if cash would go negative. Pass adjust_cash=false only for historical import (no ledger). ' +
      'Optional channel tags the broker/custody source (e.g. moomoo, ibkr, webull); omit or empty when unassigned. ' +
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
      channel: Type.Optional(
        Type.String({
          description:
            'Broker / custody source (e.g. moomoo, ibkr, webull, tiger). Omit or empty when unassigned.',
        }),
      ),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) adjusts cash for this trade; false skips ledger (import/correction only).',
        }),
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
      quote_source: Type.Optional(
        Type.Union([Type.Literal('manual'), Type.Literal('yahoo')], {
          description:
            'Option only: manual = always stored mark (private/OTC); yahoo = require Yahoo chain match; omit = auto (Yahoo if listed, else mark).',
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
        channel?: string;
        adjust_cash?: boolean;
        instrument?: 'equity' | 'option';
        option_right?: 'call' | 'put';
        option_side?: 'long' | 'short';
        strike?: number;
        expiry?: string;
        multiplier?: number;
        underlying?: string;
        settlement?: 'physical' | 'cash';
        mark?: number;
        quote_source?: 'manual' | 'yahoo';
        underlying_mark?: number;
      };
      try {
        if (p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units <= 0) return fail('units must be positive.');

        const instrument = p.instrument ?? 'equity';
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        const adjustCash = p.adjust_cash !== false;
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');

        let key: string;
        let holding: Holding;

        if (instrument === 'option') {
          const option = parseOptionFromParams(p);
          if (p.quote_source) option.quote_source = p.quote_source;
          key = p.ticker?.trim()
            ? p.ticker.trim().toUpperCase()
            : buildOptionKey({
                underlying: option.underlying,
                right: option.right,
                strike: option.strike,
                expiry: option.expiry,
                side: option.side,
              });
          const channel = resolveChannelParam(p.channel, portfolio[key]?.channel, channelProvided);
          holding = {
            instrument: 'option',
            avg_price: p.avg_price,
            units: p.units,
            category: p.category ?? portfolio[key]?.category,
            option,
            ...(channel != null ? { channel } : {}),
          };
          assertHolding(key, holding);
        } else {
          if (!p.ticker?.trim()) {
            return fail('ticker is required for equity holdings.');
          }
          key = p.ticker.trim().toUpperCase();
          const channel = resolveChannelParam(p.channel, portfolio[key]?.channel, channelProvided);
          holding = {
            instrument: 'equity',
            avg_price: p.avg_price,
            units: p.units,
            category: p.category ?? portfolio[key]?.category,
            ...(channel != null ? { channel } : {}),
          };
          assertHolding(key, holding);
        }

        const isUpdate = key in portfolio;
        const before = isUpdate ? portfolio[key] : null;
        const today = new Date().toISOString().slice(0, 10);
        const cashResult = applyCashDelta(
          getCash(state),
          cashDeltaForHoldingChange(before, holding),
          today,
          adjustCash,
        );
        if (cashResult.adjusted && cashResult.cash != null) {
          setCash(state, cashResult.cash);
        }

        portfolio[key] = holding;
        setPortfolio(state, portfolio);

        state.log.push({
          ts: today,
          action: isUpdate ? 'holding_updated' : 'holding_added',
          ticker: key,
          instrument,
          avg_price: p.avg_price,
          units: p.units,
          category: p.category,
          channel: holding.channel,
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : undefined,
          cash_after: cashResult.cash?.amount,
          ...(instrument === 'option' ? { option: holding.option } : {}),
        });
        saveState(state);

        const action = isUpdate ? 'Updated' : 'Added';
        const cashLine = formatCashApplyNote(cashResult);
        const channelLine = holding.channel ? `Channel: ${holding.channel}\n` : '';
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
              (p.category ? `Category: ${p.category}\n` : '') +
              channelLine +
              (cashLine ? cashLine : ''),
            {
              ticker: key,
              holding,
              isUpdate,
              economics: e,
              cash: cashResult.cash,
              cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
              cashAdjusted: cashResult.adjusted,
            },
          );
        }

        const cost = p.avg_price * p.units;
        return ok(
          `${action} ${key}: ${p.units} shares @ $${p.avg_price.toFixed(2)} (cost: $${cost.toFixed(2)})${p.category ? ` [${p.category}]` : ''}${formatChannelTag(holding.channel)}` +
            (cashLine ? `\n${cashLine}` : ''),
          {
            ticker: key,
            avg_price: p.avg_price,
            units: p.units,
            category: p.category,
            channel: holding.channel,
            isUpdate,
            cash: cashResult.cash,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
            cashAdjusted: cashResult.adjusted,
          },
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
      "Remove a stock or option position from the user's portfolio. " +
      'When cash is recorded, credits cash by cost basis (equity/long premium) or reverses short premium credit. ' +
      'This is bookkeeping at cost, not live sale proceeds — pass adjust_cash=false to skip. ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({
        description: 'Portfolio key to remove (equity ticker or option key, e.g. SPACEX-P-90-20260807-S).',
      }),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) credits cash at cost basis; false skips ledger.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { ticker: string; adjust_cash?: boolean };
      try {
        const state = resolveInvestorFromChannel(p);
        const ticker = p.ticker.toUpperCase();
        const portfolio = getPortfolio(state);
        const adjustCash = p.adjust_cash !== false;

        if (!(ticker in portfolio)) {
          return fail(
            `Ticker "${ticker}" not found in portfolio. Current holdings: ${Object.keys(portfolio).join(', ') || 'none'}`,
          );
        }

        const removed = portfolio[ticker];
        const today = new Date().toISOString().slice(0, 10);
        const cashResult = applyCashDelta(
          getCash(state),
          cashDeltaForHoldingChange(removed, null),
          today,
          adjustCash,
        );
        if (cashResult.adjusted && cashResult.cash != null) {
          setCash(state, cashResult.cash);
        }

        delete portfolio[ticker];
        setPortfolio(state, portfolio);
        state.log.push({
          ts: today,
          action: 'holding_removed',
          ticker,
          avg_price: removed.avg_price,
          units: removed.units,
          instrument: removed.instrument ?? 'equity',
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : undefined,
          cash_after: cashResult.cash?.amount,
        });
        saveState(state);

        const kind = isOptionHolding(removed) ? 'option' : 'equity';
        const cashLine = formatCashApplyNote(cashResult);
        return ok(
          `Removed ${ticker} (${kind}: ${removed.units} @ $${removed.avg_price.toFixed(2)}).` +
            (cashLine ? `\n${cashLine}` : ''),
          {
            ticker,
            removed,
            cash: cashResult.cash,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
            cashAdjusted: cashResult.adjusted,
          },
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
      "Retrieve the user's saved portfolio (equities + options + cash). Pass telegram_user_id or slack_user_id from the message context.",
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        const cash = getCash(state);
        const cashTargetPct = getPlaybook(state).allocation.cash_target_pct;
        return ok(formatPortfolio(portfolio, cash, cashTargetPct), {
          portfolio,
          cash,
          count: Object.keys(portfolio).length,
        });
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const setCashTool: AgentTool = {
    name: 'set_cash',
    label: 'Set Cash',
    description:
      "Record the user's available cash balance for strategy (dry powder, cash weight vs cash_target_pct, short-put cover). " +
      'amount ≥ 0; currency required (e.g. USD, HKD) — no silent default. ' +
      'Optional channel tags the broker holding this cash (e.g. moomoo, ibkr); omit or empty when unassigned. ' +
      'Pass telegram_user_id or slack_user_id from the message context. Does not clear holdings.',
    parameters: Type.Object({
      ...channelIdParams,
      amount: Type.Number({
        description: 'Available cash amount (≥ 0). Settled / free cash for deployment.',
      }),
      currency: Type.String({
        description: 'Currency code (e.g. USD, HKD). Required — no default.',
      }),
      channel: Type.Optional(
        Type.String({
          description:
            'Broker / custody source for this cash (e.g. moomoo, ibkr). Omit or empty when unassigned.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { amount: number; currency: string; channel?: string };
      try {
        if (typeof p.amount !== 'number' || !Number.isFinite(p.amount)) {
          return fail('amount must be a finite number.');
        }
        if (p.amount < 0) return fail('amount must be ≥ 0.');
        if (!p.currency?.trim()) {
          return fail('currency is required (e.g. USD, HKD) — no silent default.');
        }

        const state = resolveInvestorFromChannel(p);
        const today = new Date().toISOString().slice(0, 10);
        const prev = getCash(state);
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        const channel = resolveChannelParam(p.channel, prev?.channel, channelProvided);
        const cash: CashBalance = {
          amount: p.amount,
          currency: p.currency.trim().toUpperCase(),
          updated_at: today,
          ...(channel != null ? { channel } : {}),
        };
        setCash(state, cash);
        state.log.push({
          ts: today,
          action: 'cash_set',
          amount: cash.amount,
          currency: cash.currency,
          channel: cash.channel,
        });
        saveState(state);

        const target = getPlaybook(state).allocation.cash_target_pct;
        return ok(
          `Cash set to ${cash.amount.toFixed(2)} ${cash.currency} (as of ${cash.updated_at})${formatChannelTag(cash.channel)}.\n` +
            `Playbook cash target: ${target}%. Use get_portfolio / portfolio_analyzer for weight vs target after live marks.`,
          { cash, cash_target_pct: target },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const clearCashTool: AgentTool = {
    name: 'clear_cash',
    label: 'Clear Cash',
    description:
      'Remove the recorded cash balance (cash becomes unknown). Requires confirm=true. ' +
      'Does not clear holdings. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      confirm: Type.Boolean({
        description: 'Must be true to proceed. Confirm with the user first.',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { confirm: boolean };
      try {
        if (!p.confirm) {
          return fail('Set confirm=true to clear recorded cash. Confirm with the user first.');
        }
        const state = resolveInvestorFromChannel(p);
        const prev = getCash(state);
        if (prev == null) {
          return fail('No cash is recorded. Nothing to clear.');
        }
        clearCash(state);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'cash_cleared',
          amount: prev.amount,
          currency: prev.currency,
        });
        saveState(state);
        return ok(
          `Cleared cash record (was ${prev.amount.toFixed(2)} ${prev.currency}). Cash is now unknown.`,
          { cleared: prev },
        );
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
      'When cash is recorded, changes to units/avg_price/side adjust cash by the cost/premium delta (mark-only MTM updates do not). ' +
      'Fails if cash would go negative. Pass adjust_cash=false to skip ledger. ' +
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
      channel: Type.Optional(
        Type.String({
          description:
            'Broker / custody source (e.g. moomoo, ibkr). Pass empty string to clear. Omit to leave unchanged.',
        }),
      ),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) applies cost/premium delta to cash; false skips ledger.',
        }),
      ),
      mark: Type.Optional(
        Type.Number({ description: 'Option only: new premium mark in $ per contract for MTM.' }),
      ),
      quote_source: Type.Optional(
        Type.Union([Type.Literal('manual'), Type.Literal('yahoo')], {
          description: 'Option only: manual | yahoo (omit = auto).',
        }),
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
        channel?: string;
        adjust_cash?: boolean;
        mark?: number;
        quote_source?: 'manual' | 'yahoo';
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
        const adjustCash = p.adjust_cash !== false;
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');

        if (!(ticker in portfolio)) {
          return fail(`Ticker "${ticker}" not found in portfolio. Use add_holding to create it first.`);
        }

        const existing = portfolio[ticker];
        if (p.avg_price != null && p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units != null && p.units <= 0) return fail('units must be positive.');

        const channel = resolveChannelParam(p.channel, existing.channel, channelProvided);
        let next: Holding;
        if (isOptionHolding(existing)) {
          if (!existing.option) {
            return fail(`Holding ${ticker} is instrument=option but option fields are missing.`);
          }
          const nextOption: OptionSpec = {
            ...existing.option,
            ...(p.mark != null ? { mark: p.mark } : {}),
            ...(p.quote_source != null ? { quote_source: p.quote_source } : {}),
            ...(p.underlying_mark != null ? { underlying_mark: p.underlying_mark } : {}),
            ...(p.strike != null ? { strike: p.strike } : {}),
            ...(p.expiry != null ? { expiry: p.expiry } : {}),
            ...(p.multiplier != null ? { multiplier: p.multiplier } : {}),
            ...(p.settlement != null ? { settlement: p.settlement } : {}),
            ...(p.option_side != null ? { side: p.option_side } : {}),
            ...(p.option_right != null ? { right: p.option_right } : {}),
          };
          next = {
            instrument: 'option',
            avg_price: p.avg_price ?? existing.avg_price,
            units: p.units ?? existing.units,
            category: p.category ?? existing.category,
            option: nextOption,
            ...(channel != null ? { channel } : {}),
          };
          assertHolding(ticker, next);
        } else {
          if (
            p.mark != null ||
            p.quote_source != null ||
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
          next = {
            instrument: 'equity',
            avg_price: p.avg_price ?? existing.avg_price,
            units: p.units ?? existing.units,
            category: p.category ?? existing.category,
            ...(channel != null ? { channel } : {}),
          };
          assertHolding(ticker, next);
        }

        const today = new Date().toISOString().slice(0, 10);
        const cashResult = applyCashDelta(
          getCash(state),
          cashDeltaForHoldingChange(existing, next),
          today,
          adjustCash,
        );
        if (cashResult.adjusted && cashResult.cash != null) {
          setCash(state, cashResult.cash);
        }

        portfolio[ticker] = next;
        setPortfolio(state, portfolio);
        state.log.push({
          ts: today,
          action: 'holding_updated',
          ticker,
          ...portfolio[ticker],
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : undefined,
          cash_after: cashResult.cash?.amount,
        });
        saveState(state);

        const h = portfolio[ticker];
        const cashLine = formatCashApplyNote(cashResult);
        if (isOptionHolding(h)) {
          const e = valuePosition(ticker, h);
          return ok(
            `Updated option ${ticker}: ${e.label}\n` +
              `Premium basis: $${e.premiumAbsolute.toFixed(2)} | Mark: $${e.price.toFixed(2)} | ` +
              `MTM: $${e.value.toFixed(2)} | P/L: ${e.pl >= 0 ? '+' : ''}$${e.pl.toFixed(2)}` +
              (e.contingentCashObligation > 0
                ? `\nContingent cash obligation: $${e.contingentCashObligation.toFixed(2)}`
                : '') +
              (cashLine ? `\n${cashLine}` : ''),
            {
              ticker,
              holding: h,
              economics: e,
              cash: cashResult.cash,
              cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
              cashAdjusted: cashResult.adjusted,
            },
          );
        }

        return ok(
          `Updated ${ticker}: ${h.units} shares @ $${h.avg_price.toFixed(2)} (cost: $${(h.avg_price * h.units).toFixed(2)})${h.category ? ` [${h.category}]` : ''}${formatChannelTag(h.channel)}` +
            (cashLine ? `\n${cashLine}` : ''),
          {
            ticker,
            holding: h,
            cash: cashResult.cash,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
            cashAdjusted: cashResult.adjusted,
          },
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

  return [
    addHolding,
    removeHolding,
    getPortfolioTool,
    updateHolding,
    clearPortfolio,
    setCashTool,
    clearCashTool,
  ];
}
