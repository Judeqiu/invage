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
 *   - top-level `cash`: optional CashBalance (missing → cash not recorded)
 *   - top-level `playbook`:  optional InvestmentPlaybook (missing → default)
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

export interface InvestorState extends UserState {
  portfolio?: Record<string, Holding>;
  /** Optional recorded cash; omit entirely when unknown. */
  cash?: CashBalance;
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
 * Returns recorded cash or null when the user has never set it.
 * Does not invent a zero balance.
 */
export function getCash(state: InvestorState): CashBalance | null {
  if (state.cash == null) return null;
  return assertCashBalance(state.cash);
}

/** Persist a validated cash balance (overwrites previous). */
export function setCash(state: InvestorState, cash: CashBalance): void {
  state.cash = assertCashBalance(cash);
}

/** Remove recorded cash (cash becomes unknown again). */
export function clearCash(state: InvestorState): void {
  delete state.cash;
}

/** Fail-fast validation for a cash balance object. */
export function assertCashBalance(raw: unknown): CashBalance {
  if (raw == null || typeof raw !== 'object') {
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
  /** Null when cash was unknown — no ledger write. */
  cash: CashBalance | null;
  /** Applied cash delta (0 when skipped or unknown). */
  cashDelta: number;
  /** Whether cash ledger was updated. */
  adjusted: boolean;
  /** Human reason when not adjusted. */
  note: string;
}

/**
 * Apply a cash delta to recorded cash. Fail-fast if result would be negative.
 * When cash is unknown (null), does not invent a balance — returns adjusted=false.
 *
 * @param adjustCash When false, skip ledger even if cash is recorded (import/correction).
 */
export function applyCashDelta(
  cash: CashBalance | null,
  cashDelta: number,
  updatedAt: string,
  adjustCash: boolean,
): CashApplyResult {
  if (!Number.isFinite(cashDelta)) {
    throw new Error('cashDelta must be a finite number.');
  }
  if (!adjustCash) {
    return {
      cash,
      cashDelta: 0,
      adjusted: false,
      note: 'adjust_cash=false — cash ledger not changed.',
    };
  }
  if (cash == null) {
    return {
      cash: null,
      cashDelta: 0,
      adjusted: false,
      note: 'Cash not recorded — set_cash first so buys deduct dry powder.',
    };
  }
  if (cashDelta === 0) {
    return {
      cash,
      cashDelta: 0,
      adjusted: false,
      note: 'No cash impact (cost/premium unchanged).',
    };
  }
  const nextAmount = cash.amount + cashDelta;
  if (nextAmount < 0) {
    throw new Error(
      `Insufficient cash: have ${cash.amount.toFixed(2)} ${cash.currency}, ` +
        `need ${(-cashDelta).toFixed(2)} more for this trade ` +
        `(delta ${cashDelta.toFixed(2)}). Top up with set_cash or reduce size.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error('updatedAt must be YYYY-MM-DD.');
  }
  const next: CashBalance = {
    amount: nextAmount,
    currency: cash.currency,
    updated_at: updatedAt,
  };
  if (cash.channel != null) next.channel = cash.channel;
  return {
    cash: next,
    cashDelta,
    adjusted: true,
    note:
      cashDelta < 0
        ? `Cash −${(-cashDelta).toFixed(2)} ${cash.currency} → ${next.amount.toFixed(2)} ${cash.currency}`
        : `Cash +${cashDelta.toFixed(2)} ${cash.currency} → ${next.amount.toFixed(2)} ${cash.currency}`,
  };
}

/**
 * Strategy helpers when cash is recorded.
 * positionsValue = sum of position MTM; cash is added only when recorded.
 * Returns null cash fields when cash is unknown (never invent 0 for weight).
 */
export function cashStrategyMetrics(
  cash: CashBalance | null,
  positionsValue: number,
  cashTargetPct: number,
): {
  cash: CashBalance | null;
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
  if (cash == null) {
    return {
      cash: null,
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
