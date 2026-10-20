# Trades v2

The independent **Trades page version** management setting selects classic V1 or V2. The default remains V1. Dashboard and Positions switches are independent. The mockup reference is https://velovest-ai.lovable.app/trades.

## Page and column mapping

Open book has the mockup’s eleven columns, in order:

| Column | Recorded basis |
| --- | --- |
| Entry date | Earliest reconciled opening fill for remaining contracts; multiple opening dates are identified. No inference from expiry or first snapshot. |
| ID | Readable contract/date/broker label, plus a shortened system ID. Full option UUID is available in details. The readable label is not a primary key. |
| Ticker | Canonical underlying. |
| Strategy | Short/long put/call. Cash securing and covered-call status are not asserted without collateral evidence. |
| Strike | Native-currency strike per underlying unit. |
| Expiry | Recorded contract expiry. |
| Contracts | Current holding quantity. |
| Premium | Opening gross cash allocated to the remaining contracts by the existing FIFO reconciliation. A long purchase is a debit. Missing fills remain unavailable. |
| Returns % | Short-option opening premium / (strike × remaining contracts × multiplier). Not annualized or a collateral return. |
| Net cash | User-entered opening cash plus dated gross opening premiums in the selected broker/strategy/ticker/right/currency scope. Single currency only, before fees. Year/month filters and collapsed groups retain earlier cash carry. Same-day order is by stable ID, not claimed execution order. Missing premium or multiple opening dates invalidate subsequent balances. Undated entries are excluded. |
| Broker | Actual channel with the latest recorded presence date where available. |

The open list matches the mockup's hierarchy: descending year headers with entry counts, then descending expandable month headers (for example `OCT-2026`). Months start expanded. Each month header shows contracts, gross premium, blended returns and its final running net cash aligned with the original eleven columns, above its entries. Multiple currencies receive separate summary rows; totals are never added across currencies. Unknown opening dates remain in a separate final group without an invented year/month.

Collapsing a month hides only its detail rows, leaves its totals visible, preserves keyboard focus, and makes no API request. Counts and totals use all entries matching the filters, including collapsed rows. Collapse state survives filter changes, tab switches and refresh within the page. Calendar filters change the visible groups while running net cash retains earlier dated entries within the other selected filters, matching the mockup's carry behavior. Month-end cash uses the latest dated row with the same stable-ID tie order as the cash calculation. Missing evidence remains unknown.

Broker/strategy/ticker/right/year/month filters, source execution details, private thesis notes and the historical Flex XML import remain available. Tables scroll within the page on mobile; column headers and the first column remain visible.

History has nine columns: **Contract, Status, Opened, Last trade, Contracts, Premium in, Paid to close, Realised P&L, Broker**. It reconstructs flat-to-flat execution cycles and explicit lifecycle events, includes unresolved and snapshot-only history, and omits currently open cycles from the history tab. First observed is not an opening date. A disappearance is not expiration or assignment. Reopened cycles have different execution identities while retaining the same option-book identity. History cycles are derived views, not permanent transaction primary keys.

Rolls require existing verified order/execution relationships; timing-only candidates are not promoted. P&L requires complete quantities and supporting settlement data. Unknown commissions produce explicitly labelled before-fee figures. Physical delivery does not create inferred option profit. Conflicting archive evidence withholds cash/profit figures. After-fee, before-fee and broker-reported subtotals are kept separate. Explicit broker lifecycle P&L is retained when it covers the terminal events without overlapping execution closes; no fee basis is inferred.

## Small additive identity model

Existing financial tables and strict `OptionExecution` evidence stay unchanged. Two metadata fields live in the existing encrypted, revisioned investor state:

```text
option_identities.version = 1
option_identities.options[canonical account/contract key] = option UUID
option_identities.executions[channel/account/native execution key] = {
  id: execution UUID,
  option_id: option UUID
}
option_journal[option UUID] = { thesis, updated_at }
```

The option-book key contains channel, bound broker account, canonical underlying, right, normalized exact decimal strike, expiry, multiplier and currency. It identifies that contract in that account, across fills and reopenings. It is not a global security master or an assertion that two brokers’ deliverables are identical. Long/short sides use the same contract ID; individual executions have separate IDs. Broker contract and execution IDs are retained as evidence.

Application-owned UUIDv8 values use a versioned SHA-256 namespace plus the immutable investor UUID and canonical source key. This makes retries, overlapping imports, fee enrichment, alias changes, earlier-history imports and the read-only legacy projection agree. Decimal formatting changes do not change IDs. The persistent index is append-only through normal saves: closing a holding does not remove its identity. Duplicate IDs and inconsistent execution foreign keys fail validation.

Missing account/currency values remain an explicit unknown scope. Later verified account/currency or corrected economic terms identify a different scope; old metadata remains retained rather than silently merging identities. The existing model does not describe adjusted deliverables or distinguish every possible exchange listing; introducing a full security master is outside this change.

New broker imports and manual holding mutations materialize IDs through `saveInvestor`. V2 GETs project the identical IDs for legacy data without writes. Thesis notes use the stable option-book ID and explicitly span its fills/reopenings. Saving notes requires the displayed account revision; a conflict retains the draft. Metadata-only writes cannot change source evidence or seed/reconcile financial books.

## Existing-data backfill

No SQL/framework schema migration or downtime is needed. Run from the committed application release with the service’s database/encryption environment. Supply each intended user UUID or alias explicitly:

```bash
# Read-only plan, including reconstructable retained broker archives
node --import tsx scripts/migration/option-identities.mjs USER_UUID

# Apply only identity metadata using optimistic revision checks
node --import tsx scripts/migration/option-identities.mjs USER_UUID --apply

# Repeat the plan: changed should be false
node --import tsx scripts/migration/option-identities.mjs USER_UUID
```

Multiple user arguments are supported and duplicate aliases for the same owner are skipped. The plan reports option/execution counts, archive gap count, revision and a hash of unchanged non-identity evidence. Archive gaps require review; the migration does not invent or rewrite missing executions. Re-run after subsequent history repairs. Revision conflicts abort that user’s update and must be retried from a fresh snapshot. There is no automatic production migration in this coding change.

The dedicated metadata repository validates that every other state field is unchanged, then uses the existing optimistic encrypted state save. It creates no financial journals, including for accounts whose books have not yet been seeded. Reads before/after the migration use the same system IDs.

V1 remains available through the management switch. Keep the additive IDs and notes when switching back; removing them is unnecessary.

## Loading and verification

The open book reads recorded state without market quote calls. History/archive checks load lazily. Private derived caches are partitioned by authorized owner and account revision, expire within one minute, and invalidate when application code changes. Refresh bypasses them. The browser retains its last successful view after a failed update, with an error and retry action; it does not persist account data in local storage.

Tests cover ID backfill/idempotence, exact evidence preservation, broker/account/user isolation, partial closes and reopenings, explicit lifecycle events, incomplete evidence, conservative roll classification, independent V1/V2 configuration, private API caches, notes and conflicts, browser keyboard details, escaped text, all columns, native-currency cash, mobile layouts and error recovery. PostgreSQL integration checks encrypted state persistence, concurrent revision rejection, untouched financial journals and automatic IDs on future imports.

Nine older cases fail on both this change and an isolated archive of base commit `06c2c3b`: three in `books-tools-parity.test.ts`, three in `execution-import.test.ts`, one in `execution-persistence.test.ts`, and two in `option-history-backfill.test.ts`. They use obsolete alias/authentication/owner fixtures (missing registered aliases or user UUIDs). The Trades v2 PostgreSQL, authenticated API, and valid-UUID archive tests pass; the older fixtures are outside this change.
