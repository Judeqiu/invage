/**
 * Investor portfolio + playbook extensions on top of the Utarus user YAML.
 *
 * YAML I/O (loadState / saveState) and per-channel lookups
 * (resolveUserBy{Slug,SlackUser,TelegramUser}) live in Utarus now — they
 * are not duplicated here. This module owns only the investor-specific
 * fields layered on top of the shared UserState.
 *
 * Domain fields:
 *   - top-level `portfolio`: map of ticker → Holding
 *   - top-level `cash`: optional CashBalance | CashBalance[] (missing → unknown)
 *   - top-level `playbook`:  optional InvestmentPlaybook (missing → default)
 *
 * Cash may be stored as a single object (legacy / one channel) or an array
 * of balances (one entry per broker channel). `set_cash` upserts by channel
 * key so multi-broker dry powder is preserved.
 */

import type { UserState } from 'utarus';
import type { Holding } from '../market/types.js';
import {
  isOptionHolding,
  normalizeOptionalChannel,
} from '../market/position-value.js';
import {
  applyPlaybookPatch,
  resolvePlaybook,
  type InvestmentPlaybook,
  type PlaybookPatch,
} from '../playbook/index.js';

export { normalizeOptionalChannel };

/**
 * Settled / free cash available for deployment (not a holding).
 * Missing top-level `cash` means cash is unknown — never invent 0.
 *
 * Multi-broker: one CashBalance per channel key (see {@link cashSlotKey}).
 * Unassigned cash (no channel) occupies the empty-string slot; only one
 * unassigned entry is allowed.
 */
export interface CashBalance {
  /** Available cash amount. Must be finite and ≥ 0. */
  amount: number;
  /**
   * Currency code (e.g. USD, HKD). Required when cash is recorded —
   * no silent default. NAV math treats amount in the same unit as
   * position marks when the agent combines them; multi-currency
   * conversion is not automatic.
   */
  currency: string;
  /** Date last set, YYYY-MM-DD. */
  updated_at: string;
  /**
   * Broker / custody source for multi-broker cash (e.g. moomoo, ibkr).
   * Omit or empty when unassigned — no silent default.
   */
  channel?: string;
}

/** YAML may store one object (legacy) or an array (multi-channel). */
export type CashStorage = CashBalance | CashBalance[];

export interface InvestorState extends UserState {
  portfolio?: Record<string, Holding>;
  /** Optional recorded cash; omit entirely when unknown. Single or multi-channel. */
  cash?: CashStorage;
  /** Optional per-user investment playbook; missing → DEFAULT_PLAYBOOK via getPlaybook. */
  playbook?: Partial<InvestmentPlaybook> | InvestmentPlaybook;
}

export function getPortfolio(state: InvestorState): Record<string, Holding> {
  return state.portfolio ?? {};
}

export function setPortfolio(state: InvestorState, portfolio: Record<string, Holding>): void {
  state.portfolio = portfolio;
}

/**
 * Identity key for a cash slot: normalized channel name, or '' for unassigned.
 * Used to upsert / match multi-channel cash without inventing broker names.
 */
export function cashSlotKey(channel: string | undefined | null): string {
  if (channel == null) return '';
  const t = String(channel).trim();
  return t.length === 0 ? '' : t;
}

/** Fail-fast validation for a cash balance object. */
export function assertCashBalance(raw: unknown): CashBalance {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('cash must be an object with amount, currency, updated_at.');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.amount !== 'number' || !Number.isFinite(c.amount)) {
    throw new Error('cash.amount must be a finite number.');
  }
  if (c.amount < 0) {
    throw new Error('cash.amount must be ≥ 0.');
  }
  if (typeof c.currency !== 'string' || c.currency.trim().length === 0) {
    throw new Error('cash.currency is required (e.g. USD, HKD) — no silent default.');
  }
  const currency = c.currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) {
    throw new Error(`cash.currency must be a 3–4 letter code (got "${c.currency}").`);
  }
  if (typeof c.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.updated_at)) {
    throw new Error('cash.updated_at must be YYYY-MM-DD.');
  }
  const channel = normalizeOptionalChannel(c.channel, 'cash.channel');
  const result: CashBalance = {
    amount: c.amount,
    currency,
    updated_at: c.updated_at,
  };
  if (channel != null) result.channel = channel;
  return result;
}

