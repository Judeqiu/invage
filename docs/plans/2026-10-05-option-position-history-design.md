# Option Position History and Broker Sync Freshness

**Date:** 2026-10-05

**Status:** Observation history and dashboard view implemented; confirmed realized P&L and expiry or assignment events remain future work

**Scope:** Historical option positions on the dashboard across IBKR, Tiger, MooMoo, and Webull. This document also defines how valuation snapshots relate to broker syncs and how the UI handles missing syncs.

## Decision

Add **Open** and **History** views to the dashboard's options section. Store a durable, normalized observation of each broker account's option positions after every successful sync. Use those observations to show when a contract was present or absent. Keep `save_snapshot` as a valuation checkpoint and the execution journal as the source for imported fills. Neither is a substitute for a broker position observation.

The first release should show the historical contract, its broker account, the last date it was observed open, the first later date it was observed absent, and the evidence available. It must not turn disappearance or passage of the expiry date into a confirmed trade, expiry, assignment, or realized P&L.

## Current behavior and evidence

| Record | Trigger | Content and limitation |
|---|---|---|
| Current broker books | Successful manual or scheduled sync | `applyBrokerStatement` replaces positions and cash for the selected channel. A removed option no longer appears in the current dashboard. |
| Broker sync run and raw archive | Sync attempt | Run metadata records success or error; successful raw XML/JSON is archived. The run record does not contain the full prior position inventory. |
| Dashboard valuation snapshot | Explicit `save_snapshot` tool call | Captures the books' positions plus market valuation at that call. Sync does not invoke this tool. One `snapshot-YYYY-MM-DD.json` file is written per UTC day; another save that day overwrites it. |
| Option execution journal | IBKR Flex Trades at Executions level or historical Flex XML import | Retains individual option fills independently of current positions. Tiger, MooMoo, and Webull currently do not import fills. It does not include a general expiry or assignment event model. |

The dashboard assembles its live view from the *current* books and newly resolved market marks. Its archive dates come only from saved valuation snapshots. A saved snapshot can therefore value positions from an older broker pull; its date is not proof that those positions were still open that day. When there are no current holdings or deposits, the dashboard currently returns an empty model before it loads prior snapshots.

Do not make daily `save_snapshot` a prerequisite for option history. Automatically saving a valuation after sync could be useful for portfolio performance, but it would still be a separate operation with its own failure and quote times. Automatically saving on a day **without** sync would repeat the last imported positions; label their broker as-of dates rather than presenting that file as a fresh broker observation.

Relevant implementation: `src/brokers/apply-statement.ts`, `src/brokers/accounts.ts`, `src/brokers/sync-history.ts`, `src/tools/snapshot.ts`, `src/webapp/dashboard-data.ts`, `src/report/dashboard-model.ts`, and `src/brokers/option-executions.ts`.

## Broker capabilities in this implementation

| Broker | Position source and `as_of` | Fill coverage | History consequence |
|---|---|---|---|
| IBKR | Activity Flex `OpenPositions`; statement `toDate`. Activity data is prior-day. | `Trades` at `EXECUTION` level when included in the Activity query, or a history-only XML import. | Observations and imported fills can be displayed together. A missing or incomplete Trades section cannot establish a close or realized P&L. |
| Tiger | OpenAPI stock, option, and fund positions; UTC fetch date. | None imported. | Record presence and absence, with exit outcome unknown. |
| MooMoo | Cloud Open API stock and listed option positions; UTC fetch date. | None imported. | Record presence and absence, with exit outcome unknown. |
| Webull | OpenAPI equity and supported single-leg option positions; UTC fetch date. Combo and multi-leg rows may be skipped. | None imported. | Record presence and absence for imported contracts; skipped rows must not be interpreted as closures. |

All four map imported option lots to the shared `Holding.option` shape. Multiple accounts of one broker can have separate channels. History identity must include the immutable connection/channel and bound account, as well as the option contract; ticker alone is insufficient. `src/brokers/catalog.ts` and the four `*-map.ts` files define the connector behavior above.

## Sync and snapshot timeline

```text
Oct 1  successful sync: option present     → confirmed open as of Oct 1
Oct 2  no sync; save_snapshot runs         → Oct 2 valuation of Oct 1 books
Oct 3  scheduled sync fails               → current books remain unchanged
Oct 4  successful sync: option absent      → absent as of Oct 4

Supported conclusion: last observed open Oct 1, first observed absent Oct 4.
Unsupported conclusion: closed, expired, or assigned on Oct 2 or Oct 3.
```

