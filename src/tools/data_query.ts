import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { relationships } from '../data-query/catalog.js';
import { queryDatasets, loadQueryCatalog } from '../data-query/sources.js';
import { financialRoots } from '../data-query/records.js';
import { limits, operators, runQuery } from '../data-query/engine.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

export const DATA_QUERY_GUIDE = '\nFor stored-data questions, use get_data_dictionary and query_data across ALL financial sources: positions (stocks/funds/options), financial_state (every nested financial field), books_* accounting tables, valuation_snapshots, broker_sync_runs, raw_files, and source_records (complete archived broker JSON/XML/CSV/YAML). For source_records provide source:{file_id,version} from raw_files. Use revision as expected_revision and source_version as expected_source_version for subsequent pages. An option-only dataset does NOT establish absence of stock data: inspect positions and relevant archives before claiming missing stock trades or profit. Held-stock appreciation can use recorded quantity/cost plus get_quote; sold-stock profit requires verified sales/cost evidence. Accounting reconciliations, option premium cash flows and realized P/L are different; do not call them interchangeable journals or profits. Read availability, dates, units and caveats; no implicit FX. Produce available report sections and label remaining gaps. These read tools do not modify data, fetch live quotes, or expose credentials.';
function result<T>(details: T) { return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details }; }
function failure(error: unknown) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], details: null }; }

