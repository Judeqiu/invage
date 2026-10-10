# Section 03: option positions and roll relationships

Date: 2026-10-11. Status: revised to a foldable hierarchy following user feedback; clickable prototype only. Live detection and dashboard integration are not implemented.

Prototype: [Section 03 option relationships](./section-03-option-relationships.html).
Evidence: [Victor's broker linkage review](../audits/2026-10-11-victor-option-roll-linkage.md).

## Purpose and placement

Consolidate the existing `optionsWorkspace` and Section 03 open-options block into one section titled **Option positions & rolls**. Retain three views: **Open**, **History**, and **Rolls**. Open remains the default in production. The prototype starts in Rolls to demonstrate the new view.

Open retains the current book, expiry grouping, prices, obligations, and freshness labels. History retains contract episodes and outcomes. Rolls answers: which contract was closed, what replaced it, when, for how many contracts, and how strong is the evidence? A roll relationship connects executions; it does not replace either a current position or an episode outcome.

## Layout and interactions

Use a **foldable hierarchy** with the existing report typography and purple accent. Each top-level folder represents one relationship group within an underlying, broker, and account. Its collapsed row shows the latest replacement contract, expiry, quantity, last roll date, and number of rolls. Multiple unrelated chains in one underlying/account remain separate folders. Latest replacement is explicitly distinguished from a confirmed current position.

Expanding a folder reveals an indented roll history, newest first. Each roll is another foldable row: **date · old contract → replacement contract · evidence label**. Expanding that row reveals closing/opening quantities, cash basis when available, and evidence interpretation. A third nested disclosure contains source identifiers. All detail stays inside its parent folder; there is no detached detail panel or separate chain toggle.

Use native `details`/`summary` disclosures, directional chevrons, and branch lines to express hierarchy. The AMD folder opens initially in the preview to illustrate its four transitions; roll details start collapsed. Other folders start collapsed. Provide **Expand groups** and **Collapse all**; expanding groups does not automatically expose every source record. Remember disclosure state across filter changes. On mobile, wrap summary fields and stack close/open legs vertically without horizontal scrolling.

The Rolls toolbar contains broker/account, underlying, evidence, and date-range filters. Global broker selection carries into all three views. Default order is newest roll first. Unknown account identity never falls into another account's group. Use an explicit account selector or account label when one broker has multiple accounts.

Expanding a roll shows:

- Contract transition and quantity on each leg.
- Trade date and time with the broker clock or timezone.
- Cash flow labeled **net cash**, **before fees**, or **unavailable**, with currency.
- Evidence explanation, source references, parent order IDs, and fill quantities in expandable detail.
- The roll's place in its account-scoped history through indentation and ordering. No additional selection step is required to see the chain.

A chain is a path of linked transitions, not automatically a continuous position lifecycle. The AMD prototype uses four observed transitions of 15 contracts and labels continuous ownership as unverified. No node is marked currently open without a fresh position observation. Branches, partial quantities, and merges must be shown explicitly as subgroups with allocated quantities; do not imply a single uninterrupted lifecycle if quantity reconciliation is unresolved.

Clicking a linked contract in Open or History should open Rolls with that account and contract filtered, and expand the relevant folder and roll. A linked closing episode keeps its own outcome, such as **Closed by fills**, and adds **Rolled into …** as a separate relationship. A contract history action inside a roll opens its existing history detail.

## Evidence labels

| Label | Meaning | Treatment |
| --- | --- | --- |
| Order-linked | Both legs share an authoritative parent order and position effects reconcile | Solid connector; expand to view broker evidence |
| Execution-linked | Fill IDs, times, quantities, contract identity, and effects support pairing without an explicit shared parent | Solid connector with an explicit inference label |
| Possible | Timing and contract similarity support a candidate, but linkage or intent is unproven | Dashed connector; never merge automatically into a verified chain |
| Needs review | Shared order exists but position effects, quantity, or competing links conflict | Separate review state; suppress whole-relationship cash/P&L conclusions |

Shared order proves common execution intent, not necessarily a roll. Tiger combinations require an independent position-effect check. IBKR execution-prefix matching remains a dataset-supported inference. Webull's `NONE_CLIENT_ORDER_ID` must never establish a relationship.

Do not use color alone. Always show the evidence text. Source identifiers belong in expandable evidence, rather than the main investor-facing list.

## Financial and historical behavior

Keep cash flow and profit distinct. Sum exact signed proceeds, fees, and taxes only when available and reconciled. MooMoo example cash is before fees; IBKR example cash uses reported `netCash`. Never mix net and gross figures in one unlabeled total, sum currencies without explicit FX, or count all chain credits as strategy profit. Opening premium may finance a close without making the closed position profitable.

Current position status comes from the latest complete broker observation, with an as-of date. Replacement execution evidence alone does not prove it remains open. Saved valuation snapshots do not advance position freshness or create rolls. In historical replay, exclude future trades from relationships visible at that date and label the trade-history coverage separately from snapshot capture time.

Keep Section 03 available when there are no current options but history or relationships exist. Empty results say **No linked rolls in these records**, not **No rolls traded**. Missing fills, metadata, accounts, or source files produce coverage messages. Loading, error/retry, and empty states are distinct. Pagination must retain selection and apply filters server-side before counts or totals.

## Data contract and integration

Introduce an account-scoped relationship read model alongside the existing option-history API. The backend, not the browser, determines links. A relationship needs:

- Stable relationship ID, broker, immutable connection/channel, and account identity.
- Old/new canonical contract terms, source contract IDs, action/effect, exact decimal quantities, and execution references.
- First/last fill timestamps, timezone provenance, and source clock precision.
- Evidence class, method/version, reasons, reconciliation state, and coverage gaps.
- Source archive ID/version or content hash, record IDs, and parent order/execution linkage fields.
- Cash components, original currency, fee/tax availability, and basis (`net`, `gross`, or `unknown`).

Add an authenticated relationship endpoint, for example `/api/domain/invage/option-relationships`, with broker/account, contract, dates, and evidence filters plus stable pagination. Return per-relationship details and separately computed chain paths; do not return hypothetical relationship data through the current positions endpoint. Tenant binding must come from authentication.

Preserve raw broker order/deal/execution identifiers during import and backfill metadata for closed contracts independently of current lots. Deduplicate overlapping imports, reject conflicting records, and prevent the same fill quantity from being consumed twice. Partial and resized rolls require allocated quantities, not reuse of entire executions in multiple edges.

## Delivery sequence

1. Preserve linkage fields and source provenance; build read-only backfill and reconciled relationships from retained raw archives.
2. Add the authenticated relationship API and validate roll versus new-spread classification, account isolation, partial fills, unknown fees, and competing candidates.
3. Integrate the Rolls view and contract links into the existing Open/History workspace without losing current table fields or filters.
4. Add quantity-aware chain paths and historical replay only after individual links and intervening activity reconcile.

## Prototype scope and acceptance

The revised prototype focuses on the Rolls view and uses a small, explicitly labeled selection of Victor's reviewed records. It does not query production or embed invented live positions. Broker/underlying/evidence filters, nested group/roll/source disclosures, and expand/collapse controls work locally. The AMD folder contains all four reviewed transitions. Open and History integration remains specified above and is not embedded in this revision.

Production acceptance includes: explicit shared-order rolls; IBKR inferred links; Tiger newly opened spreads and existing long sell legs; resized Webull candidates; partial fills and branch/merge chains; unknown commission; account separation; conflicting source copies; no current positions; loading/error/empty states; keyboard and mobile access; stale position observations; and suppression of future links in dated replay.