The scheduler scans due connections every minute. Frequencies are hourly, daily, or weekly; daily means the next due time is 24 hours after the claimed run. It advances `next_run_at` before contacting the broker. An outage or failed run does not produce synthetic observations for missed days, and the scheduler does not replay each missed interval. Manual syncs can provide additional observations. A failed sync must never remove positions or advance their confirmed `as_of` date.

After a sync gap, the live dashboard may show a newer quote applied to an older position and cash balance. Keep these times separate: **quote time**, **position as-of**, **last successful sync**, and **last attempt/error**. The existing `last_sync` field becomes an error on failure, so the last successful date must be retained separately or recovered from successful sync history. Do not fall back to page generation time as a purported position date.

An option whose stored expiry has passed while its broker position is stale remains **status unverified**. Show the last confirmed position and a stale warning. Do not show it as a confirmed current assignment risk, and do not move it to History until a later successful observation or broker event supports that move.

## Historical data model

Persist one normalized observation for every successfully applied broker account sync, including an empty option list. Empty is meaningful: it establishes that previously observed options are absent. Store the observation with the committed sync identity and raw archive reference, rather than reconstructing it solely from valuation snapshots.

```ts
type OptionPositionObservation = {
  sync_id: string;                 // stable id for an applied broker sync
  broker_id: 'ibkr' | 'tiger' | 'moomoo' | 'webull';
  connection_id: string;
  channel: string;
  account_id: string;
  fetched_at: string;              // actual pull time, ISO timestamp
  statement_as_of: string;         // broker statement date or UTC fetch date
  raw_data_id: string;             // existing archived response reference
  coverage: 'complete' | 'partial';
  skipped_option_count: number;
  options: Array<{
    contract_key: string;          // canonical underlying/right/strike/expiry/multiplier/settlement
    broker_contract_id?: string;
    side: 'long' | 'short';
    units: string;                 // positive contract count
    currency: string;
    avg_price_per_contract: string;
    broker_mark_per_contract?: string;
  }>;
};
```

Store numeric quantities and money without converting exact broker decimals into imprecise display floats in the history record. Retain the full canonical contract fields or a versioned key from which they can be recovered. The example type describes the data contract, not a requirement to put an unbounded array inside the investor state document. A dedicated indexed store is preferable for long history. Keep observations tenant scoped and make repeated processing of the same `sync_id` idempotent.

The current `Holding` mapper uses JavaScript numbers for some prices and quantities. If exact decimals are required in observations, capture validated broker text before that conversion. Otherwise record the mapped numeric precision honestly; only the existing IBKR execution journal currently guarantees exact decimal text for premium and commission.

An observation is valid history only after its corresponding current-books update commits. The implementation must make the two writes atomic, or add a committed sync marker and a repair process that can rebuild a missing observation from the archived raw response. A crash must not leave a successful books update whose only prior position inventory is inaccessible. The existing raw archive is the migration and repair source for older successful runs; corrupt or missing raw data remains a visible coverage gap.

Do not infer absence from an observation with incomplete option coverage. Preserve skipped rows and reasons from the broker mapper. A zero-option account is a complete absence observation only when the connector supplied a valid positions response and no potentially relevant option rows were skipped.

### Contract episodes

The same contract can be opened, fully exited, and reopened before expiry. Present consecutive observations of the same `(channel, account, contract, side)` as one **episode** until a complete later observation shows it absent. A later reappearance starts a new episode. Keep observed quantity changes inside the episode; they do not by themselves prove a trade or cost basis. IBKR executions can refine the episode timeline when complete, but the UI must distinguish fill time from observation time.

The interval for a disappeared position is `(last_seen_open_as_of, first_seen_absent_as_of]`, subject to statement and fetch dates. If the two dates are the same, show the ordered sync times as well. An IBKR statement's `toDate` and an API fetch date have different precision; the UI should not imply that either is an exact transaction time.

## Status and financial rules

| Evidence | Displayed status | Financial fields |
|---|---|---|
| Latest complete observation contains the contract | Open, confirmed as of date | Current book cost and mark; unrealized P&L with source and as-of labels. |
| Latest observation is old, sync is paused/late, or a later attempt failed | Status unverified, last confirmed open as of date | Last confirmed quantity; any newer quote explicitly labeled. Suppress current exposure conclusions after expiry. |
| Later complete observation omits the contract | No longer observed, between two dates | Last observed mark and cost only. Realized P&L unavailable. |
| Complete matched IBKR opening/closing executions reconcile to zero and account/contract identity matches | Closed by fills | Gross proceeds, exact signed fees, and realized P&L only after a documented matching method handles partial fills and currency. |
| Authoritative expiry or assignment event is imported and reconciled | Expired or assigned | Event-specific proceeds and position/cash/share effects; no inferred zero-value close. This is a later capability, not available from current connector records. |

