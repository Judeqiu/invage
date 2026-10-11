/**
 * High-level books API for tools: household tx + dual-write helpers.
 */

import { randomUUID } from 'crypto';
import type { Holding } from '../market/types.js';
import type { InvestorState } from '../state/portfolio-state.js';
import {
  getCashes,
  getDeposits,
  getPortfolio,
  setCashes,
  setDeposits,
  type CashBalance,
  type FixedDeposit,
} from '../state/portfolio-state.js';
import {
  ensureAccount,
  ensureHousehold,
  ensureImportEquity,
  getBalanceMinor,
} from './accounts.js';
import type { BooksClient } from './db.js';
import { isBooksEnabled, withHouseholdTx } from './db.js';
import { importInvestorStateToBooks } from './import-yaml.js';
import {
  assertCurrency,
  formatChannelLabel,
  fromMinor,
  normalizeChannelKey,
  toMinor,
} from './money.js';
import {
  addDepositBooks,
  clearCashSleeve,
  matureDepositBooks,
  postCashAdjustment,
  postOpeningBalance,
  removeDepositBooks,
  transferCashBooks,
  type CashContraKind,
  type HouseholdContext,
} from './ops.js';
import { postEntry } from './post.js';
import { postHoldingClose, postHoldingOpen } from './position-ops.js';
import { listCashBalances, listDeposits, listJournalEntries } from './projections.js';

export { isBooksEnabled } from './db.js';

export function householdContextFromState(state: InvestorState): HouseholdContext {
  const id = state.user?.id;
  const slug = state.user?.slug;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('householdContextFromState: user.id required.');
  }
  if (typeof slug !== 'string' || !slug.trim()) {
    throw new Error('householdContextFromState: user.slug required.');
  }
  return { householdId: id.trim(), slug: slug.trim(), actor: slug.trim() };
}

export function newRequestId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * If books has no journals yet but YAML has money state, import opening balances.
 * Safe no-op when already seeded or YAML has nothing to import.
 * Must run before any books mutation so transfers see existing free cash.
 */
export async function ensureBooksSeeded(state: InvestorState): Promise<{
  seeded: boolean;
  journalCount: number;
}> {
  if (!isBooksEnabled()) {
    return { seeded: false, journalCount: 0 };
  }
  const ctx = householdContextFromState(state);
  return withHouseholdTx(ctx.householdId, async (client) => {
    await ensureHousehold(client, ctx.householdId, ctx.slug);
    const countRes = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE household_id = $1::uuid`,
      [ctx.householdId],
    );
    const journalCount = Number(countRes.rows[0]?.n ?? 0);
    if (journalCount > 0) {
      return { seeded: false, journalCount };
    }
    const cashes = getCashes(state);
    const deposits = getDeposits(state);
    const portfolio = getPortfolio(state);
    const hasMoney =
      cashes.length > 0 ||
      deposits.length > 0 ||
      Object.keys(portfolio).length > 0;
    if (!hasMoney) {
      return { seeded: false, journalCount: 0 };
    }
    await importInvestorStateToBooks(client, state, { force: true });
    const after = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries WHERE household_id = $1::uuid`,
      [ctx.householdId],
    );
    return { seeded: true, journalCount: Number(after.rows[0]?.n ?? 0) };
  });
}

/** Push ledger cash/deposits into YAML state (dual-write projection). */
export async function syncBooksProjectionsToState(
  state: InvestorState,
): Promise<{ cashes: CashBalance[]; deposits: FixedDeposit[] }> {
  const ctx = householdContextFromState(state);
  return withHouseholdTx(ctx.householdId, async (client) => {
    const cashes = await listCashBalances(client, ctx.householdId);
    const deposits = await listDeposits(client, ctx.householdId);
    setCashes(state, cashes);
    setDeposits(state, deposits);
    return { cashes, deposits };
  });
}

async function cashAccount(
  client: BooksClient,
  householdId: string,
  channel: string | undefined | null,
  currency: string,
) {
  return ensureAccount(client, {
    householdId,
    kind: 'cash',
    currency,
    channel,
    externalKey: '',
    label: `Cash ${formatChannelLabel(normalizeChannelKey(channel))}/${assertCurrency(currency)}`,
  });
}

/**
 * Apply signed free-cash delta (same semantics as applyCashDelta amount change).
 * Positive = cash in; negative = cash out.
 */
