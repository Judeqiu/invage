/**
 * Domain money operations posted as journals.
 */

import {
  ensureAccount,
  ensureHousehold,
  ensureImportEquity,
  getBalanceMinor,
  type AccountRow,
} from './accounts.js';
import type { BooksClient } from './db.js';
import {
  assertCurrency,
  assertNonNegativeMinor,
  formatChannelLabel,
  fromMinor,
  normalizeChannelKey,
  toMinor,
} from './money.js';
import { postEntry, type PostedEntry } from './post.js';

export interface HouseholdContext {
  householdId: string;
  slug: string;
  actor: string;
}

function requireDate(d: string, label: string): string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return d;
}

async function cashAccount(
  client: BooksClient,
  householdId: string,
  channel: string | undefined | null,
  currency: string,
): Promise<AccountRow> {
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
 * Contra accounts for cash journals (double-entry offset).
 * Common accounting: never "set" a balance — always post a balanced journal.
 */
export type CashContraKind =
  | 'opening' // equity / opening balances (first recognition only)
  | 'adjustment' // equity / prior-period or reconciling adjustment
  | 'income' // income statement credit (e.g. interest received)
  | 'expense' // income statement debit (e.g. bank fees)
  | 'clearing'; // temporary clearing (FX legs, in-transit)

async function ensureCashContra(
  client: BooksClient,
  householdId: string,
  currency: string,
  kind: CashContraKind,
): Promise<AccountRow> {
  const ccy = assertCurrency(currency);
  switch (kind) {
    case 'opening':
      return ensureAccount(client, {
        householdId,
        kind: 'equity',
        currency: ccy,
        channel: '',
        externalKey: 'opening',
        label: 'Opening balances equity',
      });
    case 'adjustment':
      return ensureAccount(client, {
        householdId,
        kind: 'equity',
        currency: ccy,
        channel: '',
        externalKey: 'adjustment',
        label: 'Equity adjustments / reconciling',
      });
    case 'income':
      return ensureAccount(client, {
        householdId,
        kind: 'income',
        currency: ccy,
        channel: '',
        externalKey: 'general',
        label: 'Income',
      });
    case 'expense':
      return ensureAccount(client, {
        householdId,
        kind: 'expense',
        currency: ccy,
        channel: '',
        externalKey: 'general',
        label: 'Expense',
      });
    case 'clearing':
      return ensureAccount(client, {
        householdId,
        kind: 'clearing',
        currency: ccy,
        channel: '',
        externalKey: 'general',
        label: 'Clearing',
      });
    default: {
      const _x: never = kind;
      throw new Error(`ensureCashContra: unknown kind ${String(_x)}`);
    }
  }
}

function requireMemo(memo: string): string {
  if (typeof memo !== 'string' || memo.trim().length < 3) {
    throw new Error(
      'memo is required (min 3 chars): source document, reason, and value date for the journal.',
    );
  }
  return memo.trim();
}

/**
 * Opening balance for a cash sleeve that is currently zero / unknown.
 * Fails if the sleeve already has a non-zero balance — use postCashAdjustment instead.
 */
export async function postOpeningBalance(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    memo: string;
    requestId: string;
    toolName?: string;
  },
): Promise<{
  posted: PostedEntry;
  amount: number;
  currency: string;
  channel: string;
  prior: number;
}> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency);
  const valueDate = requireDate(args.valueDate, 'valueDate');
  const memo = requireMemo(args.memo);
  if (!(args.amount > 0) || !Number.isFinite(args.amount)) {
    throw new Error('post_opening_balance: amount must be a finite number > 0.');
  }
  const target = toMinor(args.amount);
  const cash = await cashAccount(client, ctx.householdId, args.channel, ccy);
  const prior = await getBalanceMinor(client, cash.id);
  if (prior !== 0n) {
    throw new Error(
      `post_opening_balance: sleeve ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy} ` +
        `already has balance ${fromMinor(prior)}. ` +
        `Do not set cash — post_adjustment with signed amount (delta) and memo.`,
    );
  }
  const equity = await ensureCashContra(client, ctx.householdId, ccy, 'opening');
  const posted = await postEntry(client, {
    householdId: ctx.householdId,
    valueDate,
    entryType: 'opening_balance',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'post_opening_balance',
    memo,
    lines: [
      { accountId: cash.id, amountMinor: target, currency: ccy },
      { accountId: equity.id, amountMinor: -target, currency: ccy },
    ],
  });
  return {
    posted,
    amount: fromMinor(target),
    currency: ccy,
    channel: normalizeChannelKey(args.channel),
    prior: 0,
  };
}

