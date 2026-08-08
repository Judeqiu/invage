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
 *   - top-level `deposits`: optional FixedDeposit[] (fixed-term deposits; not free cash)
 *   - top-level `playbook`:  optional InvestmentPlaybook (missing → default)
 *   - household treasury (optional): see `household-state.ts`
 *     treasury, properties, liabilities, cash_flows, projection_assumptions, scenarios
 *
 * Cash may be stored as a single object (legacy / one channel) or an array
 * of balances (one entry per broker channel). `set_cash` upserts by channel
 * key so multi-broker dry powder is preserved.
 *
 * Fixed deposits are locked principal (count in NAV, not deployable cash).
 * Multiple deposits per channel are allowed; each has a unique `id`.
 */

import type { UserState } from 'utarus';
import type { Holding, InstrumentKind } from '../market/types.js';
import {
  isEquityHolding,
  isFundHolding,
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

/** Resolve holding instrument kind (equity when omitted). */
export function holdingInstrument(h: Holding): InstrumentKind {
  if (isOptionHolding(h)) return 'option';
  if (isFundHolding(h)) return 'fund';
  if (isEquityHolding(h)) return 'equity';
  throw new Error(`Unknown holding instrument: ${String(h.instrument)}`);
}

/**
 * Merge a new purchase into an existing lot (same portfolio map key / channel).
 *
 * `add_holding` **appends** shares/units/contracts and computes a
 * **weighted-average** cost basis. It does **not** replace the prior lot.
 * Use `update_holding` to set absolute units/avg_price (corrections / full re-import).
 *
 * Cash impact of the merge: only the purchase notional (via
 * {@link cashDeltaForHoldingChange}(existing, result)).
 */
export function accumulateHoldingBuy(existing: Holding, purchase: Holding): Holding {
  const exKind = holdingInstrument(existing);
  const puKind = holdingInstrument(purchase);
  if (exKind !== puKind) {
    throw new Error(
      `Cannot add ${puKind} onto existing ${exKind} lot. ` +
        `remove_holding first, then add_holding with the new instrument.`,
    );
  }
  if (!(existing.units > 0) || !Number.isFinite(existing.units)) {
    throw new Error('accumulateHoldingBuy: existing units must be positive and finite.');
  }
  if (!(purchase.units > 0) || !Number.isFinite(purchase.units)) {
    throw new Error('accumulateHoldingBuy: purchase units must be positive and finite.');
  }
  if (!(existing.avg_price > 0) || !Number.isFinite(existing.avg_price)) {
    throw new Error('accumulateHoldingBuy: existing avg_price must be positive and finite.');
  }
  if (!(purchase.avg_price > 0) || !Number.isFinite(purchase.avg_price)) {
    throw new Error('accumulateHoldingBuy: purchase avg_price must be positive and finite.');
  }

  const totalUnits = existing.units + purchase.units;
  const totalCost =
    existing.avg_price * existing.units + purchase.avg_price * purchase.units;
  const avg_price = totalCost / totalUnits;
  if (!(avg_price > 0) || !Number.isFinite(avg_price)) {
    throw new Error('accumulateHoldingBuy: blended avg_price must be positive and finite.');
  }

  const category = purchase.category ?? existing.category;
  const channel = purchase.channel ?? existing.channel;

  if (exKind === 'option') {
    if (!existing.option || !purchase.option) {
      throw new Error('accumulateHoldingBuy: option holding missing option fields.');
    }
    // Contract identity lives in the map key; keep existing option fields.
    // MTM mark: prefer existing (live mark) unless purchase carried an explicit mark
    // different from its trade premium (caller sets mark only when updating MTM).
    const mark =
      purchase.option.mark !== purchase.avg_price
        ? purchase.option.mark
        : existing.option.mark;
    return {
      instrument: 'option',
      avg_price,
      units: totalUnits,
      category,
      ...(channel != null ? { channel } : {}),
      option: {
        ...existing.option,
        mark,
        // Prefer purchase quote_source / underlying_mark when provided on the buy.
        ...(purchase.option.quote_source != null
          ? { quote_source: purchase.option.quote_source }
          : {}),
        ...(purchase.option.underlying_mark != null
          ? { underlying_mark: purchase.option.underlying_mark }
          : {}),
      },
    };
  }

  if (exKind === 'fund') {
    if (!existing.fund || !purchase.fund) {
      throw new Error('accumulateHoldingBuy: fund holding missing fund fields.');
    }
    if (existing.fund.quote_source !== purchase.fund.quote_source) {
      throw new Error(
        `Cannot accumulate fund buy: quote_source mismatch ` +
          `(existing=${existing.fund.quote_source}, purchase=${purchase.fund.quote_source}). ` +
          `Use update_holding or remove+re-add.`,
      );
    }
    const fund = {
      quote_source: existing.fund.quote_source,
      name: purchase.fund.name ?? existing.fund.name,
      // Keep prior NAV for manual funds unless purchase supplies a new mark.
      mark:
        purchase.fund.mark != null ? purchase.fund.mark : existing.fund.mark,
    };
    return {
      instrument: 'fund',
      avg_price,
      units: totalUnits,
      category,
      ...(channel != null ? { channel } : {}),
      fund,
    };
  }

  // equity
  return {
    instrument: 'equity',
    avg_price,
    units: totalUnits,
    category,
    ...(channel != null ? { channel } : {}),
  };
}

/**
 * Settled / free cash available for deployment (not a holding).
 * Missing top-level `cash` means cash is unknown — never invent 0.
 *
 * Multi-broker + multi-currency: one CashBalance per
 * {@link cashBalanceKey}(channel, currency). Same channel may hold SGD and USD
 * as separate free-cash sleeves. Unassigned (no channel) allows one slot per currency.
 */
export interface CashBalance {
  /** Available cash amount. Must be finite and ≥ 0. */
  amount: number;
  /**
   * Currency code (e.g. USD, HKD). Required when cash is recorded —
   * no silent default. Multi-channel cash may use different currencies;
   * aggregated totals require explicit FX rates into a reporting currency
   * (see {@link totalCash} options / live FX on dashboard).
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

/**
 * Fixed-term bank/broker deposit (not free cash).
 * Principal counts in NAV; interest is full-term total (display only in v1).
 */
export interface FixedDeposit {
  /** Unique id across all deposits for this user. */
  id: string;
  /** Principal ≥ 0. */
  amount: number;
  /** Full-term interest amount ≥ 0 (not annual rate). */
  interest: number;
  /** Currency code (e.g. USD, HKD). Required — no silent default. */
  currency: string;
  /** Term start, YYYY-MM-DD. */
  start_date: string;
  /** Term end, YYYY-MM-DD; must be ≥ start_date. */
  end_date: string;
  /** Date last mutated, YYYY-MM-DD. */
  updated_at: string;
  /**
   * Broker / custody source (e.g. jude_futu, moomoo).
   * Omit or empty when unassigned — no silent default.
   */
  channel?: string;
  /** Optional human label (e.g. product name). */
  label?: string;
}

export interface InvestorState extends UserState {
  portfolio?: Record<string, Holding>;
  /** Optional recorded cash; omit entirely when unknown. Single or multi-channel. */
  cash?: CashStorage;
  /** Optional fixed deposits; omit when none. Multiple allowed per channel. */
  deposits?: FixedDeposit[];
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
 * Identity key for a **channel** (deposits, channel filters): normalized name, or '' for unassigned.
 * Not unique for free cash when multi-currency — use {@link cashBalanceKey} for free-cash slots.
 */
export function cashSlotKey(channel: string | undefined | null): string {
  if (channel == null) return '';
  const t = String(channel).trim();
  return t.length === 0 ? '' : t;
}

/**
 * Free-cash slot identity: channel + currency.
 * Unassigned USD → `@USD`. Channel dbs + SGD → `dbs@SGD`.
 */
export function cashBalanceKey(
  channel: string | undefined | null,
  currency: string,
): string {
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new Error('cashBalanceKey: currency is required (e.g. USD, SGD).');
  }
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(ccy)) {
    throw new Error(`cashBalanceKey: currency must be 3–4 letters (got "${currency}").`);
  }
  return `${cashSlotKey(channel)}@${ccy}`;
}

/** Human label for a free-cash slot, e.g. `dbs/USD` or `(unassigned)/SGD`. */
export function formatCashSlotLabel(c: Pick<CashBalance, 'channel' | 'currency'>): string {
  const ch = cashSlotKey(c.channel);
  const ccy = c.currency.trim().toUpperCase();
  return `${ch.length > 0 ? ch : '(unassigned)'}/${ccy}`;
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
 * Empty array means cash unknown.
 * Fails fast on duplicate (channel, currency) slots — multi-ccy per channel is allowed.
 * Lossless for legacy single-object and multi-channel one-ccy-per-channel shapes.
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
    const key = cashBalanceKey(c.channel, c.currency);
    if (seen.has(key)) {
      throw new Error(
        `Duplicate cash entry for ${formatCashSlotLabel(c)}. ` +
          `Each (channel, currency) may have only one free-cash balance.`,
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

/** Distinct uppercase currency codes present in cash balances. */
export function cashCurrencies(cashes: CashBalance[]): string[] {
  return [...new Set(cashes.map((c) => c.currency.trim().toUpperCase()))].sort();
}

export interface MultiCurrencySumOptions {
  /** Target currency for the sum (e.g. treasury.reporting_currency). */
  reportingCurrency: string;
  /**
   * Units of reporting currency per 1 unit of each foreign currency.
   * Same-currency entries need not appear (treated as 1).
   */
  fxRates: Record<string, number>;
}

function convertAmount(
  amount: number,
  currency: string,
  reportingCurrency: string,
  fxRates: Record<string, number>,
  context: string,
): number {
  const ccy = currency.trim().toUpperCase();
  const rep = reportingCurrency.trim().toUpperCase();
  if (ccy === rep) return amount;
  const rate = fxRates[ccy];
  if (rate == null) {
    throw new Error(
      `Missing FX rate for ${ccy}→${rep} (${context}). ` +
        `Provide units of ${rep} per 1 ${ccy}.`,
    );
  }
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new Error(`Invalid FX rate for ${ccy}→${rep}: ${rate}`);
  }
  return amount * rate;
}

/**
 * Sum multi-channel cash into one balance for NAV / strategy totals.
 * Returns null when no cash is recorded.
 *
 * Same currency → sum native amounts (no FX).
 * Mixed currencies → requires `opts` with reportingCurrency + fxRates
 * (units of reporting per 1 foreign). No silent 1:1 conversion.
 * Multi-channel totals omit `channel` (per-channel detail is in getCashes).
 */
export function totalCash(
  cashes: CashBalance[],
  opts?: MultiCurrencySumOptions,
): CashBalance | null {
  if (cashes.length === 0) return null;
  if (cashes.length === 1) {
    const only = cashes[0];
    if (opts == null) return only;
    const rep = opts.reportingCurrency.trim().toUpperCase();
    const amount = convertAmount(
      only.amount,
      only.currency,
      rep,
      opts.fxRates,
      `cash ${only.channel ?? 'unassigned'}`,
    );
    return {
      amount,
      currency: rep,
      updated_at: only.updated_at,
    };
  }

  const currencies = cashCurrencies(cashes);
  if (currencies.length === 1) {
    let amount = 0;
    let updated_at = cashes[0].updated_at;
    for (const c of cashes) {
      amount += c.amount;
      if (c.updated_at > updated_at) updated_at = c.updated_at;
    }
    if (opts == null) {
      return { amount, currency: currencies[0], updated_at };
    }
    const rep = opts.reportingCurrency.trim().toUpperCase();
    const converted = convertAmount(amount, currencies[0], rep, opts.fxRates, 'cash total');
    return { amount: converted, currency: rep, updated_at };
  }

  if (opts == null) {
    throw new Error(
      `Cannot sum cash across currencies (${cashes.map((x) => x.currency).join(', ')}). ` +
        'Set treasury.reporting_currency and convert with live FX, ' +
        'or record cash in one currency.',
    );
  }

  const rep = opts.reportingCurrency.trim().toUpperCase();
  let amount = 0;
  let updated_at = cashes[0].updated_at;
  for (const c of cashes) {
    amount += convertAmount(
      c.amount,
      c.currency,
      rep,
      opts.fxRates,
      `cash ${c.channel ?? 'unassigned'}`,
    );
    if (c.updated_at > updated_at) updated_at = c.updated_at;
  }
  return { amount, currency: rep, updated_at };
}

/**
 * Aggregate cash for strategy / NAV (same-currency only unless caller converts).
 * Multi-channel same ccy → summed. Mixed ccy without opts → throws.
 * Does not invent a zero balance.
 */
export function getCash(
  state: InvestorState,
  opts?: MultiCurrencySumOptions,
): CashBalance | null {
  return totalCash(getCashes(state), opts);
}

/** All free-cash slots on a channel (0..N; multi-currency). */
export function findCashesForChannel(
  cashes: CashBalance[],
  channel: string | undefined | null,
): CashBalance[] {
  const key = cashSlotKey(channel);
  return cashes.filter((c) => cashSlotKey(c.channel) === key);
}

/** Free-cash slot matching channel + currency, or null. */
export function findCashForSlot(
  cashes: CashBalance[],
  channel: string | undefined | null,
  currency: string,
): CashBalance | null {
  const key = cashBalanceKey(channel, currency);
  return cashes.find((c) => cashBalanceKey(c.channel, c.currency) === key) ?? null;
}

/**
 * Cash entry matching a channel when there is exactly one free-cash sleeve on it.
 * 0 slots → null. ≥2 sleeves (multi-ccy) → throw (ambiguous — use findCashForSlot).
 */
export function findCashForChannel(
  cashes: CashBalance[],
  channel: string | undefined | null,
): CashBalance | null {
  const slots = findCashesForChannel(cashes, channel);
  if (slots.length === 0) return null;
  if (slots.length === 1) return slots[0];
  const labels = slots.map((c) => formatCashSlotLabel(c)).join(', ');
  const want = cashSlotKey(channel) || '(unassigned)';
  throw new Error(
    `Ambiguous free cash on channel "${want}": ${labels}. ` +
      `Pass currency to select a slot (findCashForSlot).`,
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fail-fast validation for a fixed deposit. */
export function assertFixedDeposit(raw: unknown): FixedDeposit {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'deposit must be an object with id, amount, interest, currency, start_date, end_date, updated_at.',
    );
  }
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id.trim().length === 0) {
    throw new Error('deposit.id is required (non-empty string).');
  }
  const id = d.id.trim();
  if (typeof d.amount !== 'number' || !Number.isFinite(d.amount)) {
    throw new Error('deposit.amount must be a finite number.');
  }
  if (d.amount < 0) {
    throw new Error('deposit.amount must be ≥ 0.');
  }
  if (typeof d.interest !== 'number' || !Number.isFinite(d.interest)) {
    throw new Error('deposit.interest must be a finite number.');
  }
  if (d.interest < 0) {
    throw new Error('deposit.interest must be ≥ 0.');
  }
  if (typeof d.currency !== 'string' || d.currency.trim().length === 0) {
    throw new Error('deposit.currency is required (e.g. USD, HKD) — no silent default.');
  }
  const currency = d.currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) {
    throw new Error(`deposit.currency must be a 3–4 letter code (got "${d.currency}").`);
  }
  if (typeof d.start_date !== 'string' || !DATE_RE.test(d.start_date)) {
    throw new Error('deposit.start_date must be YYYY-MM-DD.');
  }
  if (typeof d.end_date !== 'string' || !DATE_RE.test(d.end_date)) {
    throw new Error('deposit.end_date must be YYYY-MM-DD.');
  }
  if (d.end_date < d.start_date) {
    throw new Error(
      `deposit.end_date (${d.end_date}) must be ≥ start_date (${d.start_date}).`,
    );
  }
  if (typeof d.updated_at !== 'string' || !DATE_RE.test(d.updated_at)) {
    throw new Error('deposit.updated_at must be YYYY-MM-DD.');
  }
  const channel = normalizeOptionalChannel(d.channel, 'deposit.channel');
  let label: string | undefined;
  if (d.label != null) {
    if (typeof d.label !== 'string') {
      throw new Error('deposit.label must be a string when provided.');
    }
    const t = d.label.trim();
    if (t.length > 0) label = t;
  }
  const result: FixedDeposit = {
    id,
    amount: d.amount,
    interest: d.interest,
    currency,
    start_date: d.start_date,
    end_date: d.end_date,
    updated_at: d.updated_at,
  };
  if (channel != null) result.channel = channel;
  if (label != null) result.label = label;
  return result;
}

/**
 * Normalize YAML deposits (array | missing) → validated FixedDeposit[].
 * Fails fast on duplicate ids.
 */
export function normalizeDeposits(raw: unknown): FixedDeposit[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('deposits must be an array of deposit objects (or omit when none).');
  }
  const deposits = raw.map((item, i) => {
    try {
      return assertFixedDeposit(item);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`deposits[${i}]: ${msg}`);
    }
  });
  const seen = new Set<string>();
  for (const d of deposits) {
    if (seen.has(d.id)) {
      throw new Error(`Duplicate deposit id "${d.id}". Each deposit id must be unique.`);
    }
    seen.add(d.id);
  }
  return deposits;
}