export async function booksApplyCashDelta(
  state: InvestorState,
  args: {
    channel?: string | null;
    currency: string;
    cashDelta: number;
    valueDate: string;
    requestId?: string;
    toolName?: string;
    createIfMissing?: boolean;
  },
): Promise<{ cashes: CashBalance[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('cash_delta');
  if (args.cashDelta === 0) {
    const { cashes } = await syncBooksProjectionsToState(state);
    return { cashes, requestId };
  }
  const ccy = assertCurrency(args.currency);
  const delta = toMinor(args.cashDelta);
  await withHouseholdTx(ctx.householdId, async (client) => {
    await ensureHousehold(client, ctx.householdId, ctx.slug);
    const cash = await cashAccount(client, ctx.householdId, args.channel, ccy);
    const current = await getBalanceMinor(client, cash.id);
    if (current === 0n && delta < 0n) {
      throw new Error(
        `No free cash recorded for ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy}. ` +
          `Post opening_balance / adjustment first, or pass adjust_cash=false for import.`,
      );
    }
    if (current === 0n && delta > 0n && args.createIfMissing !== true) {
      throw new Error(
        `No free cash recorded for ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy}. ` +
          `Use set_cash first, or pass createIfMissing for credits into empty sleeves.`,
      );
    }
    const next = current + delta;
    if (next < 0n) {
      throw new Error(
        `Insufficient cash on ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy}: ` +
          `have ${fromMinor(current)}, delta ${args.cashDelta}.`,
      );
    }
    const equity = await ensureImportEquity(client, ctx.householdId, ccy);
    await postEntry(client, {
      householdId: ctx.householdId,
      valueDate: args.valueDate,
      entryType: 'cash_delta',
      createdBy: ctx.actor,
      requestId,
      toolName: args.toolName ?? 'cash_delta',
      memo: `cash delta ${args.cashDelta} ${ccy}`,
      lines: [
        { accountId: cash.id, amountMinor: delta, currency: ccy },
        { accountId: equity.id, amountMinor: -delta, currency: ccy },
      ],
    });
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId };
}

/** First recognition of a cash sleeve (balance must be zero). */
export async function booksPostOpeningBalance(
  state: InvestorState,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    memo: string;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; requestId: string; amount: number }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('opening_balance');
  let amount = 0;
  await withHouseholdTx(ctx.householdId, async (client) => {
    const r = await postOpeningBalance(client, ctx, {
      ...args,
      requestId,
      toolName: 'post_opening_balance',
    });
    amount = r.amount;
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId, amount };
}

/**
 * Signed cash delta journal (never absolute set).
 * contra: adjustment | income | expense | clearing
 */
export async function booksPostAdjustment(
  state: InvestorState,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    memo: string;
    contra: CashContraKind;
    requestId?: string;
  },
): Promise<{
  cashes: CashBalance[];
  requestId: string;
  delta: number;
  balanceAfter: number;
  prior: number;
}> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('post_adjustment');
  let meta = { delta: 0, balanceAfter: 0, prior: 0 };
  await withHouseholdTx(ctx.householdId, async (client) => {
    const r = await postCashAdjustment(client, ctx, {
      ...args,
      requestId,
      toolName: 'post_adjustment',
    });
    meta = { delta: r.delta, balanceAfter: r.balanceAfter, prior: r.prior };
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId, ...meta };
}

export async function booksTransferCash(
  state: InvestorState,
  args: {
    fromChannel?: string | null;
    toChannel?: string | null;
    amount: number;
    currency: string;
    valueDate: string;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('transfer_cash');
  await withHouseholdTx(ctx.householdId, async (client) => {
    await transferCashBooks(client, ctx, {
      ...args,
      requestId,
      toolName: 'transfer_cash',
    });
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId };
}

export async function booksClearCashSleeve(
  state: InvestorState,
  args: {
    channel?: string | null;
    currency: string;
    valueDate: string;
    memo: string;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('clear_cash');
  await withHouseholdTx(ctx.householdId, async (client) => {
    await clearCashSleeve(client, ctx, {
      ...args,
      requestId,
      toolName: 'post_adjustment',
    });
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId };
}

export async function booksAddDeposit(
  state: InvestorState,
  args: {
    id: string;
    amount: number;
    interest: number;
    currency: string;
    channel?: string | null;
    startDate: string;
    endDate: string;
    label?: string;
    valueDate: string;
    adjustCash: boolean;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; deposits: FixedDeposit[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('add_deposit');
  await withHouseholdTx(ctx.householdId, async (client) => {
    await addDepositBooks(client, ctx, {
      ...args,
      requestId,
      toolName: 'add_deposit',
    });
  });
  const synced = await syncBooksProjectionsToState(state);
  return { ...synced, requestId };
}

export async function booksMatureDeposit(
  state: InvestorState,
  args: {
    id: string;
    amount?: number;
    valueDate: string;
    adjustCash: boolean;
    requestId?: string;
  },
): Promise<{
  cashes: CashBalance[];
  deposits: FixedDeposit[];
  unlocked: number;
  currency: string;
  channel: string;
  remaining: number;
  requestId: string;
}> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('mature_deposit');
  let meta = {
    unlocked: 0,
    currency: '',
    channel: '',
    remaining: 0,
  };
  await withHouseholdTx(ctx.householdId, async (client) => {
    const result = await matureDepositBooks(client, ctx, {
      ...args,
      requestId,
      toolName: 'mature_deposit',
    });
    meta = {
      unlocked: result.unlocked,
      currency: result.currency,
      channel: result.channel,
      remaining: result.remaining,
    };
  });
  const synced = await syncBooksProjectionsToState(state);
  return { ...synced, ...meta, requestId };
}

export async function booksImportState(
  state: InvestorState,
  opts?: { force?: boolean },
): Promise<import('./import-yaml.js').ImportResult> {
  const ctx = householdContextFromState(state);
  return withHouseholdTx(ctx.householdId, async (client) => {
    return importInvestorStateToBooks(client, state, opts);
  });
}

export async function booksRemoveDeposit(
  state: InvestorState,
  args: {
    id: string;
    valueDate: string;
    adjustCash: boolean;
    requestId?: string;
  },
): Promise<{
  cashes: CashBalance[];
  deposits: FixedDeposit[];
  principal: number;
  currency: string;
  channel: string;
  requestId: string;
}> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('remove_deposit');
  let meta = { principal: 0, currency: '', channel: '' };
  await withHouseholdTx(ctx.householdId, async (client) => {
    const result = await removeDepositBooks(client, ctx, {
      ...args,
      requestId,
      toolName: 'remove_deposit',
    });
    meta = {
      principal: result.principal,
      currency: result.currency,
      channel: result.channel,
    };
  });
  const synced = await syncBooksProjectionsToState(state);
  return { ...synced, ...meta, requestId };
}

export async function booksPostHoldingOpen(
  state: InvestorState,
  args: {
    mapKey: string;
    holding: Holding;
    purchaseUnits: number;
    purchaseAvg: number;
    valueDate: string;
    adjustCash: boolean;
    currency?: string;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('add_holding');
  await withHouseholdTx(ctx.householdId, async (client) => {
    await postHoldingOpen(client, ctx, {
      ...args,
      requestId,
      toolName: 'add_holding',
    });
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId };
}

export async function booksPostHoldingClose(
  state: InvestorState,
  args: {
    mapKey: string;
    holding: Holding;
    valueDate: string;
    adjustCash: boolean;
    currency?: string;
    requestId?: string;
  },
): Promise<{ cashes: CashBalance[]; requestId: string }> {
  await ensureBooksSeeded(state);
  const ctx = householdContextFromState(state);
  const requestId = args.requestId ?? newRequestId('remove_holding');
  await withHouseholdTx(ctx.householdId, async (client) => {
    await postHoldingClose(client, ctx, {
      ...args,
      requestId,
      toolName: 'remove_holding',
    });
  });
  const { cashes } = await syncBooksProjectionsToState(state);
  return { cashes, requestId };
}

export async function booksListJournals(state: InvestorState, limit = 50) {
  const ctx = householdContextFromState(state);
  return withHouseholdTx(ctx.householdId, async (client) => {
    return listJournalEntries(client, ctx.householdId, { limit });
  });
}

/** Ensure YAML cash matches books when books is SoR (read path helper). */
export async function booksRefreshCashIfEnabled(
  state: InvestorState,
): Promise<CashBalance[] | null> {
  if (!isBooksEnabled()) return null;
  // If never imported, keep YAML
  const ctx = householdContextFromState(state);
  try {
    const cashes = await withHouseholdTx(ctx.householdId, async (client) => {
      const n = await client.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM households WHERE id = $1::uuid`,
        [ctx.householdId],
      );
      if (Number(n.rows[0]?.c ?? 0) === 0) return null;
      return listCashBalances(client, ctx.householdId);
    });
    if (cashes == null) return null;
    setCashes(state, cashes);
    return cashes;
  } catch {
    throw new Error(
      `booksRefreshCashIfEnabled failed for ${ctx.slug}. ` +
        `Check INVAGE_BOOKS_DATABASE_URL and migrations.`,
    );
  }
}

export function requireBooksOrThrow(): void {
  if (!isBooksEnabled()) {
    throw new Error(
      'Books of record required: set INVAGE_BOOKS_DATABASE_URL (Postgres).',
    );
  }
}

/** Snapshot current YAML cashes (debug). */
export function yamlCashes(state: InvestorState): CashBalance[] {
  return getCashes(state);
}