/**
 * Adjust free cash by a **signed delta** (never an absolute set).
 * Positive = increase cash (debit cash / credit contra).
 * Negative = decrease cash (credit cash / debit contra).
 */
export async function postCashAdjustment(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    memo: string;
    contra: CashContraKind;
    requestId: string;
    toolName?: string;
  },
): Promise<{
  posted: PostedEntry;
  delta: number;
  balanceAfter: number;
  currency: string;
  channel: string;
  prior: number;
}> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency);
  const valueDate = requireDate(args.valueDate, 'valueDate');
  const memo = requireMemo(args.memo);
  if (typeof args.amount !== 'number' || !Number.isFinite(args.amount) || args.amount === 0) {
    throw new Error(
      'post_adjustment: amount must be a non-zero finite signed delta (not an absolute balance).',
    );
  }
  if (args.contra === 'opening') {
    throw new Error(
      'post_adjustment: contra=opening is only for post_opening_balance on a zero sleeve.',
    );
  }
  const delta = toMinor(args.amount);
  const cash = await cashAccount(client, ctx.householdId, args.channel, ccy);
  const prior = await getBalanceMinor(client, cash.id);
  const next = prior + delta;
  if (next < 0n) {
    throw new Error(
      `post_adjustment: cash would go negative on ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy}: ` +
        `have ${fromMinor(prior)}, delta ${args.amount}.`,
    );
  }
  const contra = await ensureCashContra(client, ctx.householdId, ccy, args.contra);
  const entryType =
    args.contra === 'income'
      ? 'cash_income'
      : args.contra === 'expense'
        ? 'cash_expense'
        : args.contra === 'clearing'
          ? 'cash_clearing'
          : 'cash_adjustment';
  const posted = await postEntry(client, {
    householdId: ctx.householdId,
    valueDate,
    entryType,
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'post_adjustment',
    memo,
    lines: [
      { accountId: cash.id, amountMinor: delta, currency: ccy },
      { accountId: contra.id, amountMinor: -delta, currency: ccy },
    ],
  });
  return {
    posted,
    delta: fromMinor(delta),
    balanceAfter: fromMinor(next),
    currency: ccy,
    channel: normalizeChannelKey(args.channel),
    prior: fromMinor(prior),
  };
}

/**
 * @deprecated Absolute set is not bookkeeping. Prefer postOpeningBalance / postCashAdjustment.
 * Kept only for lossless YAML import seed (opening journals).
 */