/** All recorded fixed deposits (empty when none). */
export function getDeposits(state: InvestorState): FixedDeposit[] {
  return normalizeDeposits(state.deposits ?? null);
}

/** Persist deposits list; deletes key when empty. */
export function setDeposits(state: InvestorState, deposits: FixedDeposit[]): void {
  const validated = normalizeDeposits(deposits);
  if (validated.length === 0) {
    delete state.deposits;
  } else {
    state.deposits = validated;
  }
}

/** Find deposit by id, or null. */
export function findDepositById(
  deposits: FixedDeposit[],
  id: string,
): FixedDeposit | null {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('deposit id is required.');
  }
  return deposits.find((d) => d.id === id.trim()) ?? null;
}

/**
 * Upsert one deposit by id. Other deposits are preserved.
 */
export function upsertDeposit(state: InvestorState, deposit: FixedDeposit): void {
  const entry = assertFixedDeposit(deposit);
  const rest = getDeposits(state).filter((d) => d.id !== entry.id);
  setDeposits(state, [...rest, entry]);
}

/**
 * Remove deposit by id. Fails if not found.
 */
export function removeDeposit(state: InvestorState, id: string): FixedDeposit {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('deposit id is required.');
  }
  const key = id.trim();
  const all = getDeposits(state);
  const found = all.find((d) => d.id === key);
  if (found == null) {
    throw new Error(`Deposit id "${key}" not found.`);
  }
  setDeposits(
    state,
    all.filter((d) => d.id !== key),
  );
  return found;
}

