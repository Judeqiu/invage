/** Read the imported double-entry history and subsequent organization changes. */
import { createDatabasePool, readDatabaseConfig } from 'utarus/database';
import type { InvestorState } from '../state/portfolio-state.js';
import { withFinanceScope } from './repository.js';

type ArchivedLine = {
  line: { amount_minor: string | number; currency: string };
  account: { kind?: string; channel?: string; external_key?: string } | null;
};
type HistoryRow = { occurred_at: string; text: string; kind: 'legacy_journal' | 'organization_change';
  details: unknown };

export async function listOrganizationFinanceHistory(
  state: InvestorState, limit: number,
): Promise<HistoryRow[]> {
  const orgId = state.user.org_id;
  if (!orgId) throw new Error('Organization membership required');
  const pool = createDatabasePool(readDatabaseConfig(process.env), error => { throw error; });
  try {
    return await withFinanceScope(pool, state.user.id, orgId, 'read', async ({ client }) => {
      const archived = await client.query<{
        payload: Record<string, unknown>; lines: ArchivedLine[]; occurred_at: string;
      }>(
        `SELECT entry.payload, entry.payload->>'booked_at' AS occurred_at,
           COALESCE(jsonb_agg(jsonb_build_object('line',line.payload,'account',account.payload)
             ORDER BY line.record_id) FILTER (WHERE line.record_id IS NOT NULL),'[]'::jsonb) AS lines
         FROM finance.legacy_books_records entry
         LEFT JOIN finance.legacy_books_records line
           ON line.org_id=entry.org_id AND line.record_type='journal_lines'
          AND line.payload->>'entry_id'=entry.record_id::text
         LEFT JOIN finance.legacy_books_records account
           ON account.org_id=entry.org_id AND account.record_type='accounts'
          AND account.record_id::text=line.payload->>'account_id'
         WHERE entry.org_id=$1 AND entry.record_type='journal_entries'
         GROUP BY entry.org_id,entry.record_id,entry.payload
         ORDER BY (entry.payload->>'booked_at')::timestamptz DESC LIMIT $2`,
        [orgId, limit],
      );
      const changes = await client.query<{
        created_at: string; source_revision: string; actor_user_id: string;
        action_name: string | null; action_context: { memo?: string } | null;
        cash_changes: unknown;
      }>(
        `SELECT created_at::text,source_revision::text,actor_user_id,
           snapshot->>'action_name' AS action_name,
           snapshot->'action_context' AS action_context,
           snapshot->'cash_changes' AS cash_changes
         FROM finance.change_events WHERE org_id=$1
         ORDER BY created_at DESC,id DESC LIMIT $2`,
        [orgId, limit],
      );
      const oldRows: HistoryRow[] = archived.rows.map(({ payload, lines, occurred_at }) => {
        const legs = lines.map(({ line, account }) => {
          const amount = Number(line.amount_minor) / 1_000_000;
          return `  ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} ${line.currency} ` +
            `${account?.kind ?? 'account'}${account?.channel ? `@${account.channel}` : ''}`;
        }).join('\n');
        return { occurred_at, kind: 'legacy_journal', details: { entry: payload, lines },
          text: `${payload.value_date} ${payload.entry_type} (${payload.request_id})` +
            `${payload.memo ? `\n  memo: ${payload.memo}` : ''}${legs ? `\n${legs}` : ''}` };
      });
      const newRows: HistoryRow[] = changes.rows.map(row => ({
        occurred_at: row.created_at, kind: 'organization_change', details: row,
        text: `${row.created_at.slice(0, 10)} organization_change ` +
          `(${row.action_name ?? 'financial_update'}, revision ${row.source_revision})` +
          `${row.action_context?.memo ? `\n  memo: ${row.action_context.memo}` : ''}` +
          `${Array.isArray(row.cash_changes) && row.cash_changes.length
            ? `\n  cash: ${row.cash_changes.map((cash: { delta: number; currency: string; channel?: string }) =>
              `${cash.delta >= 0 ? '+' : ''}${cash.delta.toFixed(2)} ${cash.currency}` +
              `${cash.channel ? `@${cash.channel}` : ''}`).join(', ')}` : ''}`,
      }));
      return [...oldRows, ...newRows]
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, limit);
    });
  } finally {
    await pool.end();
  }
}
