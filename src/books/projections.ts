/**
 * Read ledger projections into Invage domain shapes (CashBalance, FixedDeposit, …).
 */

import type { CashBalance, FixedDeposit } from '../state/portfolio-state.js';
import type { BooksClient } from './db.js';
import { fromMinor } from './money.js';

export async function listCashBalances(
  client: BooksClient,
  householdId: string,
): Promise<CashBalance[]> {
  const res = await client.query<{
    channel: string;
    currency: string;
    balance_minor: string;
    updated_at: Date;
  }>(
    `SELECT a.channel, a.currency, b.balance_minor::text, b.updated_at
     FROM accounts a
     JOIN account_balances b ON b.account_id = a.id
     WHERE a.household_id = $1::uuid
       AND a.kind = 'cash'
       AND b.balance_minor <> 0
     ORDER BY a.channel, a.currency`,
    [householdId],
  );
  return res.rows.map((r) => {
    const cash: CashBalance = {
      amount: fromMinor(r.balance_minor),
      currency: r.currency,
      updated_at: r.updated_at.toISOString().slice(0, 10),
    };
    if (r.channel.length > 0) cash.channel = r.channel;
    return cash;
  });
}

export async function listDeposits(
  client: BooksClient,
  householdId: string,
): Promise<FixedDeposit[]> {
  const res = await client.query<{
    external_key: string;
    channel: string;
    currency: string;
    balance_minor: string;
    interest_minor: string;
    start_date: string;
    end_date: string;
    label: string | null;
    updated_at: Date;
  }>(
    `SELECT a.external_key, a.channel, a.currency, b.balance_minor::text,
            m.interest_minor::text, m.start_date::text, m.end_date::text,
            m.label, b.updated_at
     FROM accounts a
     JOIN account_balances b ON b.account_id = a.id
     JOIN deposit_meta m ON m.account_id = a.id
     WHERE a.household_id = $1::uuid
       AND a.kind = 'deposit'
       AND b.balance_minor > 0
     ORDER BY m.start_date, a.external_key`,
    [householdId],
  );
  return res.rows.map((r) => {
    const d: FixedDeposit = {
      id: r.external_key,
      amount: fromMinor(r.balance_minor),
      interest: fromMinor(r.interest_minor),
      currency: r.currency,
      start_date: r.start_date.slice(0, 10),
      end_date: r.end_date.slice(0, 10),
      updated_at: r.updated_at.toISOString().slice(0, 10),
    };
    if (r.channel.length > 0) d.channel = r.channel;
    if (r.label != null && r.label.length > 0) d.label = r.label;
    return d;
  });
}

export async function listJournalEntries(
  client: BooksClient,
  householdId: string,
  opts?: { limit?: number },
): Promise<
  Array<{
    id: string;
    value_date: string;
    entry_type: string;
    request_id: string;
    tool_name: string | null;
    memo: string | null;
    created_by: string;
    lines: Array<{
      account_id: string;
      kind: string;
      channel: string;
      currency: string;
      amount: number;
      external_key: string;
    }>;
  }>
> {
  const limit = opts?.limit ?? 50;
  if (!(limit > 0) || !Number.isFinite(limit)) {
    throw new Error('listJournalEntries: limit must be a positive finite number.');
  }
  const entries = await client.query<{
    id: string;
    value_date: string;
    entry_type: string;
    request_id: string;
    tool_name: string | null;
    memo: string | null;
    created_by: string;
  }>(
    `SELECT id, value_date::text, entry_type, request_id, tool_name, memo, created_by
     FROM journal_entries
     WHERE household_id = $1::uuid
     ORDER BY booked_at DESC, id DESC
     LIMIT $2`,
    [householdId, limit],
  );

  const out = [];
  for (const e of entries.rows) {
    const lines = await client.query<{
      account_id: string;
      kind: string;
      channel: string;
      currency: string;
      amount_minor: string;
      external_key: string;
    }>(
      `SELECT l.account_id::text, a.kind, a.channel, l.currency, l.amount_minor::text, a.external_key
       FROM journal_lines l
       JOIN accounts a ON a.id = l.account_id
       WHERE l.entry_id = $1::uuid
       ORDER BY l.id`,
      [e.id],
    );
    out.push({
      id: e.id,
      value_date: e.value_date.slice(0, 10),
      entry_type: e.entry_type,
      request_id: e.request_id,
      tool_name: e.tool_name,
      memo: e.memo,
      created_by: e.created_by,
      lines: lines.rows.map((l) => ({
        account_id: l.account_id,
        kind: l.kind,
        channel: l.channel,
        currency: l.currency,
        amount: fromMinor(l.amount_minor),
        external_key: l.external_key,
      })),
    });
  }
  return out;
}

/** Rebuild cash balances purely from journal lines (verification). */
export async function rebuildCashFromJournal(
  client: BooksClient,
  householdId: string,
): Promise<Map<string, bigint>> {
  const res = await client.query<{
    channel: string;
    currency: string;
    sum_minor: string;
  }>(
    `SELECT a.channel, a.currency, COALESCE(SUM(l.amount_minor), 0)::text AS sum_minor
     FROM accounts a
     LEFT JOIN journal_lines l ON l.account_id = a.id
     WHERE a.household_id = $1::uuid AND a.kind = 'cash'
     GROUP BY a.channel, a.currency`,
    [householdId],
  );
  const map = new Map<string, bigint>();
  for (const r of res.rows) {
    map.set(`${r.channel}@${r.currency}`, BigInt(r.sum_minor));
  }
  return map;
}
