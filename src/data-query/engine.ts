import { addDecimals, decimal, validDate } from '../brokers/option-executions.js';
import { datasets, type Cell, type Dataset, type Field, type Row } from './catalog.js';
import type { InvestorSnapshot } from '../state/investor-store.js';

export const operators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'starts_with', 'is_null', 'not_null'] as const;
export interface Query {
  from: string;
  select?: string[];
  where?: unknown;
  group_by?: string[];
  aggregates?: Array<{ op: 'count' | 'sum' | 'min' | 'max'; field?: string; as: string }>;
  order_by?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
  expected_revision?: number;
  expected_source_version?: string;
  source?: { file_id: string; version: string };
}
export const limits = { rows: 200, default_rows: 50, input_chars: 20000, output_bytes: 65536, source_rows: 50000, filter_nodes: 80, filter_depth: 8 };
function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${label} key: ${key}`);
  return value as Record<string, unknown>;
}
function fieldFor(fields: Record<string, Field>, name: unknown): Field {
  if (typeof name !== 'string' || !Object.hasOwn(fields, name)) throw new Error(`Unknown field: ${String(name)}. Read get_data_dictionary.`);
  return fields[name];
}
function fieldList(value: unknown, fields: Record<string, Field>, label: string): string[] {
  if (!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== 'string')) throw new Error(`${label} must be an array of at most 50 field names.`);
  if (new Set(value).size !== value.length) throw new Error(`Duplicate ${label} fields.`);
  value.forEach(name => fieldFor(fields, name)); return value;
}
/** Plain decimal expansion preserves stored number values without adding FX or rounding. */
function decimalText(value: Cell): string {
  if (typeof value === 'string') return decimal(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Nonfinite or nonnumeric source value.');
  const text = String(value);
  if (!/[eE]/.test(text)) return decimal(text);
  const [mantissa, exponent] = text.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const [whole, fraction = ''] = mantissa.replace('-', '').split('.');
  const digits = whole + fraction; const point = whole.length + Number(exponent);
  const expanded = point <= 0 ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
      : digits.slice(0, point) + '.' + digits.slice(point);
  return decimal((negative ? '-' : '') + expanded);
}
function compare(a: Cell, b: Cell, field: Field): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1; // nulls last
  if (field.type === 'number' || field.type === 'decimal') {
    // Compare signed scaled integers, including negative amounts.
    const texts = [decimalText(a), decimalText(b)];
    const scale = Math.max(...texts.map(t => t.split('.')[1]?.length ?? 0));
    const ints = texts.map(t => { const neg = t.startsWith('-'); const [i, f = ''] = t.replace('-', '').split('.'); return BigInt(i + f.padEnd(scale, '0')) * (neg ? -1n : 1n); });
    return ints[0] < ints[1] ? -1 : ints[0] > ints[1] ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
function validateValue(value: unknown, field: Field, predicateValue = true): asserts value is Exclude<Cell, null> {
  if (value === null || value === undefined) throw new Error('Use is_null/not_null for missing values.');
  if (field.type === 'decimal') {
    if (typeof value !== 'string') throw new Error('Decimal predicates require exact decimal strings.'); decimal(value); return;
  }
  if (field.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Numeric predicates require finite numbers.'); return; }
  if (field.type === 'boolean') { if (typeof value !== 'boolean') throw new Error('Boolean predicates require true/false.'); return; }
  if (typeof value !== 'string' || (predicateValue && value.length > 2000)) throw new Error('Text predicates require bounded strings.');
  if (field.type === 'date' && !validDate(value)) throw new Error('Date predicates require a valid YYYY-MM-DD date.');
  if (field.type === 'datetime' && (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) || !validDate(value.slice(0, 10)))) throw new Error('Datetime predicates require an explicit ISO-style timestamp; use trade_date for broker-local date windows.');
}
type Match = boolean | null;
function predicate(raw: unknown, fields: Record<string, Field>): (row: Row) => Match {
  let nodes = 0;
  function build(value: unknown, depth: number): (row: Row) => Match {
    if (++nodes > limits.filter_nodes || depth > limits.filter_depth) throw new Error('Filter complexity limit exceeded.');
    const p = object(value, ['all', 'any', 'not', 'field', 'op', 'value'], 'filter');
    const logical = ['all', 'any', 'not'].filter(k => Object.hasOwn(p, k));
    if (logical.length) {
      if (logical.length !== 1 || Object.keys(p).length !== 1) throw new Error('Use exactly one logical filter key.');
      const key = logical[0];
      if (key === 'not') { const child = build(p.not, depth + 1); return row => { const value = child(row); return value === null ? null : !value; }; }
      if (!Array.isArray(p[key]) || !p[key].length || p[key].length > limits.filter_nodes) throw new Error('all/any require a nonempty bounded filter array.');
      const children = p[key].map(child => build(child, depth + 1));
      return row => {
        const values = children.map(child => child(row));
        return key === 'all' ? values.includes(false) ? false : values.includes(null) ? null : true
          : values.includes(true) ? true : values.includes(null) ? null : false;
      };
    }
    const f = fieldFor(fields, p.field); const key = p.field as string;
    if (!(operators as readonly unknown[]).includes(p.op)) throw new Error('Unknown filter operator. Read get_data_dictionary.');
    const op = p.op;
    if (op === 'is_null' || op === 'not_null') {
      if (Object.hasOwn(p, 'value')) throw new Error('Null operators do not take value.');
      return op === 'is_null' ? row => row[key] == null : row => row[key] != null;
    }
    if (op === 'in' || op === 'not_in') {
      if (!Array.isArray(p.value) || !p.value.length || p.value.length > 100) throw new Error('in/not_in require 1–100 values.');
      p.value.forEach(v => validateValue(v, f)); const values = p.value as Cell[];
      return row => row[key] == null ? null : (values.some(v => compare(row[key], v, f) === 0) === (op === 'in'));
    }
    validateValue(p.value, f); const target = p.value;
    if (op === 'contains' || op === 'starts_with') {
      if (f.type !== 'string') throw new Error('contains/starts_with require a string field.');
      return row => row[key] == null ? null : (op === 'contains' ? (row[key] as string).includes(target as string) : (row[key] as string).startsWith(target as string));
    }
    if (f.type === 'boolean' && !['eq', 'ne'].includes(op as string)) throw new Error('Booleans support eq/ne only.');
    return row => {
      if (row[key] == null) return null;
      const c = compare(row[key], target, f);
      return op === 'eq' ? c === 0 : op === 'ne' ? c !== 0 : op === 'gt' ? c > 0 : op === 'gte' ? c >= 0 : op === 'lt' ? c < 0 : c <= 0;
    };
  }
  return build(raw, 0);
}

export function runQuery(snapshot: InvestorSnapshot, raw: unknown, catalog: Record<string, Dataset> = datasets) {
  if (JSON.stringify(raw).length > limits.input_chars) throw new Error('Query input limit exceeded.');
  const p = object(raw, ['from', 'select', 'where', 'group_by', 'aggregates', 'order_by', 'limit', 'offset', 'expected_revision', 'expected_source_version', 'source'], 'query') as unknown as Query;
  if (typeof p.from !== 'string' || !Object.hasOwn(catalog, p.from)) throw new Error('Unknown dataset. Read get_data_dictionary.');
  const dataset = catalog[p.from]; const fields = dataset.fields;
  if (p.source !== undefined && p.from !== 'source_records') throw new Error('source is only supported for source_records.');
  if (p.expected_source_version !== undefined && p.expected_source_version !== dataset.source_version) throw new Error('Source data changed; restart from offset 0.');
  const limit = p.limit ?? limits.default_rows; const offset = p.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > limits.rows || !Number.isSafeInteger(offset) || offset < 0) throw new Error('limit must be 1–200; offset must be a nonnegative integer.');
  if (p.expected_revision !== undefined && (!Number.isSafeInteger(p.expected_revision) || p.expected_revision !== snapshot.revision)) throw new Error('Data revision changed or expected_revision is invalid. Restart the query from offset 0.');
  if (offset > 0 && p.expected_revision === undefined) throw new Error('Pagination requires expected_revision from the first response.');
  if (offset > 0 && dataset.source_version && p.expected_source_version === undefined) throw new Error('External-source pagination requires expected_source_version from the first response.');
  const selected = p.select === undefined ? Object.keys(fields) : fieldList(p.select, fields, 'select');
  if (!selected.length) throw new Error('select must not be empty.');
  const groupBy = p.group_by === undefined ? [] : fieldList(p.group_by, fields, 'group_by');
  const filter = p.where === undefined ? () => true : predicate(p.where, fields);
  let outputFields = fields;
  const aggregates = p.aggregates;
  if (aggregates !== undefined) {
    if (!Array.isArray(aggregates) || !aggregates.length || aggregates.length > 20) throw new Error('aggregates must contain 1–20 operations.');
    if (p.select !== undefined) throw new Error('For grouped queries, output is group_by plus aggregate aliases; omit select.');
    outputFields = Object.fromEntries(groupBy.map(k => [k, fields[k]]));
    for (const a of aggregates) {
      object(a, ['op', 'field', 'as'], 'aggregate');
      if (!['count', 'sum', 'min', 'max'].includes(a.op) || typeof a.as !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(a.as) || Object.hasOwn(outputFields, a.as) || Object.hasOwn(fields, a.as)) throw new Error('Invalid or duplicate aggregate operation/alias.');
      const f = a.field === undefined ? null : fieldFor(fields, a.field);
      if (a.op !== 'count' && !f) throw new Error('sum/min/max require a field.');
      if (a.op === 'sum') {
        if (!f || !['number', 'decimal'].includes(f.type) || !f.sum_group_by) throw new Error('Field is not safely summable; inspect sum_group_by in dictionary.');
        if (f.sum_group_by.some(k => !groupBy.includes(k))) throw new Error(`sum(${a.field}) requires group_by: ${f.sum_group_by.join(', ')}; no implicit FX or unit conversion.`);
      }
      if ((a.op === 'min' || a.op === 'max') && f?.comparison_group_by?.some(k => !groupBy.includes(k))) {
        throw new Error(`${a.op}(${a.field}) requires group_by: ${f.comparison_group_by.join(', ')}; no implicit currency/unit conversion.`);
      }
      outputFields[a.as] = a.op === 'count' ? { type: 'number', description: 'Count', nullable: false }
        : a.op === 'sum' ? { ...f!, type: 'decimal' } : f!;
    }
  } else if (groupBy.length) throw new Error('group_by requires aggregates.');
  const orderBy = p.order_by ?? [];
  if (!Array.isArray(orderBy) || orderBy.length > 10) throw new Error('order_by must contain at most 10 fields.');
  for (const o of orderBy) { object(o, ['field', 'direction'], 'order_by'); fieldFor(outputFields, o.field); if (o.direction !== undefined && !['asc', 'desc'].includes(o.direction)) throw new Error('Sort direction must be asc/desc.'); }
  const available = dataset.available(snapshot.state);
  const source = available ? dataset.rows(snapshot.state) : [];
  if (source.length > limits.source_rows) throw new Error('Source row limit exceeded; this query has not scanned complete data.');
  for (const row of source) for (const [key, f] of Object.entries(fields)) if (row[key] != null) validateValue(row[key], f, false);
  const matched = source.filter(row => filter(row) === true);
  const missing: Record<string, number> = {};
  let rows: Row[];
  if (aggregates && available) {
    const groups = new Map<string, Row[]>();
    for (const row of matched) { const key = JSON.stringify(groupBy.map(k => row[k])); const prior = groups.get(key); if (prior) prior.push(row); else groups.set(key, [row]); }
    if (!groupBy.length && !matched.length) groups.set('[]', []);
    rows = [...groups.values()].map(group => {
      const out: Row = Object.fromEntries(groupBy.map(k => [k, group[0][k]]));
      for (const a of aggregates) {
        const partition = a.op === 'sum' ? fields[a.field!].sum_group_by : a.op === 'min' || a.op === 'max' ? fields[a.field!].comparison_group_by : undefined;
        if (partition?.some(k => group.some(r => r[k] == null))) throw new Error('Cannot aggregate amounts with unknown currency/unit partition.');
        const values = a.field === undefined ? [] : group.map(r => r[a.field!]).filter(v => v !== null);
        const unknown = a.field === undefined ? 0 : group.length - values.length;
        missing[a.as] = (missing[a.as] ?? 0) + unknown;
        if (a.op === 'count') out[a.as] = a.field === undefined ? group.length : values.length;
        else if (unknown || !values.length) out[a.as] = null;
        else if (a.op === 'sum') {
          out[a.as] = addDecimals(...values.map(decimalText));
        } else { const f = fields[a.field!]; out[a.as] = values.reduce((v, next) => (compare(next, v, f) * (a.op === 'min' ? 1 : -1) < 0) ? next : v); }
      }
      return out;
    });
  } else rows = available ? matched.map(row => Object.fromEntries(selected.map(k => [k, row[k]]))) : [];
  // Sort source values before projection, so ordering can use a field omitted from select.
  const sortingRows = aggregates ? rows : available ? matched : [];
  if (orderBy.length) sortingRows.sort((a, b) => {
    for (const o of orderBy) { const av = a[o.field]; const bv = b[o.field]; const c = compare(av, bv, outputFields[o.field]); if (c) return av === null || bv === null ? c : c * (o.direction === 'desc' ? -1 : 1); } return 0;
  });
  if (!aggregates) rows = sortingRows.map(row => Object.fromEntries(selected.map(k => [k, row[k]])));
  const details = { schema_version: 1, from: p.from, revision: snapshot.revision, available,
    source: dataset.source ?? 'investor_state', source_version: dataset.source_version ?? null,
    source_rows: available ? source.length : null, matched_source_rows: available ? matched.length : null,
    total_rows: available ? rows.length : null, offset, limit, rows: rows.slice(offset, offset + limit),
    next_offset: offset + limit < rows.length ? offset + limit : null,
    columns: Object.fromEntries((aggregates ? Object.keys(outputFields) : selected).map(key => [key, outputFields[key]])),
    aggregation_missing_values: missing, caveats: [...dataset.caveats,
      'Null is unknown/unreported. sum/min/max return null for any missing member; count(field) counts reported values only. Aggregates run before pagination.',
      'Strings are case-sensitive. Datetimes compare recorded clock text; do not compare clocks from different timezones. Revision covers stored investor state only. No live provider sync or implicit FX.'],
  };
  if (Buffer.byteLength(JSON.stringify(details), 'utf8') > limits.output_bytes) throw new Error('Output exceeds 64 KiB; reduce limit/select and paginate. No partial result was returned.');
  return details;
}