export async function setCashAbsolute(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    requestId: string;
    toolName?: string;
    memo?: string;
  },
): Promise<{ posted: PostedEntry; amount: number; currency: string; channel: string }> {
  const prior = await (async () => {
    await ensureHousehold(client, ctx.householdId, ctx.slug);
    const cash = await cashAccount(client, ctx.householdId, args.channel, args.currency);
    return getBalanceMinor(client, cash.id);
  })();
  if (prior === 0n && args.amount > 0) {
    const r = await postOpeningBalance(client, ctx, {
      amount: args.amount,
      currency: args.currency,
      channel: args.channel,
      valueDate: args.valueDate,
      memo: args.memo ?? 'import_yaml opening balance',
      requestId: args.requestId,
      toolName: args.toolName ?? 'import_yaml',
    });
    return {
      posted: r.posted,
      amount: r.amount,
      currency: r.currency,
      channel: r.channel,
    };
  }
  const cash = await cashAccount(client, ctx.householdId, args.channel, args.currency);
  const current = await getBalanceMinor(client, cash.id);
  const target = toMinor(args.amount);
  const delta = target - current;
  if (delta === 0n) {
    return {
      posted: { entryId: '', requestId: args.requestId, idempotentReplay: true },
      amount: fromMinor(target),
      currency: assertCurrency(args.currency),
      channel: normalizeChannelKey(args.channel),
    };
  }
  const r = await postCashAdjustment(client, ctx, {
    amount: fromMinor(delta),
    currency: args.currency,
    channel: args.channel,
    valueDate: args.valueDate,
    memo: args.memo ?? 'import_yaml reconciling adjustment',
    contra: 'adjustment',
    requestId: args.requestId,
    toolName: args.toolName ?? 'import_yaml',
  });
  return {
    posted: r.posted,
    amount: r.balanceAfter,
    currency: r.currency,
    channel: r.channel,
  };
}

/**
 * Zero one cash sleeve via adjustment journal (credit cash, debit equity/adjustment).
 * Not a silent delete — requires memo like any other adjustment.
 */
export async function clearCashSleeve(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    channel?: string | null;
    currency: string;
    valueDate: string;
    requestId: string;
    memo: string;
    toolName?: string;
  },
): Promise<PostedEntry> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency);
  const cash = await cashAccount(client, ctx.householdId, args.channel, ccy);
  const current = await getBalanceMinor(client, cash.id);
  if (current === 0n) {
    throw new Error(
      `No free cash for ${formatChannelLabel(normalizeChannelKey(args.channel))}/${ccy}.`,
    );
  }
  const r = await postCashAdjustment(client, ctx, {
    amount: -fromMinor(current),
    currency: ccy,
    channel: args.channel,
    valueDate: args.valueDate,
    memo: args.memo,
    contra: 'adjustment',
    requestId: args.requestId,
    toolName: args.toolName ?? 'post_adjustment',
  });
  return r.posted;
}

/** Same-currency double-entry transfer between channels. */
export async function transferCashBooks(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    fromChannel?: string | null;
    toChannel?: string | null;
    amount: number;
    currency: string;
    valueDate: string;
    requestId: string;
    toolName?: string;
  },
): Promise<PostedEntry> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency);
  const amount = toMinor(args.amount);
  if (amount <= 0n) throw new Error('transfer_cash: amount must be > 0.');
  const fromKey = normalizeChannelKey(args.fromChannel);
  const toKey = normalizeChannelKey(args.toChannel);
  if (fromKey === toKey) {
    throw new Error(
      `transfer_cash: from_channel and to_channel must differ (got "${fromKey || '(unassigned)'}").`,
    );
  }
  const from = await cashAccount(client, ctx.householdId, args.fromChannel, ccy);
  const to = await cashAccount(client, ctx.householdId, args.toChannel, ccy);
  return postEntry(client, {
    householdId: ctx.householdId,
    valueDate: requireDate(args.valueDate, 'valueDate'),
    entryType: 'transfer_cash',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'transfer_cash',
    memo: `transfer ${fromMinor(amount)} ${ccy} ${formatChannelLabel(fromKey)} → ${formatChannelLabel(toKey)}`,
    lines: [
      { accountId: from.id, amountMinor: -amount, currency: ccy },
      { accountId: to.id, amountMinor: amount, currency: ccy },
    ],
  });
}