/**
 * Clear deposits. With no channel arg, clears all.
 * With channel (including empty string for unassigned), clears that channel only.
 */
export function clearDeposits(state: InvestorState, channel?: string | null): void {
  if (channel === undefined) {
    delete state.deposits;
    return;
  }
  const key = cashSlotKey(channel);
  const rest = getDeposits(state).filter((d) => cashSlotKey(d.channel) !== key);
  setDeposits(state, rest);
}

/** Distinct uppercase currency codes present in deposits. */
export function depositCurrencies(deposits: FixedDeposit[]): string[] {
  return [...new Set(deposits.map((d) => d.currency.trim().toUpperCase()))].sort();
}

/**
 * Sum deposit principals for NAV. Returns null when no deposits.
 * Same currency → native sum. Mixed currencies require `opts` (reporting + FX).
 */
export function totalDepositsPrincipal(
  deposits: FixedDeposit[],
  opts?: MultiCurrencySumOptions,
): { amount: number; currency: string } | null {
  if (deposits.length === 0) return null;
  const currencies = depositCurrencies(deposits);
  if (currencies.length === 1) {
    const amount = deposits.reduce((s, d) => s + d.amount, 0);
    if (opts == null) return { amount, currency: currencies[0] };
    const rep = opts.reportingCurrency.trim().toUpperCase();
    return {
      amount: convertAmount(amount, currencies[0], rep, opts.fxRates, 'deposits total'),
      currency: rep,
    };
  }
  if (opts == null) {
    throw new Error(
      `Cannot sum deposits across currencies (${deposits.map((x) => x.currency).join(', ')}). ` +
        'Set treasury.reporting_currency and convert with live FX, ' +
        'or record deposits in one currency.',
    );
  }
  const rep = opts.reportingCurrency.trim().toUpperCase();
  let amount = 0;
  for (const d of deposits) {
    amount += convertAmount(d.amount, d.currency, rep, opts.fxRates, `deposit ${d.id}`);
  }
  return { amount, currency: rep };
}