Do not call daily or cumulative net premium **realized P&L**. The current execution journal groups short-option sell-to-open and buy-to-close cash flow; it does not match complete position lifecycles. A snapshot's `totalPL` is valuation versus recorded cost for the then-current book, not lifetime option profit. Also do not use the books ledger's broker-sync close/open postings as trade evidence: `applyBrokerStatement` closes and reopens imported holdings during reconciliation even when a position persists.

## Dashboard behavior

Place **Open | History** above the existing open options table. Keep the broker and right filters; add account, date range, status, and contract search to History. Default History to newest observed absence or confirmed exit. Do not force the user through the dashboard's portfolio date picker to locate an old contract.

History table: **Contract · Broker/account · Last seen open · First seen absent or event time · Status · Net premium or P&L when supported · Evidence**. Selecting a row opens a detail panel with the observation timeline, position quantities/marks, linked IBKR fills, saved valuation checkpoints, source timestamps, and any coverage gaps. An empty current portfolio must still render History and the date picker for existing valuation snapshots.

Show per-broker freshness in the Open view: “Positions confirmed as of Oct 1; last attempt failed Oct 3.” Dashboard refresh time and live quote time belong in separate labels. A saved valuation snapshot should show both its capture date and the broker position as-of date used for each channel. Existing snapshot files lack that provenance, so older snapshots should say **broker as-of unavailable**, rather than using their capture date as confirmation.

For scheduled connections, show **late** when the last successful run is older than its configured interval plus a short scheduler grace period; show the attempted error independently. For a connection with no schedule, show **manual sync** and the last confirmed date instead of inventing a daily freshness promise. An IBKR Flex statement can legitimately describe the prior day even when today's pull succeeded, so display both pull time and statement date.

The date picker should offer only dates with saved valuation snapshots. Missing dates are gaps, not flat daily observations. History remains available without any `save_snapshot` calls. A `save_snapshot` taken after a missed sync is still useful for valuation but does not confirm an option's current position status.

## Delivery sequence and verification

1. Add durable, per-success option observations with provenance and account isolation. Backfill from trustworthy successful raw archives where possible; mark other earlier periods as unknown.
2. Expose a paginated, authenticated option-history API that returns episodes, evidence, freshness, and coverage without requiring an open portfolio. Keep execution rows on their existing endpoint or link them by validated identity.
3. Add Open/History UI, stale and gap labels, and an empty-portfolio history view. Keep valuation snapshots distinct from broker observations in copy and API fields.
4. Add realized P&L and explicit expiry/assignment labels only as validated matching and event imports become available for each broker.

Acceptance cases: consecutive successful observations with disappearance; same contract reopened; quantity reduction without disappearance; no sync for several days; failed sync followed by success; option past expiry with stale books; saved snapshot on a day without sync; same-day snapshot overwrite; empty current portfolio with prior history; incomplete/skipped option rows; two accounts holding the same contract; IBKR fills absent, partial, or imported later; and raw archive repair after an interrupted history write.

## Design review

**What this resolves:** Historical visibility no longer depends on periodic valuation snapshots or the current open book. Every successful broker observation can establish presence or absence, including an empty option list. The UI keeps missing days and missing broker events explicit.

**Limits retained:** The four connectors do not currently supply a common option lifecycle feed. IBKR can supply fills only when configured for execution-level Trades; the other three supply no fills today. No connector in this implementation supplies a general confirmed expiry/assignment event. Historical backfill is limited by retained raw responses and imported fills. The first release therefore cannot promise an exact exit date or realized P&L for every option.

**Implementation risks to address:** Preserve the last successful position date through failed syncs; prevent skipped rows from creating false exits; make observation persistence recoverable across a crash; avoid conflating repeated syncs with economic trades; and keep old snapshots usable when the current portfolio is empty. These are acceptance conditions for implementation, not optional UI polish.

## Implemented scope

Successful syncs now append option observations in the same revision checked investor-state save as the current broker books. The history API also reads older successful sync runs and reconstructs observations from their archived raw responses where possible; failures appear as coverage gaps. The dashboard has Open and History views, contract filters and detail, per-broker position dates, and access to history when current books are empty. New valuation snapshots carry broker as-of dates. The current release labels removed contracts **No longer observed** and leaves realized P&L unknown. Matching IBKR fills are shown as evidence, without claiming a complete lifecycle calculation.

The first implementation keeps observations in investor state for atomicity. As history grows, move the same data contract to an indexed tenant scoped store with transactional or repairable sync linkage; avoid unbounded aggregate growth. Archived backfill is read only and may be slower for accounts with many past raw files. Older runs without a usable archive remain explicit gaps.