/** Open a fixed deposit: cash → deposit principal. */
export async function addDepositBooks(
  client: BooksClient,
  ctx: HouseholdContext,
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
    requestId: string;
    adjustCash: boolean;
    toolName?: string;
  },
): Promise<PostedEntry | null> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const ccy = assertCurrency(args.currency);
  const principal = toMinor(args.amount);
  const interest = toMinor(args.interest);
  assertNonNegativeMinor(principal, 'deposit principal');
  assertNonNegativeMinor(interest, 'deposit interest');
  if (!args.id?.trim()) throw new Error('add_deposit: id required.');
  requireDate(args.startDate, 'startDate');
  requireDate(args.endDate, 'endDate');
  if (args.endDate < args.startDate) {
    throw new Error('add_deposit: end_date must be ≥ start_date.');
  }

  const deposit = await ensureAccount(client, {
    householdId: ctx.householdId,
    kind: 'deposit',
    currency: ccy,
    channel: args.channel,
    externalKey: args.id.trim(),
    label: args.label ?? args.id.trim(),
  });

  await client.query(
    `INSERT INTO deposit_meta (account_id, household_id, interest_minor, start_date, end_date, label)
     VALUES ($1::uuid, $2::uuid, $3::bigint, $4::date, $5::date, $6)
     ON CONFLICT (account_id) DO UPDATE SET
       interest_minor = EXCLUDED.interest_minor,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       label = EXCLUDED.label`,
    [
      deposit.id,
      ctx.householdId,
      interest.toString(),
      args.startDate,
      args.endDate,
      args.label ?? null,
    ],
  );

  if (!args.adjustCash) {
    // Import without cash: open deposit vs equity
    const equity = await ensureImportEquity(client, ctx.householdId, ccy);
    return postEntry(client, {
      householdId: ctx.householdId,
      valueDate: requireDate(args.valueDate, 'valueDate'),
      entryType: 'deposit_open_import',
      createdBy: ctx.actor,
      requestId: args.requestId,
      toolName: args.toolName ?? 'add_deposit',
      lines: [
        { accountId: deposit.id, amountMinor: principal, currency: ccy },
        { accountId: equity.id, amountMinor: -principal, currency: ccy },
      ],
    });
  }

  const cash = await cashAccount(client, ctx.householdId, args.channel, ccy);
  return postEntry(client, {
    householdId: ctx.householdId,
    valueDate: requireDate(args.valueDate, 'valueDate'),
    entryType: 'deposit_open',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'add_deposit',
    lines: [
      { accountId: cash.id, amountMinor: -principal, currency: ccy },
      { accountId: deposit.id, amountMinor: principal, currency: ccy },
    ],
  });
}

/** Mature deposit principal → free cash same channel+currency. */
export async function matureDepositBooks(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    id: string;
    amount?: number;
    valueDate: string;
    requestId: string;
    adjustCash: boolean;
    toolName?: string;
  },
): Promise<{ posted: PostedEntry | null; unlocked: number; currency: string; channel: string; remaining: number }> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const id = args.id.trim();
  if (!id) throw new Error('mature_deposit: id required.');

  const depRes = await client.query<{
    account_id: string;
    currency: string;
    channel: string;
    balance_minor: string;
  }>(
    `SELECT a.id AS account_id, a.currency, a.channel, b.balance_minor::text
     FROM accounts a
     JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'deposit' AND a.external_key = $2`,
    [ctx.householdId, id],
  );
  const dep = depRes.rows[0];
  if (dep == null) throw new Error(`mature_deposit: deposit id "${id}" not found.`);
  const principal = BigInt(dep.balance_minor);
  if (principal <= 0n) {
    throw new Error(`mature_deposit: deposit "${id}" has zero principal.`);
  }
  const unlock =
    args.amount === undefined ? principal : toMinor(args.amount);
  if (unlock <= 0n) throw new Error('mature_deposit: amount must be > 0.');
  if (unlock > principal) {
    throw new Error(
      `mature_deposit: cannot unlock ${fromMinor(unlock)} ${dep.currency}; principal is ${fromMinor(principal)}.`,
    );
  }

  if (!args.adjustCash) {
    const equity = await ensureImportEquity(client, ctx.householdId, dep.currency);
    const posted = await postEntry(client, {
      householdId: ctx.householdId,
      valueDate: requireDate(args.valueDate, 'valueDate'),
      entryType: 'mature_deposit_no_cash',
      createdBy: ctx.actor,
      requestId: args.requestId,
      toolName: args.toolName ?? 'mature_deposit',
      lines: [
        { accountId: dep.account_id, amountMinor: -unlock, currency: dep.currency },
        { accountId: equity.id, amountMinor: unlock, currency: dep.currency },
      ],
    });
    return {
      posted,
      unlocked: fromMinor(unlock),
      currency: dep.currency,
      channel: dep.channel,
      remaining: fromMinor(principal - unlock),
    };
  }

  const cash = await cashAccount(client, ctx.householdId, dep.channel, dep.currency);
  const posted = await postEntry(client, {
    householdId: ctx.householdId,
    valueDate: requireDate(args.valueDate, 'valueDate'),
    entryType: 'mature_deposit',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'mature_deposit',
    lines: [
      { accountId: dep.account_id, amountMinor: -unlock, currency: dep.currency },
      { accountId: cash.id, amountMinor: unlock, currency: dep.currency },
    ],
  });
  return {
    posted,
    unlocked: fromMinor(unlock),
    currency: dep.currency,
    channel: dep.channel,
    remaining: fromMinor(principal - unlock),
  };
}