export function createDataQueryTools(options: { allowDrive?: boolean } = {}): AgentTool[] {
  const datasets = options.allowDrive === false ? Object.fromEntries(Object.entries(queryDatasets)
    .filter(([name]) => !['raw_files', 'source_records', 'valuation_snapshots'].includes(name))) : queryDatasets;
  const filter = Type.Object({
    all: Type.Optional(Type.Array(Type.Unknown(), { minItems: 1, maxItems: 80, description: 'Nested filters, all must match.' })),
    any: Type.Optional(Type.Array(Type.Unknown(), { minItems: 1, maxItems: 80, description: 'Nested filters, at least one must match.' })),
    not: Type.Optional(Type.Unknown({ description: 'One nested filter to negate. Unknown values stay unknown.' })),
    field: Type.Optional(Type.String()), op: Type.Optional(Type.Union(operators.map(op => Type.Literal(op)))),
    value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), { maxItems: 100 })])),
  }, { additionalProperties: false, description: 'Exactly one of {all:[filters]}, {any:[filters]}, {not:filter}, or {field,op,value?}. Nest the same structure; null operators omit value.' });
  return [{
    name: 'get_data_dictionary', label: 'Get Data Dictionary',
    description: 'Discover queryable stored datasets, field types, native units, date meanings, null semantics, safe aggregate partitions and relationship keys. No credentials, no sync. Call before constructing query_data; optional dataset narrows the dictionary.',
    parameters: Type.Object({ ...channelIdParams, dataset: Type.Optional(Type.String()) }),
    async execute(_id, raw) {
      try {
        const p = raw as ChannelIds & { dataset?: string };
        if (p.dataset !== undefined && (typeof p.dataset !== 'string' || !Object.hasOwn(datasets, p.dataset))) throw new Error('Unknown dataset. Omit dataset to list all.');
        const snapshot = await resolveInvestorFromChannel(p);
        const names = p.dataset === undefined ? Object.keys(datasets) : [p.dataset];
        return result({ schema_version: 1, revision: snapshot.revision,
          datasets: Object.fromEntries(names.map(name => { const d = datasets[name]; return [name, {
            description: d.description, source: d.source ?? 'investor_state', available: d.available(snapshot.state), fields: d.fields, caveats: d.caveats,
          }]; })), relationships, limits,
          financial_state_roots: financialRoots.filter(root => (snapshot.state as unknown as Record<string, unknown>)[root] !== undefined),
          language: { from: 'One dataset name. Queries are declarative JSON, not SQL or executable code.',
            select: 'Optional field array; defaults to every documented field. No arbitrary nested paths.',
            where: 'Nested all/any/not, or {field,op,value}; operators: ' + operators.join(', ') + '. Text is case-sensitive; use exact decimal strings for decimal predicates. Null predicates omit value.',
            group_by: 'Field array used with aggregates. sum requires every field listed in sum_group_by.',
            aggregates: 'Array of {op: count|sum|min|max, field?, as}. min/max require comparison_group_by when documented. count without field counts rows; other operations require field. Sum outputs exact decimal strings; missing members produce null, not partial totals.',
            order_by: 'Array of {field,direction: asc|desc}. May use fields omitted from select, or aggregate aliases. Nulls sort last.',
            pagination: 'limit 1–200, offset >= 0. Subsequent pages require expected_revision plus expected_source_version for external stores. Aggregation uses the full filtered dataset before pagination.',
            source: 'For source_records only: {file_id,version} from raw_files. Reads all source fields without instrument filtering. Unsupported/binary or oversized sources remain accessible through fetch_raw_data.',
            joins: 'No implicit or arbitrary joins in v1. Query related datasets at the same revision using dictionary relationship keys; positions include reconciled opening evidence.',
          }, examples: [
            { from: 'positions', where: { field: 'instrument', op: 'eq', value: 'equity' }, select: ['key', 'channel', 'currency', 'units', 'avg_price'] },
            { from: 'financial_state', where: { field: 'root', op: 'eq', value: 'portfolio' } },
            { from: 'raw_files', where: { field: 'channel', op: 'eq', value: 'ibkr' } },
            { from: 'option_executions', select: ['channel', 'account_id', 'execution_id', 'trade_date', 'expiry', 'strike', 'contracts', 'gross_premium'],
              where: { all: [{ field: 'underlying', op: 'eq', value: 'TSLA' }, { field: 'effect', op: 'eq', value: 'open' }, { field: 'trade_date', op: 'gte', value: '2026-09-10' }] },
              order_by: [{ field: 'executed_at', direction: 'desc' }], limit: 50 },
            { from: 'option_executions', group_by: ['channel', 'currency'], aggregates: [{ op: 'count', as: 'records' }, { op: 'sum', field: 'net_premium', as: 'net_cash' }] },
          ], caveats: ['Example dates are illustrative; calculate actual requested windows from current date.',
            'available=false means storage is unrecorded. available=true with no rows means the stored collection is empty, not proof that no real-world activity occurred.',
            'Accounting tables are exposed through books_*; their entries are not necessarily executions or profit. Missing history in one dataset does not establish absence in other stores.',
            'Scope is the authenticated user’s financial data and Drive. Auth secrets and framework administration are excluded. Live quotes remain available through market tools, not stored-data queries.'] });
      } catch (error) { return failure(error); }
    },
  }, {
    name: 'query_data', label: 'Query Stored Data',
    description: 'Query every authenticated financial source: stocks/options/funds, nested financial state, books_* accounting tables, valuation_snapshots, broker_sync_runs, raw_files and complete source_records from archived broker JSON/XML/CSV/YAML. Supports predicates, projection, sorting, aggregates and version-pinned pagination. No live sync, arbitrary SQL, code execution, implicit FX or writes.',
    parameters: Type.Object({ ...channelIdParams,
      query: Type.Object({ from: Type.String(), select: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })), where: Type.Optional(filter),
        group_by: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
        aggregates: Type.Optional(Type.Array(Type.Object({ op: Type.Union(['count', 'sum', 'min', 'max'].map(op => Type.Literal(op))), field: Type.Optional(Type.String()), as: Type.String() }, { additionalProperties: false }), { maxItems: 20 })),
        order_by: Type.Optional(Type.Array(Type.Object({ field: Type.String(), direction: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])) }, { additionalProperties: false }), { maxItems: 10 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
        expected_revision: Type.Optional(Type.Integer({ minimum: 0 })),
        expected_source_version: Type.Optional(Type.String()),
        source: Type.Optional(Type.Object({ file_id: Type.String(), version: Type.String() }, { additionalProperties: false })),
      }, { additionalProperties: false }),
    }),
    async execute(_id, raw) {
      try {
        const p = raw as ChannelIds & { query: unknown }; const snapshot = await resolveInvestorFromChannel(p);
        const from = (p.query as { from?: unknown } | null)?.from;
        if (typeof from !== 'string' || !Object.hasOwn(datasets, from)) throw new Error('Unknown or unavailable dataset. Read get_data_dictionary.');
        return result(runQuery(snapshot, p.query, await loadQueryCatalog(snapshot, p.query)));
      }
      catch (error) { return failure(error); }
    },
  }];
}