/**
 * Auto id: fd-{channel|default}-{YYYYMMDD} or with -2, -3… when taken.
 */
export function generateDepositId(
  channel: string | undefined | null,
  startDate: string,
  existing: Array<{ id: string }>,
): string {
  if (typeof startDate !== 'string' || !DATE_RE.test(startDate)) {
    throw new Error('startDate must be YYYY-MM-DD for generateDepositId.');
  }
  const ch = cashSlotKey(channel);
  const chPart = ch.length > 0 ? ch.replace(/[^a-zA-Z0-9_-]/g, '_') : 'default';
  const datePart = startDate.replace(/-/g, '');
  const base = `fd-${chPart}-${datePart}`;
  const taken = new Set(existing.map((d) => d.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
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
 * Upsert one free-cash balance by (channel, currency).
 * Other channels and other currencies on the same channel are preserved.
 */
export function setCash(state: InvestorState, cash: CashBalance): void {
  const entry = assertCashBalance(cash);
  const key = cashBalanceKey(entry.channel, entry.currency);
  const rest = getCashes(state).filter(
    (c) => cashBalanceKey(c.channel, c.currency) !== key,
  );
  setCashes(state, [...rest, entry]);
}

/**
 * Remove cash.
 * - No channel arg: clear all free cash (unknown again).
 * - Channel only: clear every currency on that channel.
 * - Channel + currency: clear one free-cash sleeve.
 */
export function clearCash(
  state: InvestorState,
  channel?: string | null,
  currency?: string | null,
): void {
  if (channel === undefined) {
    delete state.cash;
    return;
  }
  if (currency != null && String(currency).trim().length > 0) {
    const key = cashBalanceKey(channel, currency);
    const rest = getCashes(state).filter(
      (c) => cashBalanceKey(c.channel, c.currency) !== key,
    );
    setCashes(state, rest);
    return;
  }
  const chKey = cashSlotKey(channel);
  const rest = getCashes(state).filter((c) => cashSlotKey(c.channel) !== chKey);
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
 * Resolve free-cash currency for a ledger op.
 * Explicit currency wins; else exactly one sleeve on the channel; else fail.
 */
export function resolveCashCurrencyForChannel(
  cashes: CashBalance[],
  channel: string | undefined | null,
  currency?: string | null,
): string {
  if (currency != null && String(currency).trim().length > 0) {
    return String(currency).trim().toUpperCase();
  }
  const slots = findCashesForChannel(cashes, channel);
  if (slots.length === 1) return slots[0].currency;
  if (slots.length === 0) {
    const labels =
      cashes.length === 0
        ? 'none'
        : cashes.map((c) => formatCashSlotLabel(c)).join(', ');
    const want = cashSlotKey(channel) || '(unassigned)';
    throw new Error(
      `No free cash on channel "${want}" to infer currency. Recorded: ${labels}. ` +
        `Pass currency explicitly.`,
    );
  }
  throw new Error(
    `Ambiguous free cash currency on channel "${cashSlotKey(channel) || '(unassigned)'}": ` +
      `${slots.map((c) => formatCashSlotLabel(c)).join(', ')}. Pass currency explicitly.`,
  );
}

export interface ApplyCashDeltaOptions {
  /**
   * When true and cashDelta > 0, create the (channel, currency) slot if missing.
   * Default false (debits and credits require an existing slot, except transfer/mature helpers).
   */
  createIfMissing?: boolean;
}

/**
 * Apply a cash delta to the free-cash slot for `(channel, currency)`.
 * Fail-fast if the matched slot would go negative or currency would be mixed silently.
 *
 * When cash is unknown (empty list), does not invent a balance — adjusted=false.
 * When cash exists but not on the requested slot, fails fast (do not silently
 * debit another broker's or currency's dry powder).
 *
 * @param currency Optional when the channel has exactly one free-cash sleeve; required when multi-ccy.
 */
export function applyCashDelta(
  cashOrCashes: CashBalance | CashBalance[] | null,
  cashDelta: number,
  updatedAt: string,
  adjustCash: boolean,
  channel?: string | null,
  currency?: string | null,
  options?: ApplyCashDeltaOptions,
): CashApplyResult {
  if (!Number.isFinite(cashDelta)) {
    throw new Error('cashDelta must be a finite number.');
  }
  const cashes = asCashList(cashOrCashes);
  const createIfMissing = options?.createIfMissing === true;

  const resolveTarget = (): CashBalance | null => {
    if (cashes.length === 0) return null;
    if (currency != null && String(currency).trim().length > 0) {
      return findCashForSlot(cashes, channel, currency);
    }
    try {
      return findCashForChannel(cashes, channel);
    } catch {
      throw new Error(
        `Ambiguous free cash on channel "${cashSlotKey(channel) || '(unassigned)'}". ` +
          `Pass currency. Recorded: ${cashes.map((c) => formatCashSlotLabel(c)).join(', ')}.`,
      );
    }
  };

  // When not adjusting the ledger (or no delta), never fail on multi-ccy
  // ambiguity — the cash slot is only for optional reporting on the result.
  const peekCash = (): CashBalance | null => {
    if (cashes.length === 0) return null;
    try {
      return resolveTarget();
    } catch {
      return null;
    }
  };

  if (!adjustCash) {
    return {
      cashes,
      cash: peekCash(),
      cashDelta: 0,
      adjusted: false,
      note: 'adjust_cash=false — cash ledger not changed.',
    };
  }
  if (cashDelta === 0) {
    return {
      cashes,
      cash: peekCash(),
      cashDelta: 0,
      adjusted: false,
      note: 'No cash impact (cost/premium unchanged).',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error('updatedAt must be YYYY-MM-DD.');
  }

  // First free-cash credit ever (e.g. mature_deposit / transfer into empty books).
  const canCreate =
    createIfMissing &&
    cashDelta > 0 &&
    currency != null &&
    String(currency).trim().length > 0;

  if (cashes.length === 0 && !canCreate) {
    return {
      cashes: [],
      cash: null,
      cashDelta: 0,
      adjusted: false,
      note: 'Cash not recorded — set_cash first so buys deduct dry powder.',
    };
  }

  let ccy: string;
  if (canCreate && (cashes.length === 0 || currency != null && String(currency).trim())) {
    try {
      ccy =
        cashes.length === 0
          ? String(currency).trim().toUpperCase()
          : resolveCashCurrencyForChannel(cashes, channel, currency);
    } catch {
      ccy = String(currency).trim().toUpperCase();
    }
  } else {
    ccy = resolveCashCurrencyForChannel(cashes, channel, currency);
  }
  if (!/^[A-Z]{3,4}$/.test(ccy)) {
    throw new Error(`applyCashDelta: invalid currency "${ccy}".`);
  }

  let target = findCashForSlot(cashes, channel, ccy);

  if (target == null && canCreate) {
    const created: CashBalance = {
      amount: 0,
      currency: ccy,
      updated_at: updatedAt,
    };
    const ch = cashSlotKey(channel);
    if (ch.length > 0) created.channel = ch;
    target = created;
  }

  if (target == null) {
    const labels =
      cashes.length === 0
        ? 'none'
        : cashes.map((c) => formatCashSlotLabel(c)).join(', ');
    const want = formatCashSlotLabel({
      channel: cashSlotKey(channel) || undefined,
      currency: ccy,
    });
    throw new Error(
      `No free cash recorded for ${want}. Recorded: ${labels}. ` +
        `Use set_cash with matching channel and currency, or pass adjust_cash=false for import.`,
    );
  }

  const nextAmount = target.amount + cashDelta;
  if (nextAmount < 0) {
    throw new Error(
      `Insufficient cash on ${formatCashSlotLabel(target)}: have ${target.amount.toFixed(2)} ${target.currency}, ` +
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

  const balKey = cashBalanceKey(nextEntry.channel, nextEntry.currency);
  const hadSlot = cashes.some((c) => cashBalanceKey(c.channel, c.currency) === balKey);
  const nextCashes = hadSlot
    ? cashes.map((c) =>
        cashBalanceKey(c.channel, c.currency) === balKey ? nextEntry : c,
      )
    : [...cashes, nextEntry];

  const slotLabel = formatCashSlotLabel(nextEntry);
  return {
    cashes: nextCashes,
    cash: nextEntry,
    cashDelta,
    adjusted: true,
    note:
      cashDelta < 0
        ? `Cash −${(-cashDelta).toFixed(2)} ${nextEntry.currency} [${slotLabel}]` +
          ` → ${nextEntry.amount.toFixed(2)} ${nextEntry.currency}`
        : `Cash +${cashDelta.toFixed(2)} ${nextEntry.currency} [${slotLabel}]` +
          ` → ${nextEntry.amount.toFixed(2)} ${nextEntry.currency}`,
  };
}

/**
 * Atomic same-currency free-cash transfer between channels.
 * Net free cash in `currency` is unchanged.
 */
export function transferCash(
  state: InvestorState,
  args: {
    fromChannel?: string | null;
    toChannel?: string | null;
    amount: number;
    currency: string;
    updatedAt: string;
  },
): { from: CashBalance; to: CashBalance; cashes: CashBalance[] } {
  const { amount, currency, updatedAt } = args;
  if (!(amount > 0) || !Number.isFinite(amount)) {
    throw new Error('transferCash: amount must be a finite number > 0.');
  }
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(ccy)) {
    throw new Error(`transferCash: currency must be 3–4 letters (got "${currency}").`);
  }
  const fromKey = cashSlotKey(args.fromChannel);
  const toKey = cashSlotKey(args.toChannel);
  if (fromKey === toKey) {
    throw new Error(
      'transferCash: from_channel and to_channel must differ ' +
        `(got "${fromKey || '(unassigned)'}").`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt)) {
    throw new Error('transferCash: updatedAt must be YYYY-MM-DD.');
  }

  const cashes = getCashes(state);
  const debit = applyCashDelta(
    cashes,
    -amount,
    updatedAt,
    true,
    args.fromChannel,
    ccy,
  );
  if (!debit.adjusted || debit.cash == null) {
    throw new Error(
      debit.note ||
        `transferCash: could not debit ${amount} ${ccy} from ${fromKey || '(unassigned)'}.`,
    );
  }
  const credit = applyCashDelta(
    debit.cashes,
    amount,
    updatedAt,
    true,
    args.toChannel,
    ccy,
    { createIfMissing: true },
  );
  if (!credit.adjusted || credit.cash == null) {
    throw new Error(
      credit.note ||
        `transferCash: could not credit ${amount} ${ccy} to ${toKey || '(unassigned)'}.`,
    );
  }
  setCashes(state, credit.cashes);
  return { from: debit.cash, to: credit.cash, cashes: credit.cashes };
}

/**
 * Unlock fixed-deposit principal into free cash on the same channel + currency.
 * Partial amount allowed; full amount removes the deposit.
 * Interest is not auto-credited (v1).
 */
export function matureDeposit(
  state: InvestorState,
  args: {
    id: string;
    /** Principal to unlock; omit = full deposit amount. */
    amount?: number;
    updatedAt: string;
    adjustCash?: boolean;
  },
): {
  deposit: FixedDeposit | null;
  unlocked: number;
  removed: boolean;
  cash: CashBalance | null;
  cashes: CashBalance[];
  cashAdjusted: boolean;
} {
  const id = args.id.trim();
  if (!id) throw new Error('matureDeposit: id is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.updatedAt)) {
    throw new Error('matureDeposit: updatedAt must be YYYY-MM-DD.');
  }
  const existing = findDepositById(getDeposits(state), id);
  if (existing == null) {
    throw new Error(`matureDeposit: deposit id "${id}" not found.`);
  }
  const unlock =
    args.amount === undefined ? existing.amount : args.amount;
  if (!(unlock > 0) || !Number.isFinite(unlock)) {
    throw new Error('matureDeposit: amount must be a finite number > 0.');
  }
  if (unlock > existing.amount) {
    throw new Error(
      `matureDeposit: cannot unlock ${unlock} ${existing.currency}; ` +
        `principal is ${existing.amount} ${existing.currency}.`,
    );
  }

  const adjustCash = args.adjustCash !== false;
  let cashResult: CashApplyResult = {
    cashes: getCashes(state),
    cash: findCashForSlot(getCashes(state), existing.channel, existing.currency),
    cashDelta: 0,
    adjusted: false,
    note: '',
  };
  if (adjustCash) {
    cashResult = applyCashDelta(
      getCashes(state),
      unlock,
      args.updatedAt,
      true,
      existing.channel,
      existing.currency,
      { createIfMissing: true },
    );
    if (!cashResult.adjusted || cashResult.cash == null) {
      throw new Error(
        cashResult.note ||
          'matureDeposit: could not credit free cash for unlocked principal.',
      );
    }
    setCashes(state, cashResult.cashes);
  }

  const remaining = existing.amount - unlock;
  let deposit: FixedDeposit | null;
  let removed: boolean;
  if (remaining === 0) {
    removeDeposit(state, existing.id);
    deposit = null;
    removed = true;
  } else {
    deposit = {
      ...existing,
      amount: remaining,
      updated_at: args.updatedAt,
    };
    upsertDeposit(state, deposit);
    removed = false;
  }

  return {
    deposit,
    unlocked: unlock,
    removed,
    cash: cashResult.cash,
    cashes: cashResult.cashes,
    cashAdjusted: cashResult.adjusted,
  };
}

/**
 * Strategy helpers when cash is recorded.
 * positionsValue = sum of position MTM; cash is added only when recorded.
 * depositsPrincipal (optional) = sum of fixed-deposit principals (in NAV, not free cash).
 * Returns null cash fields when cash is unknown (never invent 0 for weight).
 *
 * Accepts a single CashBalance, multi list, or null.
 * Multi same-currency → sum. Multi mixed → pass opts with reporting + FX rates.
 */
export function cashStrategyMetrics(
  cashOrCashes: CashBalance | CashBalance[] | null,
  positionsValue: number,
  cashTargetPct: number,
  depositsPrincipal: number = 0,
  opts?: MultiCurrencySumOptions,
): {
  cash: CashBalance | null;
  cashes: CashBalance[];
  positionsValue: number;
  depositsPrincipal: number;
  /** NAV = positions + free cash? + deposits principal. */
  totalNav: number;
  /** Free cash weight % of totalNav; null when cash unknown. */
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
  if (!(typeof depositsPrincipal === 'number') || !Number.isFinite(depositsPrincipal)) {
    throw new Error('depositsPrincipal must be a finite number.');
  }
  if (depositsPrincipal < 0) {
    throw new Error('depositsPrincipal must be ≥ 0.');
  }
  const cashes = asCashList(cashOrCashes);
  const cash = totalCash(cashes, opts);
  const base = positionsValue + depositsPrincipal;
  if (cash == null) {
    return {
      cash: null,
      cashes: [],
      positionsValue,
      depositsPrincipal,
      totalNav: base,
      cashWeightPct: null,
      cashVsTargetPp: null,
      cashTargetPct,
    };
  }
  const totalNav = base + cash.amount;
  const cashWeightPct = totalNav !== 0 ? (cash.amount / totalNav) * 100 : 0;
  return {
    cash,
    cashes,
    positionsValue,
    depositsPrincipal,
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
