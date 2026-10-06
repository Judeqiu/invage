/** Read-only Book page model, sourced exclusively from the journal database. */
import { withHouseholdTx } from '../books/db.js';

export interface BookFilters {
  offset: number;
  limit: number;
  channel?: string;
  currency?: string;
  entryType?: string;
  from?: string;
  to?: string;
}

interface AccountRow {
  id: string;
  kind: string;
  channel: string;
  currency: string;
  external_key: string;
  label: string | null;
  balance_minor: string;
  quantity: string;
  instrument: string | null;
  category: string | null;
  updated_at: Date;
}

interface EntryRow {
  id: string;
  booked_at: Date;
  value_date: string;
  entry_type: string;
  external_ref: string | null;
  memo: string | null;
  created_by: string;
  tool_name: string | null;
  request_id: string;
}

interface AuditRow {
  created_at: Date;
  request_id: string;
  revision: string | null;
  journals: string | null;
}

interface LineRow {
  entry_id: string;
  kind: string;
  channel: string;
  currency: string;
  external_key: string;
  label: string | null;
  amount_minor: string;
  quantity: string | null;
  unit_cost_minor: string | null;
}

export async function loadBookPage(householdId: string, filters: BookFilters) {
  return withHouseholdTx(householdId, async client => {
    const summary = await client.query<{ journal_count: string; latest_booked_at: Date | null }>(
        `SELECT count(*)::text AS journal_count, max(booked_at) AS latest_booked_at
         FROM journal_entries WHERE household_id = $1::uuid`, [householdId]);
    const accounts = await client.query<AccountRow>(
        `SELECT a.id::text, a.kind, a.channel, a.currency, a.external_key,
                COALESCE(dm.label, a.label) AS label, b.balance_minor::text,
                b.quantity::text, pm.instrument, pm.category, b.updated_at
         FROM accounts a JOIN account_balances b ON b.account_id = a.id
         LEFT JOIN position_meta pm ON pm.account_id = a.id
         LEFT JOIN deposit_meta dm ON dm.account_id = a.id
         WHERE a.household_id = $1::uuid
           AND (b.balance_minor <> 0 OR b.quantity <> 0)
         ORDER BY a.kind, a.channel, a.currency, a.external_key`, [householdId]);
    const channels = await client.query<{ channel: string }>(
        `SELECT DISTINCT channel FROM accounts
         WHERE household_id = $1::uuid
           AND kind IN ('cash', 'deposit', 'position', 'property', 'liability')
         ORDER BY channel`, [householdId]);
    const currencies = await client.query<{ currency: string }>(
        `SELECT DISTINCT currency FROM accounts WHERE household_id = $1::uuid ORDER BY currency`,
        [householdId]);
    const types = await client.query<{ entry_type: string }>(
        `SELECT DISTINCT entry_type FROM journal_entries
         WHERE household_id = $1::uuid ORDER BY entry_type`, [householdId]);
    const updates = await client.query<AuditRow>(
        `SELECT created_at, request_id, detail->>'revision' AS revision,
                detail->>'journals' AS journals
         FROM audit_events
         WHERE household_id = $1::uuid AND journal_entry_id IS NULL
           AND tool_name = 'portfolio_save'
         ORDER BY created_at DESC, id DESC LIMIT 20`, [householdId]);

    const params: unknown[] = [householdId];
    const clauses = ['e.household_id = $1::uuid'];
    if (filters.entryType) {
      params.push(filters.entryType);
      clauses.push(`e.entry_type = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      clauses.push(`e.value_date >= $${params.length}::date`);
    }
    if (filters.to) {
      params.push(filters.to);
      clauses.push(`e.value_date <= $${params.length}::date`);
    }
    if (filters.channel !== undefined || filters.currency !== undefined) {
      const lineClauses = ['l.entry_id = e.id'];
      if (filters.channel !== undefined) {
        params.push(filters.channel);
        lineClauses.push(`a.channel = $${params.length}`);
        lineClauses.push(`a.kind IN ('cash', 'deposit', 'position', 'property', 'liability')`);
      }
      if (filters.currency !== undefined) {
        params.push(filters.currency);
        lineClauses.push(`a.currency = $${params.length}`);
      }
      clauses.push(`EXISTS (
        SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE ${lineClauses.join(' AND ')}
      )`);
    }
    const where = clauses.join(' AND ');
    const count = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM journal_entries e WHERE ${where}`, params);
    const entries = await client.query<EntryRow>(
      `SELECT e.id::text, e.booked_at, e.value_date::text, e.entry_type,
              e.external_ref, e.memo, e.created_by, e.tool_name, e.request_id
       FROM journal_entries e WHERE ${where}
       ORDER BY e.booked_at DESC, e.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filters.limit, filters.offset]);
    const ids = entries.rows.map(entry => entry.id);
    const lines = ids.length === 0 ? [] : (await client.query<LineRow>(
      `SELECT l.entry_id::text, a.kind, a.channel, l.currency, a.external_key,
              a.label, l.amount_minor::text, l.quantity::text, l.unit_cost_minor::text
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
       WHERE l.entry_id = ANY($1::uuid[])
       ORDER BY l.entry_id, l.id`, [ids])).rows;
    const linesByEntry = new Map<string, LineRow[]>();
    for (const line of lines) {
      const group = linesByEntry.get(line.entry_id) ?? [];
      group.push(line);
      linesByEntry.set(line.entry_id, group);
    }
    return {
      summary: {
        journal_count: Number(summary.rows[0]?.journal_count ?? 0),
        active_accounts: accounts.rows.length,
        latest_booked_at: summary.rows[0]?.latest_booked_at?.toISOString() ?? null,
      },
      accounts: accounts.rows.map(({ updated_at, ...account }) => ({
        ...account, updated_at: updated_at.toISOString(),
      })),
      options: {
        channels: channels.rows.map(row => row.channel),
        currencies: currencies.rows.map(row => row.currency),
        entry_types: types.rows.map(row => row.entry_type),
      },
      updates: updates.rows.map(row => ({
        created_at: row.created_at.toISOString(), request_id: row.request_id,
        revision: row.revision == null ? null : Number(row.revision),
        journals: row.journals == null ? null : Number(row.journals),
      })),
      journal: {
        total: Number(count.rows[0]?.total ?? 0),
        offset: filters.offset,
        limit: filters.limit,
        entries: entries.rows.map(({ booked_at, ...entry }) => ({
          ...entry, booked_at: booked_at.toISOString(),
          lines: linesByEntry.get(entry.id) ?? [],
        })),
      },
    };
  });
}
