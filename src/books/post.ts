/**
 * Journal posting engine: balanced entries, projection updates, audit.
 */

import type { BooksClient } from './db.js';
import { assertCurrency, fromMinor } from './money.js';

export interface PostLine {
  accountId: string;
  amountMinor: bigint;
  currency: string;
  quantity?: number | null;
  unitCostMinor?: bigint | null;
}

export interface PostEntryArgs {
  householdId: string;
  valueDate: string;
  entryType: string;
  createdBy: string;
  requestId: string;
  toolName?: string;
  memo?: string;
  externalRef?: string;
  reversesEntryId?: string;
  lines: PostLine[];
  /** When true, allow cash (asset) accounts to go negative. Default false. */
  allowNegativeCash?: boolean;
}

export interface PostedEntry {
  entryId: string;
  requestId: string;
  idempotentReplay: boolean;
}

function assertValueDate(d: string): void {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`valueDate must be YYYY-MM-DD (got "${String(d)}").`);
  }
}

/**
 * Post a balanced journal entry and update account_balances.
 * Idempotent on (household_id, request_id).
 */
export async function postEntry(
  client: BooksClient,
  args: PostEntryArgs,
): Promise<PostedEntry> {
  if (!args.householdId?.trim()) throw new Error('postEntry: householdId required.');
  if (!args.createdBy?.trim()) throw new Error('postEntry: createdBy required.');
  if (!args.requestId?.trim()) throw new Error('postEntry: requestId required.');
  if (!args.entryType?.trim()) throw new Error('postEntry: entryType required.');
  assertValueDate(args.valueDate);
  if (!Array.isArray(args.lines) || args.lines.length < 2) {
    throw new Error('postEntry: at least two journal lines required.');
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM journal_entries
     WHERE household_id = $1::uuid AND request_id = $2`,
    [args.householdId, args.requestId.trim()],
  );
  if (existing.rows[0] != null) {
    return {
      entryId: existing.rows[0].id,
      requestId: args.requestId.trim(),
      idempotentReplay: true,
    };
  }

  // Balance check per currency
  const sums = new Map<string, bigint>();
  for (const line of args.lines) {
    const ccy = assertCurrency(line.currency);
    if (line.amountMinor === 0n && (line.quantity == null || line.quantity === 0)) {
      throw new Error('postEntry: line must have non-zero amount_minor or quantity.');
    }
    sums.set(ccy, (sums.get(ccy) ?? 0n) + line.amountMinor);
  }
  for (const [ccy, sum] of sums) {
    if (sum !== 0n) {
      throw new Error(
        `postEntry: unbalanced entry for ${ccy}: sum=${fromMinor(sum)} ` +
          `(must be 0; no silent FX).`,
      );
    }
  }

  // Load account currencies and kinds
  const accountIds = [...new Set(args.lines.map((l) => l.accountId))];
  const accRes = await client.query<{
    id: string;
    currency: string;
    kind: string;
    household_id: string;
  }>(
    `SELECT id, currency, kind, household_id::text
     FROM accounts WHERE id = ANY($1::uuid[])`,
    [accountIds],
  );
  if (accRes.rows.length !== accountIds.length) {
    throw new Error('postEntry: one or more account_id not found.');
  }
  const accById = new Map(accRes.rows.map((r) => [r.id, r]));
  for (const line of args.lines) {
    const acc = accById.get(line.accountId);
    if (acc == null) throw new Error(`postEntry: account ${line.accountId} missing.`);
    if (acc.household_id !== args.householdId) {
      throw new Error('postEntry: account household mismatch.');
    }
    if (assertCurrency(line.currency) !== acc.currency) {
      throw new Error(
        `postEntry: line currency ${line.currency} != account currency ${acc.currency}.`,
      );
    }
  }

  const entryRes = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (
       household_id, value_date, entry_type, external_ref, reverses_entry_id,
       memo, created_by, tool_name, request_id
     ) VALUES (
       $1::uuid, $2::date, $3, $4, $5::uuid, $6, $7, $8, $9
     ) RETURNING id`,
    [
      args.householdId,
      args.valueDate,
      args.entryType.trim(),
      args.externalRef ?? null,
      args.reversesEntryId ?? null,
      args.memo ?? null,
      args.createdBy.trim(),
      args.toolName ?? null,
      args.requestId.trim(),
    ],
  );
  const entryId = entryRes.rows[0]?.id;
  if (entryId == null) throw new Error('postEntry: failed to insert journal_entries.');

  for (const line of args.lines) {
    await client.query(
      `INSERT INTO journal_lines (
         entry_id, household_id, account_id, amount_minor, currency, quantity, unit_cost_minor
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5, $6, $7::bigint
       )`,
      [
        entryId,
        args.householdId,
        line.accountId,
        line.amountMinor.toString(),
        assertCurrency(line.currency),
        line.quantity ?? null,
        line.unitCostMinor != null ? line.unitCostMinor.toString() : null,
      ],
    );

    // Update balance projection
    const balRes = await client.query<{
      balance_minor: string;
      quantity: string;
      avg_cost_minor: string;
    }>(
      `SELECT balance_minor::text, quantity::text, avg_cost_minor::text
       FROM account_balances WHERE account_id = $1::uuid FOR UPDATE`,
      [line.accountId],
    );
    if (balRes.rows[0] == null) {
      throw new Error(`postEntry: missing account_balances for ${line.accountId}.`);
    }
    const prevBal = BigInt(balRes.rows[0].balance_minor);
    const prevQty = Number(balRes.rows[0].quantity);
    const prevAvg = BigInt(balRes.rows[0].avg_cost_minor);
    const nextBal = prevBal + line.amountMinor;
    let nextQty = prevQty;
    let nextAvg = prevAvg;

    if (line.quantity != null && line.quantity !== 0) {
      const q = line.quantity;
      if (!Number.isFinite(q)) {
        throw new Error('postEntry: quantity must be finite.');
      }
      nextQty = prevQty + q;
      if (nextQty < 0) {
        throw new Error(
          `postEntry: quantity would go negative for account ${line.accountId} ` +
            `(have ${prevQty}, delta ${q}).`,
        );
      }
      if (nextQty === 0) {
        nextAvg = 0n;
      } else if (q > 0 && line.unitCostMinor != null) {
        // Weighted average cost on buys
        const totalCost = prevAvg * BigInt(Math.round(prevQty * 1e6)) + line.unitCostMinor * BigInt(Math.round(q * 1e6));
        // Use quantity scale 6 for cost blend
        const prevQMinor = BigInt(Math.round(prevQty * 1_000_000));
        const addQMinor = BigInt(Math.round(q * 1_000_000));
        const totalQ = prevQMinor + addQMinor;
        if (totalQ <= 0n) {
          throw new Error('postEntry: invalid quantity scale for avg cost.');
        }
        const prevCost = prevAvg * prevQMinor;
        const addCost = line.unitCostMinor * addQMinor;
        nextAvg = (prevCost + addCost) / totalQ;
      }
      // sells: keep prior avg_cost until flat
    }

    const acc = accById.get(line.accountId)!;
    if (acc.kind === 'cash' && nextBal < 0n && !args.allowNegativeCash) {
      throw new Error(
        `Insufficient cash on account ${line.accountId}: would be ${fromMinor(nextBal)} ${acc.currency}.`,
      );
    }
    if (
      (acc.kind === 'cash' || acc.kind === 'deposit' || acc.kind === 'position') &&
      nextBal < 0n &&
      !args.allowNegativeCash
    ) {
      // deposits/positions money side also non-negative for asset accounts
      if (acc.kind === 'deposit' || acc.kind === 'cash') {
        throw new Error(
          `Account ${acc.kind} balance would be negative (${fromMinor(nextBal)} ${acc.currency}).`,
        );
      }
    }

    await client.query(
      `UPDATE account_balances
       SET balance_minor = $2::bigint,
           quantity = $3,
           avg_cost_minor = $4::bigint,
           updated_at = now()
       WHERE account_id = $1::uuid`,
      [line.accountId, nextBal.toString(), nextQty, nextAvg.toString()],
    );
  }

  await client.query(
    `INSERT INTO audit_events (household_id, journal_entry_id, actor, tool_name, request_id, detail)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)`,
    [
      args.householdId,
      entryId,
      args.createdBy.trim(),
      args.toolName ?? null,
      args.requestId.trim(),
      JSON.stringify({
        entry_type: args.entryType,
        line_count: args.lines.length,
        memo: args.memo ?? null,
      }),
    ],
  );

  return {
    entryId,
    requestId: args.requestId.trim(),
    idempotentReplay: false,
  };
}