/** Opening import for cash sleeve (used by YAML import). */
export async function importCashOpening(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    amount: number;
    currency: string;
    channel?: string | null;
    valueDate: string;
    requestId: string;
  },
): Promise<PostedEntry> {
  return (
    await setCashAbsolute(client, ctx, {
      ...args,
      toolName: 'import_yaml',
    })
  ).posted;
}

/** Remove remaining deposit principal (credit cash or equity). */
export async function removeDepositBooks(
  client: BooksClient,
  ctx: HouseholdContext,
  args: {
    id: string;
    valueDate: string;
    requestId: string;
    adjustCash: boolean;
    toolName?: string;
  },
): Promise<{ posted: PostedEntry; principal: number; currency: string; channel: string }> {
  await ensureHousehold(client, ctx.householdId, ctx.slug);
  const id = args.id.trim();
  if (!id) throw new Error('remove_deposit: id required.');
  const depRes = await client.query<{
    account_id: string;
    currency: string;
    channel: string;
    balance_minor: string;
  }>(
    `SELECT a.id AS account_id, a.currency, a.channel, b.balance_minor::text
     FROM accounts a
     JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'deposit' AND a.external_key = $2`,
    [ctx.householdId, id],
  );
  const dep = depRes.rows[0];
  if (dep == null) throw new Error(`remove_deposit: deposit id "${id}" not found.`);
  const principal = BigInt(dep.balance_minor);
  if (principal <= 0n) {
    throw new Error(`remove_deposit: deposit "${id}" has zero principal.`);
  }
  if (args.adjustCash) {
    const cash = await cashAccount(client, ctx.householdId, dep.channel, dep.currency);
    const posted = await postEntry(client, {
      householdId: ctx.householdId,
      valueDate: requireDate(args.valueDate, 'valueDate'),
      entryType: 'deposit_remove',
      createdBy: ctx.actor,
      requestId: args.requestId,
      toolName: args.toolName ?? 'remove_deposit',
      lines: [
        { accountId: dep.account_id, amountMinor: -principal, currency: dep.currency },
        { accountId: cash.id, amountMinor: principal, currency: dep.currency },
      ],
    });
    return {
      posted,
      principal: fromMinor(principal),
      currency: dep.currency,
      channel: dep.channel,
    };
  }
  const equity = await ensureImportEquity(client, ctx.householdId, dep.currency);
  const posted = await postEntry(client, {
    householdId: ctx.householdId,
    valueDate: requireDate(args.valueDate, 'valueDate'),
    entryType: 'deposit_remove_import',
    createdBy: ctx.actor,
    requestId: args.requestId,
    toolName: args.toolName ?? 'remove_deposit',
    lines: [
      { accountId: dep.account_id, amountMinor: -principal, currency: dep.currency },
      { accountId: equity.id, amountMinor: principal, currency: dep.currency },
    ],
  });
  return {
    posted,
    principal: fromMinor(principal),
    currency: dep.currency,
    channel: dep.channel,
  };
}
