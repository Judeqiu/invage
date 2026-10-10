import { createHash } from 'node:crypto';
import { getPool, isBooksEnabled } from '../books/db.js';
import { field, type Dataset, type Field, type Row } from './catalog.js';
import { limits } from './engine.js';

// Table/column identifiers are host-owned, never supplied as SQL by the model.
const tables: Record<string, Record<string, Field['type']>> = {
  households: { id: 'string', slug: 'string', created_at: 'datetime' },
  accounts: { id: 'string', household_id: 'string', kind: 'string', currency: 'string', channel: 'string', external_key: 'string', label: 'string', created_at: 'datetime' },
  journal_entries: { id: 'string', household_id: 'string', booked_at: 'datetime', value_date: 'date', entry_type: 'string', external_ref: 'string', reverses_entry_id: 'string', memo: 'string', created_by: 'string', tool_name: 'string', request_id: 'string' },
  journal_lines: { id: 'string', entry_id: 'string', household_id: 'string', account_id: 'string', amount_minor: 'decimal', currency: 'string', quantity: 'decimal', unit_cost_minor: 'decimal' },
  account_balances: { account_id: 'string', household_id: 'string', balance_minor: 'decimal', quantity: 'decimal', avg_cost_minor: 'decimal', updated_at: 'datetime' },
  deposit_meta: { account_id: 'string', household_id: 'string', interest_minor: 'decimal', start_date: 'date', end_date: 'date', label: 'string' },
  position_meta: { account_id: 'string', household_id: 'string', instrument: 'string', category: 'string', option_json: 'string', fund_json: 'string' },
  audit_events: { id: 'string', household_id: 'string', journal_entry_id: 'string', actor: 'string', tool_name: 'string', request_id: 'string', detail: 'string', created_at: 'datetime' },
};

export const booksDatasets: Record<string, Dataset> = Object.fromEntries(Object.entries(tables).map(([table, columns]) => [
  `books_${table}`, { description: `All columns of the financial accounting ${table} table for the authenticated household.`,
    source: `books.${table}`, fields: Object.fromEntries(Object.entries(columns).map(([name, type]) => [name, field(type,
      name.endsWith('_minor') ? 'Exact integer in millionths of native currency (scale 6). Not whole currency units.'
        : name.endsWith('_json') || name === 'detail' ? 'Complete JSON serialized as text.' : `Recorded ${table}.${name}.`,
      name === 'amount_minor' ? { unit: 'native currency × 1000000', sum_group_by: ['currency'], comparison_group_by: ['currency'] }
        : name === 'balance_minor' || name === 'interest_minor' ? { unit: 'native currency × 1000000', sum_group_by: ['account_id'], comparison_group_by: ['account_id'] }
          : {} )])),
    available: () => isBooksEnabled(), rows: () => { throw new Error('Accounting datasets must be loaded through query_data.'); },
    caveats: ['Accounting changes and reconciliations are not necessarily broker executions or realized profit. Inspect entry_type, external_ref, memo and linked accounts.',
      'Money columns ending in _minor use scale 6. Quantity is instrument units; join account_id to books_accounts for currency and identity.',
      'Read-only household-scoped database snapshot. Source version covers this table, independently of investor-state revision.'],
  } satisfies Dataset,
]));

export async function loadBooksDataset(name: string, userId: string): Promise<Dataset> {
  const definition = booksDatasets[name];
  if (!definition) throw new Error('Unknown accounting dataset.');
  if (!isBooksEnabled()) return { ...definition, rows: () => [] };
  const table = name.slice('books_'.length);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SELECT set_config('app.household_id', $1, true)", [userId]);
    const columns = Object.keys(tables[table]);
    const tenantColumn = table === 'households' ? 'id' : 'household_id';
    const key = columns.includes('id') ? 'id' : 'account_id';
    // Keep calendar dates as database text: pg's Date parser otherwise shifts them in non-UTC timezones.
    const projection = columns.map(c => tables[table][c] === 'date' ? `"${c}"::text AS "${c}"` : `"${c}"`).join(', ');
    const response = await client.query(`SELECT ${projection} FROM "${table}" WHERE "${tenantColumn}" = $1::uuid ORDER BY "${key}" LIMIT $2`, [userId, limits.source_rows + 1]);
    if (response.rows.length > limits.source_rows) throw new Error('Accounting source row limit exceeded; no partial result returned.');
    const rows: Row[] = response.rows.map(raw => Object.fromEntries(columns.map(column => {
      const value = raw[column];
      return [column, value == null ? null : value instanceof Date ? tables[table][column] === 'date' ? value.toISOString().slice(0, 10) : value.toISOString()
        : typeof value === 'object' ? JSON.stringify(value) : value];
    })));
    await client.query('COMMIT');
    return { ...definition, rows: () => rows, source_version: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
