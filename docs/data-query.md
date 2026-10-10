# Discoverable investor data queries

Agents can construct read-only queries using two tools available to every domain role:

1. `get_data_dictionary`: discover datasets, fields, types, units, date meanings, source limitations, availability and relationship keys. Pass `dataset` to narrow the response.
2. `query_data`: execute a declarative JSON query. Authentication is bound by the framework; never supply another user's identity.

This interface supplements existing task-specific tools. It reads the current investor-state snapshot and does not sync brokers, fetch prices, execute SQL/code, or mutate books. Current schemas are published through the tool rather than assumed from this document.

## Datasets

| Dataset | Meaning |
| --- | --- |
| `positions` | Current stored lots, with reconciled option opening ranges and verification status |
| `option_executions` | Retained dated option executions; Webull rows represent cumulative terminal order fills |
| `option_events` | Explicit broker lifecycle records, including assignment, exercise and expiration |
| `broker_accounts` | Account/channel identity and recorded sync state, without credentials or provider configuration |
| `cash_balances` | Available cash sleeves; settled cash and accrued interest are separate nullable fields |
| `deposits` | Locked principal and full-term interest |
| `properties` | Recorded property marks and mortgage links |
| `liabilities` | Recorded debt and payment terms |
| `cash_flows` | Scheduled income/expense lines with explicit frequency, not executed cash transactions |

Stock execution history, SQL accounting journals, raw files, live quotes, auth profiles, secrets and arbitrary nested state are outside these datasets. Use the dedicated source, accounting and market tools for those requests. There are no general joins in version 1; related datasets can be queried at the same revision using dictionary relationship keys. Position opening evidence is already reconciled with executions, lifecycle events, broker account, contract identity, side and remaining quantity.

## Custom date-window query

For TSLA put openings from September 10 through October 10, 2026:

```json
{
  "query": {
    "from": "option_executions",
    "select": ["channel", "account_id", "execution_id", "trade_date", "expiry", "strike", "contracts", "currency", "net_premium"],
    "where": {
      "all": [
        {"field": "underlying", "op": "eq", "value": "TSLA"},
        {"field": "right", "op": "eq", "value": "put"},
        {"field": "effect", "op": "eq", "value": "open"},
        {"field": "trade_date", "op": "gte", "value": "2026-09-10"},
        {"field": "trade_date", "op": "lte", "value": "2026-10-10"}
      ]
    },
    "order_by": [{"field": "executed_at", "direction": "desc"}],
    "limit": 50
  }
}
```

These dates are illustrative. Compute the actual requested window from the current date and clarify inclusivity when needed. `trade_date` uses the retained broker-local clock. Expiry, sync attempt, book recording and lifecycle dates have different meanings. Do not append a UTC timezone to a naive broker-local timestamp.

For “currently open and opened during this window,” query `positions.opened_from`, `opened_to`, and `opening_status`. An execution with `effect=open` alone does not prove the position remains open or establish broker tax-lot allocation.

## Filters and aggregates

Filters combine `all`, `any`, and `not`, or use `{field, op, value}`. Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `contains`, `starts_with`, `is_null`, `not_null`. Null operators omit value. Text matches are case-sensitive. Decimal predicates require strings (for example strike `"375"`). Numeric predicates require finite numbers. Unknown values propagate through logical filters; use explicit null predicates to find missing values.

To group premium cash activity by broker channel and currency:

```json
{
  "query": {
    "from": "option_executions",
    "group_by": ["channel", "currency"],
    "aggregates": [
      {"op": "count", "as": "records"},
      {"op": "sum", "field": "gross_premium", "as": "gross_cash"},
      {"op": "sum", "field": "net_premium", "as": "net_cash"}
    ],
    "order_by": [{"field": "channel"}, {"field": "currency"}]
  }
}
```

This is signed activity, not realized P/L or a count of currently open contracts. Add filters for the required activity type and period.

- `count` without a field counts records; `count(field)` counts reported values.
- `sum`, `min`, and `max` require a field. Sum is allowed only for fields with documented `sum_group_by` partitions. Monetary comparisons require documented `comparison_group_by` partitions. No implicit FX or frequency/unit conversion occurs.
- Sums return exact decimal strings. For stored numeric amounts, they sum the decimal representation of the stored number; they cannot recover precision already lost before storage.
- Missing members produce a null sum/min/max rather than a misleading partial total. `aggregation_missing_values` counts missing members across the entire filtered input, not just the returned page.
- Grouped queries omit `select`; output contains group keys and aggregate aliases. Aggregates run on the full filtered source before pagination. Sort can reference an unselected source field or an aggregate alias; nulls sort last.

## Completeness and pagination

Every response includes `revision`, `available`, source/matched/output counts, `next_offset`, and caveats. `available=false` returns empty rows and null counts: the dataset is unrecorded, not known zero. An explicitly recorded empty collection is distinguishable but still does not prove there was no real-world activity.

Use the first response's `revision` as `expected_revision` on further pages and related queries. If state changes, restart from offset zero; do not combine records from different revisions. Each page allows 1–200 rows (default 50). Inputs are bounded to 20,000 characters, filters to 80 nodes/eight levels, source collections to 50,000 rows, and serialized responses to 64 KiB. Oversized responses fail explicitly; reduce selection/limit and continue pagination. Data is never silently cut to fit a response.

Broker history may be incomplete, syncs may fail, and marks are stored values rather than new quotes. This tool's result caveats remain relevant even if filtering removes missing fields from the visible rows.

## Extending the dictionary

Add a dataset and explicit scalar field mappings in `src/data-query/catalog.ts`. The dictionary and query validation share these definitions. Specify types, units, nullable semantics, safe aggregate partitions, source availability and caveats. Keep credential/auth/file internals out of row mappings. Add regression coverage for the source semantics and any new aggregation/relationship behavior. The interpreter in `src/data-query/engine.ts` does not run model-authored SQL, expressions or functions.

## Validation

- TypeScript check passed with `node node_modules/typescript/bin/tsc --noEmit`.
- 73 focused tests passed across eight files, including 18 new query tests, role registration, authenticated identity binding, raw source isolation, option opening evidence and the prior accuracy regressions.
- The earlier audit full suite had 46 reproduced baseline failures; this task does not claim those unrelated legacy fixtures have been repaired. No live broker sync or production data mutation was used for testing.
