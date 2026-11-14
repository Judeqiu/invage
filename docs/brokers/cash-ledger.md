# Channel-scoped broker cash ledger

`InvestorState.broker_cash_ledgers` is keyed by the immutable custody channel.
Each ledger binds `broker_id`, `channel` and `account_id`. Statement application
validates all bindings before any books writes. Existing accounts without the
field remain compatible; absence means unrecorded, not no cash activity.

The ledger is source evidence, separate from cash balances, fixed deposits,
orders and executions. Importing historical deposits does not post them again
to cash or change return, premium, cost-basis or profit calculations.

Each retained batch records its API source, observation time, requested inclusive
business dates and segments, completeness, gaps, archive reference and evidence
digest. Complete means complete pagination and normalization for that request;
it does not assert lifetime history, continuous coverage between requests or
coverage of endpoints and segments not requested. A partial fetch retains its
returned rows and explicit gaps. Successful later requests do not erase previous
evidence or earlier coverage gaps.

Records preserve the broker ID, segment, business date, exact signed decimal
amount, currency, reported type, description, contract label, source update-time
token and source JSON Pointer. Unknown fields remain null. Broker business dates
are not execution timestamps, contract labels are not verified contract joins,
and descriptions are never used to classify or authorize behavior. The digest
identifies the retained raw evidence section; the archive reference identifies
the whole source document. Source bytes continue through the existing lossless
archive and evidence capture paths.

Batch observation identities make identical replay idempotent. Later observations,
including changed source data and values that revert to an earlier value,
are retained in new batches. The current-record projection chooses the latest
retrieval observation for each source/segment/native-ID combination. This is an
observation version, not a claim about the broker's original economic sequence.
Equally timed conflicting observations fail before persistence. Missing rows do
not delete retained records. Distinct source endpoints are not assumed to be
distinct economic movements; funding-history and fund-details records must not
be added together without explicit source-backed reconciliation.

## Query datasets

- `broker_cash_ledger`: current retained records, without repeated snapshot rows.
- `broker_cash_ledger_versions`: every retained observation for audit; do not sum
  these as unique cash movements.
- `broker_cash_ledger_coverage`: request dates, segments, returned counts, gaps,
  completeness and archive provenance, independent of execution-history status.

Use `get_data_dictionary` and `query_data` with the existing revision-pinned
pagination and exact-decimal query engine. Filter by channel/account,
`business_date`, currency and exact `reported_type`. Monetary aggregation requires
currency grouping; the engine does not invent FX. These queries also work through
`financial_state` under the `broker_cash_ledgers` root.

Example deposit query (the channel value comes from `broker_accounts`):

```json
{
  "from": "broker_cash_ledger",
  "where": {
    "all": [
      {"field": "channel", "op": "eq", "value": "<channel>"},
      {"field": "reported_type", "op": "eq", "value": "Deposit"}
    ]
  }
}
```

## Tiger ingestion

History-enabled Tiger Prime sync retrieves `fund_details` with `fund_type=ALL`
and the securities, futures and fund segments across the history sync request's
date bounds, including accounts with no trades. Explicit Full sync requests the
available historical range; Latest sync retains its existing incremental date
behavior. Adding this model does not automatically backfill existing accounts.
Global-account fund-details support is not established and is not claimed.

Pagination checks page progression, stable totals when supplied, unique native
IDs and final returned count. Broker rate pacing is preserved. Raw numbers remain
exact strings in the transport. Existing fee enrichment consumes this same
evidence without treating the ledger as extra execution cash. Old archives that
do not record requested segments remain queryable with an explicit coverage gap.

The dedicated Tiger funding-history query remains separate read-only verification
evidence; this change does not import it as a second set of cash movements.
No UI, production backfill or deployment is included in this change.
