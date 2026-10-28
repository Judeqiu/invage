# Broker source capture

The additive source tables in the books PostgreSQL database preserve broker
evidence independently of the portfolio, financial ledger, shared execution
history and option journal. They do not alter any existing state or post money.
Apply `npm run books:migrate` with the database-owner environment before running
this code against a configured books database. The migration can be repeated.
No framework migration or destructive conversion is required.

## Data model

- `broker_source_documents`: original adapter payload bytes, SHA-256, broker/channel/account,
  format, extraction version, capture time, indexing status and coverage gaps.
  Content is deduplicated within that exact account scope and extraction version.
- `broker_source_records`: source observations indexed by document and structural
  path, including parent path, broker identifier when supplied, broad activity
  category, instrument classification and the broker's fields. JSON number
  tokens become exact strings, including fractional amounts and large IDs. XML
  attributes remain strings. Unknown fields and sections survive. Original
  bytes preserve numeric types, formatting, wrappers and all other source data
  present in the adapter payload. JSON adapters produce bundles of API responses;
  this is not a claim to retain original HTTP headers or wire-format bodies.
- `broker_source_receipts`: links a document to each sync request or original
  archive path. A repeated import of the same source reference is idempotent.

All tables are append-only, tenant isolated with forced RLS and protected against
update, delete and truncate. Foreign keys include household identity. Different
versions of a broker row remain separate observations, preserving corrections
and disagreements rather than silently choosing one. Extractor versions can be
added alongside old versions without destroying their evidence.

These are **source observations, not a deduplicated transaction ledger**. Never
sum them directly: overlapping reports repeat trades, orders repeat cumulative
fills, and a lifecycle event can include both option and stock delivery records.
Use broker/channel/account, record category and source ID to inspect versions,
then reconcile before deriving balances or profitability. `BookTrade` and other
broker transaction-type fields remain explicit source fields. No stock delivery
is fabricated as an ordinary exchange trade and no order fill becomes an
individual execution. No multiplier, fee, cash amount, timezone or position
effect is inferred by the capture layer.

## Sync and replay

Account sync captures the returned payload and every historical attachment before
parsing or applying portfolio projections. A parser or historical reconciliation
failure cannot erase the captured response. Capture failures stop a configured
database sync and use its existing failure/archive/retry path; no new checkpoint
or successful snapshot is saved before capture succeeds. A partially captured
attachment set is safe to retry because document and receipt writes are
idempotent. Legacy connector sync also captures evidence, using its parsed account
identity when no account was known before the fetch.

Malformed/unsupported payloads retain their original bytes with `unparsed` status.
Unbound payloads have `unverified` status. Account mismatches retain bytes under
the expected scope for audit, with `account_mismatch` status and no indexed rows.
Multi-account XML indexes only the selected statement. Account directories may
list other authorized accounts; transaction/position account mismatches are
rejected by the indexer. These statuses do not certify valid current snapshots;
the existing independent snapshot validation still applies.

Existing installations without `INVAGE_BOOKS_DATABASE_URL` continue to use their
filesystem archives. Database capture requires that URL and the additive schema;
there is no new filesystem-only fallback on a configured database failure.

Replay existing archives with the complete service environment:

```sh
node --import tsx scripts/capture-broker-activity.mjs <user> <connection>
node --import tsx scripts/capture-broker-activity.mjs <user> <connection> --apply
```

The default only reports a plan. Apply copies source evidence into the new tables;
it never replaces holdings, cash, legacy execution projections or checkpoints.
Only recognized broker JSON bundles are copied; state backups are excluded.
Original Drive archives remain in place. Summarized record counts are observation
counts across files, not unique trade totals. Replaying is safe after interruption.

## Coverage and known boundaries

Capture indexes all returned activity, including stock and FX trades, both option
rights, orders and legs, lifecycle orders, fees, current snapshots, and cash,
transfer or corporate-action sections when present. It includes all historical
rows in a returned Flex report even when incremental projection filtering only
imports recent fills. Absent Flex sections are explicit coverage gaps. Other
brokers explicitly report that unrequested/absent endpoints do not establish
zero activity. `indexed` means the returned response was indexed, not that the
broker's complete account history has been fetched.

This step does not request new broker endpoints or change Flex query settings.
Dividends, interest, transfers, deposits/withdrawals and corporate actions missing
from existing responses still require those broker sources. MooMoo HTTP 401
requires credential recovery before fresh data can arrive. Missing historical
contract sizes remain unknown until verified broker metadata is available.

The option-code parser now recognizes short strike encodings such as
`MBLY260821P8000`. New normalization correctly identifies these as options and
uses a verified size or retains unknown cash. Existing incorrectly classified
history is preserved: the normal conflict guard does not overwrite it on replay.
Repairing those old projections is a separate reviewed operation; source capture
and source indexing can succeed independently while that repair is pending.

## Dashboard source report

The V2 dashboard reads captured activity through authenticated, private/no-store
`GET /api/domain/invage/broker-activity`. It groups indexed observations by broker,
channel, account, category and supplied source ID. Rows without an ID remain
separate by document and structural path. Grouping is for inspection, not financial
posting: cumulative orders, lifecycle deliveries and overlapping captures must not
be summed as individual trades. The list exposes distinct reported values, absent
fields and version counts; `?key=<returned key>` returns every observation, child
record, document hash and receipt reference for that group. No preferred version,
financial total, inferred currency, timezone, amount or allocated fee is produced.
Numeric strings and any reported quantity scale remain visible as supplied.

`GET /api/domain/invage/broker-position-report?position=<portfolio key>` uses the
current account binding, exact native position ID and the successfully applied
snapshot's receipt. A subsequently captured older archive cannot replace it.
Unavailable references remain unavailable rather than being matched by ticker.
Broker-reported basis, P/L and percentages are separate from the report's calculated
P/L. Nonpositive cost bases have no calculated percentage under the existing
calculation convention; the report displays “Unavailable” while preserving any
broker-reported percentage, including zero, in source details.

The overview retains visible history/fee qualifications, labels itemized portfolio
value separately from aggregate broker fund balances, and distinguishes signed
position cost basis from verified opening/roll cash flow. Gross put funding is
separate from short-call share delivery by account and underlying; cash-settled
calls do not contribute share delivery. The report does not add an all-asset profit
calculation or fetch additional broker endpoints. This read model changes no saved
broker evidence, holdings, books or existing snapshot schema. Projection version 6
rebuilds the saved chart model to include signed position basis buckets.

Broker Activity is an optional per-user display setting in Settings → Your
experience. `experience_settings.show_broker_activity` defaults to false when
absent; the dashboard receives it as `dashboardConfig.showBrokerActivity` on each
response, including cached reports. Disabling hides the activity section and
loads only source-status metadata (`?activity=0`), without retrieving activity
rows. Sync, evidence capture, freshness status and position source details remain
available. The preference is presentation only, not a new source-data access rule.
