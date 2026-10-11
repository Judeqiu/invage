/**
 * Chart of accounts helpers for books.
 */

import type { BooksClient } from './db.js';
import { assertCurrency, normalizeChannelKey } from './money.js';

export type AccountKind =
  | 'cash'
  | 'deposit'
  | 'position'
  | 'property'
  | 'liability'
  | 'income'
  | 'expense'
  | 'equity'
  | 'clearing';

export interface AccountRow {
  id: string;
  household_id: string;
  kind: AccountKind;
  currency: string;
  channel: string;
  external_key: string;
  label: string | null;
}

export async function ensureHousehold(
  client: BooksClient,
  householdId: string,
  slug: string,
): Promise<void> {
  if (!householdId?.trim()) throw new Error('ensureHousehold: householdId required.');
  if (!slug?.trim()) throw new Error('ensureHousehold: slug required.');
  await client.query(
    `INSERT INTO households (id, slug) VALUES ($1::uuid, $2)
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug`,
    [householdId.trim(), slug.trim()],
  );
}

export async function ensureAccount(
  client: BooksClient,
  args: {
    householdId: string;
    kind: AccountKind;
    currency: string;
    channel?: string | null;
    externalKey?: string;
    label?: string;
  },
): Promise<AccountRow> {
  const currency = assertCurrency(args.currency);
  const channel = normalizeChannelKey(args.channel);
  const externalKey = args.externalKey ?? '';
  const res = await client.query<AccountRow>(
    `INSERT INTO accounts (household_id, kind, currency, channel, external_key, label)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     ON CONFLICT (household_id, kind, currency, channel, external_key)
     DO UPDATE SET label = COALESCE(EXCLUDED.label, accounts.label)
     RETURNING id, household_id, kind, currency, channel, external_key, label`,
    [
      args.householdId,
      args.kind,
      currency,
      channel,
      externalKey,
      args.label ?? null,
    ],
  );
  const row = res.rows[0];
  if (row == null) throw new Error('ensureAccount: insert returned no row.');
  // Ensure balance row exists
  await client.query(
    `INSERT INTO account_balances (account_id, household_id, balance_minor, quantity, avg_cost_minor)
     VALUES ($1::uuid, $2::uuid, 0, 0, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [row.id, args.householdId],
  );
  return row;
}

/** System equity account used to balance imports / absolute set_cash / clears. */
export async function ensureImportEquity(
  client: BooksClient,
  householdId: string,
  currency: string,
): Promise<AccountRow> {
  return ensureAccount(client, {
    householdId,
    kind: 'equity',
    currency,
    channel: '',
    externalKey: 'import',
    label: 'Import / opening equity',
  });
}

export async function getBalanceMinor(
  client: BooksClient,
  accountId: string,
): Promise<bigint> {
  const res = await client.query<{ balance_minor: string }>(
    `SELECT balance_minor::text FROM account_balances WHERE account_id = $1::uuid`,
    [accountId],
  );
  if (res.rows[0] == null) return 0n;
  return BigInt(res.rows[0].balance_minor);
}

export async function getQuantity(
  client: BooksClient,
  accountId: string,
): Promise<number> {
  const res = await client.query<{ quantity: string }>(
    `SELECT quantity::text FROM account_balances WHERE account_id = $1::uuid`,
    [accountId],
  );
  if (res.rows[0] == null) return 0;
  return Number(res.rows[0].quantity);
}
