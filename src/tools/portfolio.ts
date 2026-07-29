import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { saveState } from 'utarus';
import type { Holding, OptionSpec } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  buildOptionKey,
  formatOptionLabel,
  holdingBaseKey,
  isOptionHolding,
  normalizeOptionalChannel,
  resolveLookupHoldingKey,
  resolveUpsertHoldingKey,
  valuePosition,
} from '../market/position-value.js';
import {
  applyCashDelta,
  assertFixedDeposit,
  cashDeltaForHoldingChange,
  cashSlotKey,
  clearCash,
  clearDeposits,
  findCashForChannel,
  findDepositById,
  generateDepositId,
  getCashes,
  getDeposits,
  getPlaybook,
  getPortfolio,
  removeDeposit,
  setCash,
  setCashes,
  setPortfolio,
  totalCash,
  totalDepositsPrincipal,
  upsertDeposit,
  type CashApplyResult,
  type CashBalance,
  type FixedDeposit,
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

function formatCashSection(cashes: CashBalance[], cashTargetPct: number): string {
  const lines = ['── CASH ──'];
  if (cashes.length === 0) {
    lines.push(
      '  Cash: not recorded. Use set_cash so strategy can size vs dry powder and cash_target_pct.',
      `  Playbook cash target: ${cashTargetPct}% (unknown actual weight until cash is set).`,
    );
    return lines.join('\n');
  }
  if (cashes.length === 1) {
    const cash = cashes[0];
    lines.push(
      `  Cash: ${cash.amount.toFixed(2)} ${cash.currency} (updated ${cash.updated_at})${formatChannelTag(cash.channel)}`,
    );
  } else {
    lines.push('  Cash by channel:');
    for (const c of cashes) {
      const ch = cashSlotKey(c.channel) || '(unassigned)';
      lines.push(
        `    ${ch}: ${c.amount.toFixed(2)} ${c.currency} (updated ${c.updated_at})`,
      );
    }
    const total = totalCash(cashes);
    if (total != null) {
      lines.push(
        `  Total cash: ${total.amount.toFixed(2)} ${total.currency}`,
      );
    }
  }
  lines.push(
    `  Playbook cash target: ${cashTargetPct}% — compare after live NAV (portfolio_analyzer / save_snapshot).`,
  );
  return lines.join('\n');
}

function daysRemaining(endDate: string, today: string): number {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(now)) {
    throw new Error(`Invalid date for days remaining: end=${endDate} today=${today}`);
  }
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

function formatDepositsSection(deposits: FixedDeposit[]): string {
  const lines = ['── FIXED DEPOSITS ──'];
  if (deposits.length === 0) {
    lines.push(
      '  None. Use add_deposit to record locked term deposits (principal in NAV, not free cash).',
    );
    return lines.join('\n');
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const d of deposits) {
    const days = daysRemaining(d.end_date, today);
    const matured = d.end_date < today;
    const label = d.label ? ` "${d.label}"` : '';
    lines.push(
      `  ${d.id}${label}${formatChannelTag(d.channel)}`,
      `    Principal: ${d.amount.toFixed(2)} ${d.currency} | Interest (full term): ${d.interest.toFixed(2)} ${d.currency}`,
      `    Term: ${d.start_date} → ${d.end_date}` +
        (matured ? ' · MATURED' : ` · ${days} day${days === 1 ? '' : 's'} remaining`),
    );
  }
  const total = totalDepositsPrincipal(deposits);
  if (total != null) {
    const interestSum = deposits.reduce((s, d) => s + d.interest, 0);
    lines.push(
      `  Total principal (in NAV): ${total.amount.toFixed(2)} ${total.currency}`,
      `  Total interest at maturity (not in NAV v1): ${interestSum.toFixed(2)} ${total.currency}`,
      '  Note: deposits are locked — not deployable dry powder; free cash is under CASH.',
    );
  }
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
  cashes: CashBalance[],
  cashTargetPct: number,
  deposits: FixedDeposit[] = [],
): string {
  const keys = Object.keys(portfolio);
  if (keys.length === 0) {
    return [
      'Portfolio is empty. Use add_holding to add positions.',
      '',
      formatCashSection(cashes, cashTargetPct),
      '',
      formatDepositsSection(deposits),
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
  lines.push(formatCashSection(cashes, cashTargetPct));
  const total = totalCash(cashes);
  if (total != null && contingentCash > 0) {
    const cover = total.amount - contingentCash;
    lines.push(
      `  Short-put assignment cover: cash ${total.amount.toFixed(2)} ${total.currency} vs obligation $${contingentCash.toFixed(2)} → ` +
        (cover >= 0 ? `surplus ${cover.toFixed(2)}` : `shortfall ${Math.abs(cover).toFixed(2)}`),
    );
  }
  lines.push('');
  lines.push(formatDepositsSection(deposits));
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
      'Optional channel tags the broker/custody source (e.g. moomoo, ibkr, webull, jude_futu); omit or empty when unassigned. ' +
      'Same ticker under different channels is allowed — keys become TICKER@channel (e.g. TSLA@cmbyonglong and TSLA@jude_futu). ' +
      'Pass telegram_user_id or slack_user_id from the message context — never ask the user for it.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.Optional(
        Type.String({
          description:
            'Bare equity ticker (e.g. AAPL) or optional option-key override. Do not embed @channel here — pass channel separately. Map key becomes TICKER@channel when channel is set.',
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
          const baseKey = p.ticker?.trim()
            ? holdingBaseKey(p.ticker.trim().toUpperCase())
            : buildOptionKey({
                underlying: option.underlying,
                right: option.right,
                strike: option.strike,
                expiry: option.expiry,
                side: option.side,
              });
          const channelParam = channelProvided
            ? normalizeOptionalChannel(p.channel, 'channel')
            : undefined;
          key = resolveUpsertHoldingKey(portfolio, baseKey, channelParam, channelProvided);
          // When channel omitted and a unique lot exists, keep its channel tag.
          const channel = channelProvided
            ? channelParam
            : portfolio[key]?.channel;
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
          const baseKey = holdingBaseKey(p.ticker.trim().toUpperCase());
          const channelParam = channelProvided
            ? normalizeOptionalChannel(p.channel, 'channel')
            : undefined;
          key = resolveUpsertHoldingKey(portfolio, baseKey, channelParam, channelProvided);
          const channel = channelProvided
            ? channelParam
            : portfolio[key]?.channel;
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
        // Ledger against the holding's channel so multi-broker cash stays isolated.
        const cashResult = applyCashDelta(
          getCashes(state),
          cashDeltaForHoldingChange(before, holding),
          today,
          adjustCash,
          holding.channel,
        );
        if (cashResult.adjusted) {
          setCashes(state, cashResult.cashes);
        }

        portfolio[key] = holding;
        setPortfolio(state, portfolio);

        const cashAfter = totalCash(cashResult.cashes);
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
          cash_after: cashAfter?.amount,
          cash_channel: cashResult.adjusted ? cashResult.cash?.channel : undefined,
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
              cashes: cashResult.cashes,
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
            cashes: cashResult.cashes,
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
        description:
          'Portfolio key to remove: bare ticker when unique, full key (e.g. TSLA@cmbyonglong), or option key (e.g. SPACEX-P-90-20260807-S). Use channel when the same ticker exists under multiple brokers.',
      }),
      channel: Type.Optional(
        Type.String({
          description:
            'Broker channel to disambiguate when the same ticker exists under multiple brokers. Omit when ticker is already a full key or unique.',
        }),
      ),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) credits cash at cost basis; false skips ledger.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { ticker: string; channel?: string; adjust_cash?: boolean };
      try {
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        const adjustCash = p.adjust_cash !== false;
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        const ticker = resolveLookupHoldingKey(
          portfolio,
          p.ticker,
          channelProvided ? normalizeOptionalChannel(p.channel, 'channel') : undefined,
          channelProvided,
        );

        const removed = portfolio[ticker];
        const today = new Date().toISOString().slice(0, 10);
        const cashResult = applyCashDelta(
          getCashes(state),
          cashDeltaForHoldingChange(removed, null),
          today,
          adjustCash,
          removed.channel,
        );
        if (cashResult.adjusted) {
          setCashes(state, cashResult.cashes);
        }

        delete portfolio[ticker];
        setPortfolio(state, portfolio);
        const cashAfter = totalCash(cashResult.cashes);
        state.log.push({
          ts: today,
          action: 'holding_removed',
          ticker,
          avg_price: removed.avg_price,
          units: removed.units,
          instrument: removed.instrument ?? 'equity',
          channel: removed.channel,
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : undefined,
          cash_after: cashAfter?.amount,
          cash_channel: cashResult.adjusted ? cashResult.cash?.channel : undefined,
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
            cashes: cashResult.cashes,
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
      "Retrieve the user's saved portfolio (equities + options + cash by channel + fixed deposits). " +
      'Cash may list multiple broker channels. Fixed deposits are locked principal (in NAV, not free cash). ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({ ...channelIdParams }),
    async execute(_id, raw) {
      const p = raw as ChannelIds;
      try {
        const state = resolveInvestorFromChannel(p);
        const portfolio = getPortfolio(state);
        const cashes = getCashes(state);
        const deposits = getDeposits(state);
        const cash = totalCash(cashes);
        const cashTargetPct = getPlaybook(state).allocation.cash_target_pct;
        return ok(formatPortfolio(portfolio, cashes, cashTargetPct, deposits), {
          portfolio,
          cash,
          cashes,
          deposits,
          count: Object.keys(portfolio).length,
          deposit_count: deposits.length,
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
      "Record available cash for strategy (dry powder, cash weight vs cash_target_pct, short-put cover). " +
      'amount ≥ 0; currency required (e.g. USD, HKD) — no silent default. ' +
      'Optional channel tags the broker holding this cash (e.g. jude_futu, cmbyonglong, moomoo, ibkr). ' +
      'Multi-channel: set_cash UPSERTS by channel — other channels keep their balances (does not overwrite). ' +
      'Omit or empty channel when unassigned (only one unassigned cash slot). ' +
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
            'Broker / custody source for this cash (e.g. jude_futu, cmbyonglong, moomoo). ' +
            'Upserts this channel only; other channel cash is preserved. Omit or empty when unassigned.',
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
        // set_cash always writes the channel from this call (or unassigned if omitted).
        // Do NOT inherit previous single-slot channel — that overwrote multi-channel cash.
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        const channel = channelProvided
          ? normalizeOptionalChannel(p.channel, 'channel')
          : undefined;
        const cash: CashBalance = {
          amount: p.amount,
          currency: p.currency.trim().toUpperCase(),
          updated_at: today,
          ...(channel != null ? { channel } : {}),
        };
        setCash(state, cash);
        const cashes = getCashes(state);
        state.log.push({
          ts: today,
          action: 'cash_set',
          amount: cash.amount,
          currency: cash.currency,
          channel: cash.channel,
          cash_slots: cashes.length,
        });
        saveState(state);

        const target = getPlaybook(state).allocation.cash_target_pct;
        const total = totalCash(cashes);
        const multiNote =
          cashes.length > 1 && total != null
            ? `\nAll cash channels (${cashes.length}): total ${total.amount.toFixed(2)} ${total.currency}.`
            : '';
        return ok(
          `Cash set to ${cash.amount.toFixed(2)} ${cash.currency} (as of ${cash.updated_at})${formatChannelTag(cash.channel)}.` +
            multiNote +
            `\nPlaybook cash target: ${target}%. Use get_portfolio / portfolio_analyzer for weight vs target after live marks.`,
          { cash, cashes, cash_target_pct: target },
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
      'Remove recorded cash. With no channel: clears ALL cash (becomes unknown). ' +
      'With channel: clears only that channel slot (other channels kept). Requires confirm=true. ' +
      'Does not clear holdings. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      confirm: Type.Boolean({
        description: 'Must be true to proceed. Confirm with the user first.',
      }),
      channel: Type.Optional(
        Type.String({
          description:
            'If set, clear only this channel\'s cash. Omit to clear all cash records.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { confirm: boolean; channel?: string };
      try {
        if (!p.confirm) {
          return fail('Set confirm=true to clear recorded cash. Confirm with the user first.');
        }
        const state = resolveInvestorFromChannel(p);
        const before = getCashes(state);
        if (before.length === 0) {
          return fail('No cash is recorded. Nothing to clear.');
        }
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        if (channelProvided) {
          const ch = normalizeOptionalChannel(p.channel, 'channel');
          const key = cashSlotKey(ch);
          const target = before.find((c) => cashSlotKey(c.channel) === key);
          if (target == null) {
            const labels = before.map((c) => cashSlotKey(c.channel) || '(unassigned)').join(', ');
            return fail(
              `No cash for channel "${key || '(unassigned)'}". Recorded: ${labels}.`,
            );
          }
          clearCash(state, ch ?? '');
          state.log.push({
            ts: new Date().toISOString().slice(0, 10),
            action: 'cash_cleared',
            amount: target.amount,
            currency: target.currency,
            channel: target.channel,
          });
          saveState(state);
          const remaining = getCashes(state);
          return ok(
            `Cleared cash for channel "${key || '(unassigned)'}" ` +
              `(was ${target.amount.toFixed(2)} ${target.currency}). ` +
              (remaining.length > 0
                ? `${remaining.length} other cash channel(s) remain.`
                : 'Cash is now unknown.'),
            { cleared: target, cashes: remaining },
          );
        }

        const total = totalCash(before);
        clearCash(state);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'cash_cleared',
          amount: total?.amount,
          currency: total?.currency,
          cash_slots: before.length,
        });
        saveState(state);
        return ok(
          `Cleared all cash records (${before.length} slot${before.length === 1 ? '' : 's'}` +
            (total != null ? `, total was ${total.amount.toFixed(2)} ${total.currency}` : '') +
            '). Cash is now unknown.',
          { cleared: before },
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
      'Same ticker may exist under multiple channels — pass full key (TICKER@channel) or channel to disambiguate. ' +
      'Changing channel re-keys the position (fails if the target key already exists). ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      ticker: Type.String({
        description:
          'Portfolio key: bare ticker when unique, full key (e.g. TSLA@cmbyonglong), or option key.',
      }),
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
        const portfolio = getPortfolio(state);
        const adjustCash = p.adjust_cash !== false;
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        // Lookup uses channel only when it identifies which lot to edit; re-key uses resolved next channel.
        const oldKey = resolveLookupHoldingKey(
          portfolio,
          p.ticker,
          // When channel is provided for update, it may mean "move to this channel" rather than lookup.
          // Prefer matching by full key / unique bare first; if ticker embeds @channel, that wins.
          undefined,
          false,
        );

        const existing = portfolio[oldKey];
        if (p.avg_price != null && p.avg_price <= 0) return fail('avg_price must be positive.');
        if (p.units != null && p.units <= 0) return fail('units must be positive.');

        const channel = resolveChannelParam(p.channel, existing.channel, channelProvided);
        const nextKey = buildHoldingKey(holdingBaseKey(oldKey), channel);
        if (nextKey !== oldKey && nextKey in portfolio) {
          return fail(
            `Cannot move holding to key "${nextKey}" — that key already exists. ` +
              `Remove or merge the target lot first.`,
          );
        }

        let next: Holding;
        if (isOptionHolding(existing)) {
          if (!existing.option) {
            return fail(`Holding ${oldKey} is instrument=option but option fields are missing.`);
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
          assertHolding(nextKey, next);
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
              `Holding ${oldKey} is equity. To convert to an option, remove it and add_holding with instrument=option.`,
            );
          }
          next = {
            instrument: 'equity',
            avg_price: p.avg_price ?? existing.avg_price,
            units: p.units ?? existing.units,
            category: p.category ?? existing.category,
            ...(channel != null ? { channel } : {}),
          };
          assertHolding(nextKey, next);
        }

        const today = new Date().toISOString().slice(0, 10);
        // Debit/credit the channel on the *resulting* holding (channel moves with the position).
        const cashResult = applyCashDelta(
          getCashes(state),
          cashDeltaForHoldingChange(existing, next),
          today,
          adjustCash,
          next.channel,
        );
        if (cashResult.adjusted) {
          setCashes(state, cashResult.cashes);
        }

        if (nextKey !== oldKey) {
          delete portfolio[oldKey];
        }
        portfolio[nextKey] = next;
        setPortfolio(state, portfolio);
        const cashAfter = totalCash(cashResult.cashes);
        state.log.push({
          ts: today,
          action: 'holding_updated',
          ticker: nextKey,
          ...(nextKey !== oldKey ? { previous_ticker: oldKey } : {}),
          ...portfolio[nextKey],
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : undefined,
          cash_after: cashAfter?.amount,
          cash_channel: cashResult.adjusted ? cashResult.cash?.channel : undefined,
        });
        saveState(state);

        const h = portfolio[nextKey];
        const cashLine = formatCashApplyNote(cashResult);
        const rekeyNote = nextKey !== oldKey ? ` (re-keyed from ${oldKey})` : '';
        if (isOptionHolding(h)) {
          const e = valuePosition(nextKey, h);
          return ok(
            `Updated option ${nextKey}${rekeyNote}: ${e.label}\n` +
              `Premium basis: $${e.premiumAbsolute.toFixed(2)} | Mark: $${e.price.toFixed(2)} | ` +
              `MTM: $${e.value.toFixed(2)} | P/L: ${e.pl >= 0 ? '+' : ''}$${e.pl.toFixed(2)}` +
              (e.contingentCashObligation > 0
                ? `\nContingent cash obligation: $${e.contingentCashObligation.toFixed(2)}`
                : '') +
              (cashLine ? `\n${cashLine}` : ''),
            {
              ticker: nextKey,
              previous_ticker: nextKey !== oldKey ? oldKey : undefined,
              holding: h,
              economics: e,
              cash: cashResult.cash,
              cashes: cashResult.cashes,
              cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
              cashAdjusted: cashResult.adjusted,
            },
          );
        }

        return ok(
          `Updated ${nextKey}${rekeyNote}: ${h.units} shares @ $${h.avg_price.toFixed(2)} (cost: $${(h.avg_price * h.units).toFixed(2)})${h.category ? ` [${h.category}]` : ''}${formatChannelTag(h.channel)}` +
            (cashLine ? `\n${cashLine}` : ''),
          {
            ticker: nextKey,
            previous_ticker: nextKey !== oldKey ? oldKey : undefined,
            holding: h,
            cash: cashResult.cash,
            cashes: cashResult.cashes,
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

  const addDepositTool: AgentTool = {
    name: 'add_deposit',
    label: 'Add Fixed Deposit',
    description:
      'Record a fixed-term deposit under a broker channel. Principal counts in NAV but is NOT free cash. ' +
      'Interest is the full-term total amount (not a rate). Multiple deposits per channel allowed. ' +
      'When adjust_cash=true (default) and cash is recorded, deducts principal from matching channel cash. ' +
      'Pass adjust_cash=false for historical import. Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      amount: Type.Number({ description: 'Principal amount (≥ 0).' }),
      interest: Type.Number({ description: 'Full-term interest amount (≥ 0), not annual rate.' }),
      currency: Type.String({ description: 'Currency code (e.g. USD, HKD). Required — no default.' }),
      start_date: Type.String({ description: 'Term start date YYYY-MM-DD.' }),
      end_date: Type.String({ description: 'Term end date YYYY-MM-DD (≥ start_date).' }),
      channel: Type.Optional(
        Type.String({
          description:
            'Broker / custody source (e.g. jude_futu, moomoo). Omit or empty when unassigned.',
        }),
      ),
      id: Type.Optional(
        Type.String({
          description:
            'Stable deposit id. Omit to auto-generate fd-{channel|default}-{YYYYMMDD}[-n].',
        }),
      ),
      label: Type.Optional(Type.String({ description: 'Optional human label (product name).' })),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) deducts principal from channel cash; false skips ledger.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        amount: number;
        interest: number;
        currency: string;
        start_date: string;
        end_date: string;
        channel?: string;
        id?: string;
        label?: string;
        adjust_cash?: boolean;
      };
      try {
        const state = resolveInvestorFromChannel(p);
        const today = new Date().toISOString().slice(0, 10);
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        const channel = channelProvided
          ? normalizeOptionalChannel(p.channel, 'channel')
          : undefined;
        const existing = getDeposits(state);
        let id: string;
        if (p.id != null && String(p.id).trim().length > 0) {
          id = String(p.id).trim();
          if (findDepositById(existing, id) != null) {
            return fail(
              `Deposit id "${id}" already exists. Use update_deposit to change it, or pick a new id.`,
            );
          }
        } else {
          id = generateDepositId(channel, p.start_date, existing);
        }

        const deposit = assertFixedDeposit({
          id,
          amount: p.amount,
          interest: p.interest,
          currency: p.currency,
          start_date: p.start_date,
          end_date: p.end_date,
          updated_at: today,
          ...(channel != null ? { channel } : {}),
          ...(p.label != null ? { label: p.label } : {}),
        });

        const adjustCash = p.adjust_cash !== false;
        const cashesBefore = getCashes(state);
        if (adjustCash && cashesBefore.length > 0) {
          const slot = findCashForChannel(cashesBefore, deposit.channel);
          if (slot != null && slot.currency !== deposit.currency) {
            throw new Error(
              `Deposit currency ${deposit.currency} does not match cash currency ${slot.currency} on channel. ` +
                'No silent FX conversion.',
            );
          }
        }
        const cashResult = applyCashDelta(
          cashesBefore,
          -deposit.amount,
          today,
          adjustCash,
          deposit.channel,
        );
        if (cashResult.adjusted) {
          setCashes(state, cashResult.cashes);
        }

        upsertDeposit(state, deposit);
        state.log.push({
          ts: today,
          action: 'deposit_added',
          deposit_id: deposit.id,
          amount: deposit.amount,
          interest: deposit.interest,
          currency: deposit.currency,
          channel: deposit.channel,
          start_date: deposit.start_date,
          end_date: deposit.end_date,
          cash_adjusted: cashResult.adjusted,
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : 0,
        });
        saveState(state);

        const cashNote = formatCashApplyNote(cashResult);
        return ok(
          `Added fixed deposit ${deposit.id}: principal ${deposit.amount.toFixed(2)} ${deposit.currency}, ` +
            `interest ${deposit.interest.toFixed(2)} ${deposit.currency}, ` +
            `${deposit.start_date} → ${deposit.end_date}` +
            formatChannelTag(deposit.channel) +
            (deposit.label ? ` (${deposit.label})` : '') +
            '.\nPrincipal is in NAV but not free cash.' +
            (cashNote ? `\n${cashNote}` : ''),
          {
            deposit,
            deposits: getDeposits(state),
            cashes: cashResult.cashes,
            cashAdjusted: cashResult.adjusted,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const updateDepositTool: AgentTool = {
    name: 'update_deposit',
    label: 'Update Fixed Deposit',
    description:
      'Update an existing fixed deposit by id (amount, interest, currency, dates, channel, label). ' +
      'When amount changes and adjust_cash=true (default), applies principal delta to matching channel cash. ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String({ description: 'Deposit id to update.' }),
      amount: Type.Optional(Type.Number({ description: 'New principal (≥ 0).' })),
      interest: Type.Optional(Type.Number({ description: 'New full-term interest (≥ 0).' })),
      currency: Type.Optional(Type.String({ description: 'New currency code.' })),
      start_date: Type.Optional(Type.String({ description: 'New start date YYYY-MM-DD.' })),
      end_date: Type.Optional(Type.String({ description: 'New end date YYYY-MM-DD.' })),
      channel: Type.Optional(
        Type.String({
          description:
            'Broker channel. Pass empty string to clear. Omit to leave unchanged.',
        }),
      ),
      label: Type.Optional(
        Type.String({
          description: 'Label. Pass empty string to clear. Omit to leave unchanged.',
        }),
      ),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) applies principal delta; false skips ledger.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        id: string;
        amount?: number;
        interest?: number;
        currency?: string;
        start_date?: string;
        end_date?: string;
        channel?: string;
        label?: string;
        adjust_cash?: boolean;
      };
      try {
        if (!p.id?.trim()) return fail('id is required.');
        const state = resolveInvestorFromChannel(p);
        const existing = findDepositById(getDeposits(state), p.id);
        if (existing == null) {
          return fail(`Deposit id "${p.id.trim()}" not found.`);
        }
        const today = new Date().toISOString().slice(0, 10);
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        const labelProvided = Object.prototype.hasOwnProperty.call(raw, 'label');
        const nextChannel = channelProvided
          ? normalizeOptionalChannel(p.channel, 'channel')
          : existing.channel;
        let nextLabel = existing.label;
        if (labelProvided) {
          if (p.label == null || String(p.label).trim().length === 0) {
            nextLabel = undefined;
          } else {
            nextLabel = String(p.label).trim();
          }
        }

        const next = assertFixedDeposit({
          id: existing.id,
          amount: p.amount ?? existing.amount,
          interest: p.interest ?? existing.interest,
          currency: p.currency ?? existing.currency,
          start_date: p.start_date ?? existing.start_date,
          end_date: p.end_date ?? existing.end_date,
          updated_at: today,
          ...(nextChannel != null ? { channel: nextChannel } : {}),
          ...(nextLabel != null ? { label: nextLabel } : {}),
        });

        const amountDelta = existing.amount - next.amount; // +cash when principal shrinks
        const adjustCash = p.adjust_cash !== false;
        // Ledger on the NEW channel for amount change.
        const cashChannel = next.channel ?? existing.channel;
        let cashResult: CashApplyResult = {
          cashes: getCashes(state),
          cash: totalCash(getCashes(state)),
          cashDelta: 0,
          adjusted: false,
          note: 'No cash impact (principal unchanged).',
        };
        if (amountDelta !== 0) {
          const cashesBefore = getCashes(state);
          if (adjustCash && cashesBefore.length > 0) {
            const slot = findCashForChannel(cashesBefore, cashChannel);
            if (slot != null && slot.currency !== next.currency) {
              throw new Error(
                `Deposit currency ${next.currency} does not match cash currency ${slot.currency}. ` +
                  'No silent FX conversion.',
              );
            }
          }
          cashResult = applyCashDelta(
            cashesBefore,
            amountDelta,
            today,
            adjustCash,
            cashChannel,
          );
          if (cashResult.adjusted) {
            setCashes(state, cashResult.cashes);
          }
        }

        upsertDeposit(state, next);
        state.log.push({
          ts: today,
          action: 'deposit_updated',
          deposit_id: next.id,
          amount: next.amount,
          interest: next.interest,
          currency: next.currency,
          channel: next.channel,
          cash_adjusted: cashResult.adjusted,
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : 0,
        });
        saveState(state);

        const cashNote = formatCashApplyNote(cashResult);
        return ok(
          `Updated deposit ${next.id}: principal ${next.amount.toFixed(2)} ${next.currency}, ` +
            `interest ${next.interest.toFixed(2)}, ${next.start_date} → ${next.end_date}` +
            formatChannelTag(next.channel) +
            '.' +
            (cashNote ? `\n${cashNote}` : ''),
          {
            deposit: next,
            deposits: getDeposits(state),
            cashes: cashResult.cashes,
            cashAdjusted: cashResult.adjusted,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const removeDepositTool: AgentTool = {
    name: 'remove_deposit',
    label: 'Remove Fixed Deposit',
    description:
      'Remove a fixed deposit by id. When adjust_cash=true (default) and cash is recorded, ' +
      'credits principal back to the deposit channel cash (interest is NOT auto-credited in v1). ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      id: Type.String({ description: 'Deposit id to remove.' }),
      adjust_cash: Type.Optional(
        Type.Boolean({
          description:
            'When cash is recorded: true (default) credits principal to channel cash; false skips ledger.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { id: string; adjust_cash?: boolean };
      try {
        if (!p.id?.trim()) return fail('id is required.');
        const state = resolveInvestorFromChannel(p);
        const existing = findDepositById(getDeposits(state), p.id);
        if (existing == null) {
          return fail(`Deposit id "${p.id.trim()}" not found.`);
        }
        const today = new Date().toISOString().slice(0, 10);
        const adjustCash = p.adjust_cash !== false;
        const cashResult = applyCashDelta(
          getCashes(state),
          existing.amount,
          today,
          adjustCash,
          existing.channel,
        );
        if (cashResult.adjusted) {
          setCashes(state, cashResult.cashes);
        }
        removeDeposit(state, existing.id);
        state.log.push({
          ts: today,
          action: 'deposit_removed',
          deposit_id: existing.id,
          amount: existing.amount,
          interest: existing.interest,
          currency: existing.currency,
          channel: existing.channel,
          cash_adjusted: cashResult.adjusted,
          cash_delta: cashResult.adjusted ? cashResult.cashDelta : 0,
        });
        saveState(state);
        const cashNote = formatCashApplyNote(cashResult);
        return ok(
          `Removed deposit ${existing.id} (principal ${existing.amount.toFixed(2)} ${existing.currency}).` +
            ' Interest was not auto-credited — record separately if received.' +
            (cashNote ? `\n${cashNote}` : ''),
          {
            removed: existing,
            deposits: getDeposits(state),
            cashes: cashResult.cashes,
            cashAdjusted: cashResult.adjusted,
            cashDelta: cashResult.adjusted ? cashResult.cashDelta : 0,
          },
        );
      } catch (e) {
        return failFrom(e);
      }
    },
  };

  const clearDepositsTool: AgentTool = {
    name: 'clear_deposits',
    label: 'Clear Fixed Deposits',
    description:
      'Remove fixed deposits. With no channel: clears ALL deposits. ' +
      'With channel: clears only that channel\'s deposits. Requires confirm=true. ' +
      'Does not adjust cash (use remove_deposit for ledgered single removes). ' +
      'Pass telegram_user_id or slack_user_id from the message context.',
    parameters: Type.Object({
      ...channelIdParams,
      confirm: Type.Boolean({
        description: 'Must be true to proceed. Confirm with the user first.',
      }),
      channel: Type.Optional(
        Type.String({
          description:
            "If set, clear only this channel's deposits. Omit to clear all deposits.",
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { confirm: boolean; channel?: string };
      try {
        if (!p.confirm) {
          return fail('Set confirm=true to clear fixed deposits. Confirm with the user first.');
        }
        const state = resolveInvestorFromChannel(p);
        const before = getDeposits(state);
        if (before.length === 0) {
          return fail('No fixed deposits recorded. Nothing to clear.');
        }
        const channelProvided = Object.prototype.hasOwnProperty.call(raw, 'channel');
        if (channelProvided) {
          const ch = normalizeOptionalChannel(p.channel, 'channel');
          const key = cashSlotKey(ch);
          const targets = before.filter((d) => cashSlotKey(d.channel) === key);
          if (targets.length === 0) {
            const labels = [
              ...new Set(before.map((d) => cashSlotKey(d.channel) || '(unassigned)')),
            ].join(', ');
            return fail(
              `No deposits for channel "${key || '(unassigned)'}". Recorded channels: ${labels}.`,
            );
          }
          clearDeposits(state, ch ?? '');
          state.log.push({
            ts: new Date().toISOString().slice(0, 10),
            action: 'deposits_cleared',
            channel: ch,
            count: targets.length,
          });
          saveState(state);
          const remaining = getDeposits(state);
          return ok(
            `Cleared ${targets.length} deposit(s) for channel "${key || '(unassigned)'}". ` +
              (remaining.length > 0
                ? `${remaining.length} other deposit(s) remain.`
                : 'No deposits left.'),
            { cleared: targets, deposits: remaining },
          );
        }

        clearDeposits(state);
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'deposits_cleared',
          count: before.length,
        });
        saveState(state);
        return ok(
          `Cleared all fixed deposits (${before.length}).`,
          { cleared: before },
        );
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
    addDepositTool,
    updateDepositTool,
    removeDepositTool,
    clearDepositsTool,
  ];
}