/**
 * Normalize YAML cash (object | array | missing) → validated CashBalance[].
 * Empty array means cash unknown. Fails fast on duplicate channel slots.
 */
export function normalizeCashes(raw: unknown): CashBalance[] {
  if (raw == null) return [];
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  const cashes = list.map((item, i) => {
    try {
      return assertCashBalance(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`cash[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const c of cashes) {
    const key = cashSlotKey(c.channel);
    if (seen.has(key)) {
      const label = key.length > 0 ? key : '(unassigned)';
      throw new Error(
        `Duplicate cash entry for channel "${label}". Each channel may have only one cash balance.`,
      );
    }
    seen.add(key);
  }
  return cashes;
}

/** All recorded cash balances (empty when cash unknown). */
export function getCashes(state: InvestorState): CashBalance[] {
  return normalizeCashes(state.cash ?? null);
}

/**
 * Sum multi-channel cash into one balance for NAV / strategy totals.
 * Returns null when no cash is recorded.
 * Fail-fast if entries use different currencies (no silent FX conversion).
 * Multi-channel totals omit `channel` (per-channel detail is in getCashes).
 */
export function totalCash(cashes: CashBalance[]): CashBalance | null {
  if (cashes.length === 0) return null;
  if (cashes.length === 1) return cashes[0];
  const currency = cashes[0].currency;
  for (const c of cashes) {
    if (c.currency !== currency) {
      throw new Error(
        `Cannot sum cash across currencies (${cashes.map((x) => x.currency).join(', ')}). ` +
          'Record cash in one currency or convert explicitly before combining.',
      );
    }
  }
  let amount = 0;
  let updated_at = cashes[0].updated_at;
  for (const c of cashes) {
    amount += c.amount;
    if (c.updated_at > updated_at) updated_at = c.updated_at;
  }
  return { amount, currency, updated_at };
}

/**
 * Aggregate cash for strategy / NAV.
 * Multi-channel → summed total (same currency only). Single → that entry.
 * Does not invent a zero balance.
 */
export function getCash(state: InvestorState): CashBalance | null {
  return totalCash(getCashes(state));
}

/** Cash entry matching a channel slot, or null. */
export function findCashForChannel(
  cashes: CashBalance[],
  channel: string | undefined | null,
): CashBalance | null {
  const key = cashSlotKey(channel);
  return cashes.find((c) => cashSlotKey(c.channel) === key) ?? null;
}

/**
 * Persist cash list. Writes a single object when length === 1 (legacy-friendly YAML),
 * an array when length ≥ 2, and deletes the key when empty.
 */
export function setCashes(state: InvestorState, cashes: CashBalance[]): void {
  const validated = normalizeCashes(cashes);
  if (validated.length === 0) {
    delete state.cash;
  } else if (validated.length === 1) {
    state.cash = validated[0];
  } else {
    state.cash = validated;
  }
}

/**
 * Upsert one cash balance by channel slot. Other channel balances are preserved.
 * This is the multi-channel-safe replacement for overwriting a single cash object.
 */
export function setCash(state: InvestorState, cash: CashBalance): void {
  const entry = assertCashBalance(cash);
  const key = cashSlotKey(entry.channel);
  const rest = getCashes(state).filter((c) => cashSlotKey(c.channel) !== key);
  setCashes(state, [...rest, entry]);
}

/**
 * Remove cash. With no channel arg, clears all recorded cash (unknown again).
 * With channel (including empty string for unassigned), clears that slot only.
 */
export function clearCash(state: InvestorState, channel?: string | null): void {
  if (channel === undefined) {
    delete state.cash;
    return;
  }
  const key = cashSlotKey(channel);
  const rest = getCashes(state).filter((c) => cashSlotKey(c.channel) !== key);
  setCashes(state, rest);
}

/**
 * Cash capital locked into a position at cost/premium (bookkeeping).
 *
 * - Equity: avg_price × units (cash paid to open long stock)
 * - Long option: avg_price × units (premium paid)
 * - Short option: −(avg_price × units) (premium received = cash in)
 *
 * Portfolio cash change when replacing old → next:
 *   cashDelta = cashDeployedForHolding(old) − cashDeployedForHolding(next)
 * (open equity: 0 − cost = −cost; close equity: cost − 0 = +cost)
 */
export function cashDeployedForHolding(h: Holding): number {
  if (!(h.avg_price > 0) || !Number.isFinite(h.avg_price)) {
    throw new Error('cashDeployedForHolding: avg_price must be positive.');
  }
  if (!(h.units > 0) || !Number.isFinite(h.units)) {
    throw new Error('cashDeployedForHolding: units must be positive.');
  }
  const notional = h.avg_price * h.units;
  if (isOptionHolding(h)) {
    if (!h.option) {
      throw new Error('cashDeployedForHolding: option holding missing option fields.');
    }
    if (h.option.side === 'short') return -notional;
    return notional;
  }
  return notional;
}

/**
 * Cash change when moving from `before` holding (or none) to `after` (or none).
 * Positive = cash increases (sale / short premium / reduce cost basis).
 * Negative = cash decreases (buy / long premium / increase cost basis).
 */
export function cashDeltaForHoldingChange(
  before: Holding | null,
  after: Holding | null,
): number {
  const prev = before != null ? cashDeployedForHolding(before) : 0;
  const next = after != null ? cashDeployedForHolding(after) : 0;
  return prev - next;
}

export interface CashApplyResult {
  /**
   * Updated list of all cash balances after the delta (empty = unknown).
   * Prefer this for multi-channel persistence.
   */
  cashes: CashBalance[];
  /**
   * The cash slot that was adjusted, or total when no slot change, or null
   * when cash remains unknown / unadjusted without a target slot.
   */
  cash: CashBalance | null;
  /** Applied cash delta (0 when skipped or unknown). */
  cashDelta: number;
  /** Whether cash ledger was updated. */
  adjusted: boolean;
  /** Human reason when not adjusted, or success note. */
  note: string;
}

function asCashList(cashOrCashes: CashBalance | CashBalance[] | null): CashBalance[] {
  if (cashOrCashes == null) return [];
  if (Array.isArray(cashOrCashes)) return normalizeCashes(cashOrCashes);
  return [assertCashBalance(cashOrCashes)];
}

/**
 * Apply a cash delta to the cash slot for `channel` (holding's broker tag).
 * Fail-fast if the matched slot would go negative.
 *
 * When cash is unknown (empty list), does not invent a balance — adjusted=false.
 * When cash exists but not on the requested channel, fails fast (do not silently
 * debit another broker's dry powder).
 *
 * @param cashOrCashes Single balance, multi list, or null (unknown).
 * @param channel Holding / trade channel; omit/empty = unassigned slot.
 * @param adjustCash When false, skip ledger even if cash is recorded.
 */
export function applyCashDelta(
  cashOrCashes: CashBalance | CashBalance[] | null,
  cashDelta: number,
  updatedAt: string,
  adjustCash: boolean,
  channel?: string | null,
): CashApplyResult {
  if (!Number.isFinite(cashDelta)) {
    throw new Error('cashDelta must be a finite number.');
  }
  const cashes = asCashList(cashOrCashes);
  if (!adjustCash) {
    return {
      cashes,
      cash: totalCash(cashes),
      cashDelta: 0,
      adjusted: false,
      note: 'adjust_cash=false — cash ledger not changed.',
    };
  }
  if (cashes.length === 0) {
    return {
      cashes: [],
      cash: null,
      cashDelta: 0,
      adjusted: false,
      note: 'Cash not recorded — set_cash first so buys deduct dry powder.',
    };
  }
  if (cashDelta === 0) {
    return {
      cashes,
      cash: totalCash(cashes),
      cashDelta: 0,
      adjusted: false,
      note: 'No cash impact (cost/premium unchanged).',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error('updatedAt must be YYYY-MM-DD.');
  }

  const key = cashSlotKey(channel);
  let target = findCashForChannel(cashes, channel);

  // Single un-tagged cash + trade with a channel: only allow when the sole
  // entry is also unassigned; otherwise require an explicit matching slot.
  if (target == null) {
    const labels = cashes.map((c) => cashSlotKey(c.channel) || '(unassigned)').join(', ');
    const want = key.length > 0 ? key : '(unassigned)';
    throw new Error(
      `No cash recorded for channel "${want}". Recorded cash channels: ${labels}. ` +
        `Use set_cash with channel matching the trade, or pass adjust_cash=false for import.`,
    );
  }

  const nextAmount = target.amount + cashDelta;
  if (nextAmount < 0) {
    const label = key.length > 0 ? key : 'unassigned';
    throw new Error(
      `Insufficient cash on channel "${label}": have ${target.amount.toFixed(2)} ${target.currency}, ` +
        `need ${(-cashDelta).toFixed(2)} more for this trade ` +
        `(delta ${cashDelta.toFixed(2)}). Top up with set_cash or reduce size.`,
    );
  }

  const nextEntry: CashBalance = {
    amount: nextAmount,
    currency: target.currency,
    updated_at: updatedAt,
  };
  if (target.channel != null) nextEntry.channel = target.channel;

  const nextCashes = cashes.map((c) =>
    cashSlotKey(c.channel) === key ? nextEntry : c,
  );

  return {
    cashes: nextCashes,
    cash: nextEntry,
    cashDelta,
    adjusted: true,
    note:
      cashDelta < 0
        ? `Cash −${(-cashDelta).toFixed(2)} ${nextEntry.currency}` +
          (key ? ` [${key}]` : '') +
          ` → ${nextEntry.amount.toFixed(2)} ${nextEntry.currency}`
        : `Cash +${cashDelta.toFixed(2)} ${nextEntry.currency}` +
          (key ? ` [${key}]` : '') +
          ` → ${nextEntry.amount.toFixed(2)} ${nextEntry.currency}`,
  };
}

/**
 * Strategy helpers when cash is recorded.
 * positionsValue = sum of position MTM; cash is added only when recorded.
 * Returns null cash fields when cash is unknown (never invent 0 for weight).
 *
 * Accepts a single CashBalance, multi list, or null. Multi is summed (same currency).
 */
export function cashStrategyMetrics(
  cashOrCashes: CashBalance | CashBalance[] | null,
  positionsValue: number,
  cashTargetPct: number,
): {
  cash: CashBalance | null;
  cashes: CashBalance[];
  positionsValue: number;
  /** NAV = positions + cash when cash known; else positions only. */
  totalNav: number;
  /** Cash weight % of totalNav; null when cash unknown. */
  cashWeightPct: number | null;
  /** cashWeightPct − cashTargetPct; null when cash unknown. */
  cashVsTargetPp: number | null;
  cashTargetPct: number;
} {
  if (!(typeof positionsValue === 'number') || !Number.isFinite(positionsValue)) {
    throw new Error('positionsValue must be a finite number.');
  }
  if (!(typeof cashTargetPct === 'number') || !Number.isFinite(cashTargetPct)) {
    throw new Error('cashTargetPct must be a finite number.');
  }
  const cashes = asCashList(cashOrCashes);
  const cash = totalCash(cashes);
  if (cash == null) {
    return {
      cash: null,
      cashes: [],
      positionsValue,
      totalNav: positionsValue,
      cashWeightPct: null,
      cashVsTargetPp: null,
      cashTargetPct,
    };
  }
  const totalNav = positionsValue + cash.amount;
  const cashWeightPct = totalNav !== 0 ? (cash.amount / totalNav) * 100 : 0;
  return {
    cash,
    cashes,
    positionsValue,
    totalNav,
    cashWeightPct,
    cashVsTargetPp: cashWeightPct - cashTargetPct,
    cashTargetPct,
  };
}

/** Resolved playbook (defaults filled). Fail-fast if stored playbook is invalid. */
export function getPlaybook(state: InvestorState): InvestmentPlaybook {
  return resolvePlaybook(state.playbook ?? null);
}

/** Persist a full resolved playbook (or patch merge). */
export function setPlaybook(state: InvestorState, playbook: InvestmentPlaybook): void {
  state.playbook = playbook;
}

/** Merge patch into current resolved playbook and store. Returns resolved result. */
export function updatePlaybook(state: InvestorState, patch: PlaybookPatch): InvestmentPlaybook {
  const next = applyPlaybookPatch(getPlaybook(state), patch);
  state.playbook = next;
  return next;
}
