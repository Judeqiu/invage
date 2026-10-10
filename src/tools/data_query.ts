import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { datasets, relationships } from '../data-query/catalog.js';
import { limits, operators, runQuery } from '../data-query/engine.js';
import { channelIdParams, resolveInvestorFromChannel, type ChannelIds } from './channel.js';

export const DATA_QUERY_GUIDE = '\nFor custom stored-data questions, discover fields and their date/unit meanings with get_data_dictionary, then construct query_data filters, projections, sort orders, and aggregates. Use returned revision as expected_revision when continuing pagination or querying related datasets. Inspect available and caveats before claiming no records. Execution dates, lifecycle dates, expiry, book update dates and sync times differ. Amounts are native currency; grouped sums require dictionary partition keys. These tools do not fetch live market data, modify books, or expose credentials.';
function result<T>(details: T) { return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details }; }
function failure(error: unknown) { return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], details: null }; }

export function createDataQueryTools(): AgentTool[] {
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
            description: d.description, available: d.available(snapshot.state), fields: d.fields, caveats: d.caveats,
          }]; })), relationships, limits,
          language: { from: 'One dataset name. Queries are declarative JSON, not SQL or executable code.',
            select: 'Optional field array; defaults to every documented field. No arbitrary nested paths.',
            where: 'Nested all/any/not, or {field,op,value}; operators: ' + operators.join(', ') + '. Text is case-sensitive; use exact decimal strings for decimal predicates. Null predicates omit value.',
            group_by: 'Field array used with aggregates. sum requires every field listed in sum_group_by.',
            aggregates: 'Array of {op: count|sum|min|max, field?, as}. min/max require comparison_group_by when documented. count without field counts rows; other operations require field. Sum outputs exact decimal strings; missing members produce null, not partial totals.',
            order_by: 'Array of {field,direction: asc|desc}. May use fields omitted from select, or aggregate aliases. Nulls sort last.',
            pagination: 'limit 1–200, offset >= 0. First response supplies revision; subsequent pages require expected_revision. Aggregation uses the full filtered dataset before pagination.',
            joins: 'No implicit or arbitrary joins in v1. Query related datasets at the same revision using dictionary relationship keys; positions include reconciled opening evidence.',
          }, examples: [
            { from: 'option_executions', select: ['channel', 'account_id', 'execution_id', 'trade_date', 'expiry', 'strike', 'contracts', 'gross_premium'],
              where: { all: [{ field: 'underlying', op: 'eq', value: 'TSLA' }, { field: 'effect', op: 'eq', value: 'open' }, { field: 'trade_date', op: 'gte', value: '2026-09-10' }] },
              order_by: [{ field: 'executed_at', direction: 'desc' }], limit: 50 },
            { from: 'option_executions', group_by: ['channel', 'currency'], aggregates: [{ op: 'count', as: 'records' }, { op: 'sum', field: 'net_premium', as: 'net_cash' }] },
          ], caveats: ['Example dates are illustrative; calculate actual requested windows from current date.',
            'available=false means storage is unrecorded. available=true with no rows means the stored collection is empty, not proof that no real-world activity occurred.',
            'Accounting journal dates are not execution dates; this interface does not expose SQL journals, auth state, broker credentials, arbitrary files or live feeds.'] });
      } catch (error) { return failure(error); }
    },
  }, {
    name: 'query_data', label: 'Query Stored Data',
    description: 'Execute a custom read-only structured query on the authenticated investor data. Discover dataset/field/date/unit definitions with get_data_dictionary. Supports nested predicates, selection, sorting, grouping, count/sum/min/max and revision-pinned pagination. No live sync, SQL, code execution, implicit FX or writes. All result data and caveats are agent-visible.',
    parameters: Type.Object({ ...channelIdParams,
      query: Type.Object({ from: Type.String(), select: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })), where: Type.Optional(filter),
        group_by: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
        aggregates: Type.Optional(Type.Array(Type.Object({ op: Type.Union(['count', 'sum', 'min', 'max'].map(op => Type.Literal(op))), field: Type.Optional(Type.String()), as: Type.String() }, { additionalProperties: false }), { maxItems: 20 })),
        order_by: Type.Optional(Type.Array(Type.Object({ field: Type.String(), direction: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])) }, { additionalProperties: false }), { maxItems: 10 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), offset: Type.Optional(Type.Integer({ minimum: 0 })),
        expected_revision: Type.Optional(Type.Integer({ minimum: 0 })),
      }, { additionalProperties: false }),
    }),
    async execute(_id, raw) {
      try { const p = raw as ChannelIds & { query: unknown }; return result(runQuery(await resolveInvestorFromChannel(p), p.query)); }
      catch (error) { return failure(error); }
    },
  }];
}
