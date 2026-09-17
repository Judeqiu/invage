---
layout: default
title: IBKR Flex raw data processing
---

**[Home](/invage/)** | **[Data Model](/invage/data-model.html)** | **[Playbook](/invage/playbook.html)** | **[IBKR Flex processing](/invage/ibkr-flex-raw-processing.html)**

# IBKR Flex raw data processing

How Invage turns an Activity Flex XML file into channel `ibkr` lots, cash, and (when the query allows it) option execution history.

This note is grounded in a production archive named `activity-2026-09-14-2026-09-15T22-36-46-458Z.xml` (Velovest Activity Flex, generated 2026-09-15 18:36 IBKR clock). SSH to `lextokprod02` / `lextok03` was not available from the machine that wrote this, so the file is the local copy of that BinDrive archive, not a fresh `GetStatement` pull. Account ids, quantities, and cash amounts are omitted below.

## What the raw file is

A successful IBKR Sync writes the **entire** Flex response, unchanged, to:

```
data/drive/<slug>/ibkr-flex/activity-{asOf}-{stamp}.xml
```

`asOf` is the statement `toDate`. `list_raw_data` labels that path `channel=ibkr`, `source_kind=broker-sync`.

This archive is:

| Fact | Value in the sample |
|---|---|
| Envelope | `FlexQueryResponse type="AF"` (Activity Flex) |
| Period | **`LastBusinessDay`** — `fromDate` = `toDate` = 2026-09-14 |
| Sections present | `EquitySummaryInBase`, `CashReport`, `OpenPositions`, `Trades` |
| Open positions | 147 rows: 8 `STK`, 139 `OPT` (all short). Quantity is XML `position`, not `quantity` |
| Cash | One `CashReportCurrency` with `currency="BASE_SUMMARY"` (no USD/HKD/… sleeve) |
| Trades | 5 `OPT` `SELL` rows on 2026-09-14 only |
| Not present | `conid`, `listingExchange`, `levelOfDetail`, `tradeID`, `openCloseIndicator`, `ibCommissionCurrency`, deposits, dividends, NAV history series |

That period is why Sync cannot “pull two months ago” until the **Flex query** in Client Portal is widened. Invage never sends `fd` / `td` / `p` on `SendRequest`; it only sends token, query id, `v=3`.

## Pipeline

```
Client Portal Flex query (period + sections)
        │
        ▼
SendRequest → poll GetStatement          src/ibkr/flex-client.ts
        │
        ▼
parseFlexQueryXml                        src/ibkr/flex-parse.ts
        │  (optional csv_tables overlay — IBKR only)
        ▼
mapFlexDocToStatement                    src/ibkr/flex-map.ts
        │
        ├─ success → archive XML under ibkr-flex/
        │            applyBrokerStatement
        │              lots/cash snapshot on channel ibkr
        │              merge option_executions if Trades parsed
        │
        └─ parse fail → drive/<slug>/broker-raw/ibkr/<id>/
                         raw.xml + case.yaml  (triage, no books write)
```

Entry points: Settings / Brokers **Sync**, tool `sync_broker` / `sync_ibkr_flex`. All of them call `syncBrokerConnection` (`src/brokers/connections.ts`).

A second path, **Trades → Import XML**, is `POST /trades/import` → `importOptionExecutions`. It parses **Trades only**, merges executions, and **does not** replace lots or cash and **does not** write `ibkr-flex/`.

## Step 1 — Fetch

`ibkrFlexAdapter.fetchRaw` calls `fetchFlexStatement({ token, queryId: activity_query_id })`.

- Host: `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService`
- User-Agent required; ≥1.1s between HTTP calls
- Polls `GetStatement` until a `FlexQueryResponse` (or CSV, which we then reject)

No date override. The window is the query template’s period. This sample’s `period="LastBusinessDay"` is that template.

## Step 2 — Parse XML → `FlexStatementDoc`

`parseFlexQueryXml` is strict about wrappers and lenient about individual lots.

**Must exist or the whole parse fails (no wipe of existing books):**

- Exactly one `FlexStatement`
- `OpenPositions` wrapper (zero rows is allowed)
- `CashReport` wrapper with at least one importable cash sleeve

**Open positions.** Each `OpenPosition` becomes a `FlexOpenPosition`. IBKR often emits `position="1700"`; the parser accepts `quantity` or `position` and fatals if both exist and disagree. `CASH` rows are ignored. A bad row is skipped (`skipped[]`), not a fatal, unless `quantity` and `position` conflict.

**Cash.** Per-ISO `CashReportCurrency` rows become sleeves. `BASE_SUMMARY` is **not** an ISO code. This sample is BASE_SUMMARY-only, so the parser looks up `EquitySummaryByReportDateInBase` whose `reportDate` equals statement `toDate`, takes that row’s ISO `currency` and `cash`, and **requires** it to equal BASE_SUMMARY `endingCash`. Here that resolves to **USD** on 2026-09-14. Extra EquitySummary dates (this file also has 2026-09-11) are ignored. They are **not** stored as performance history.

**Trades.** After cash/lots, parse always runs `parseFlexOptionExecutions` on the same XML.

- No `<Trades>` wrapper → executions field omitted (`undefined`). Sync then **leaves** existing `option_executions` alone.
- Empty `<Trades></Trades>` → empty list (history present, zero fills).
- Each `Trade` with `assetCategory="OPT"` must be `levelOfDetail="EXECUTION"` and include: `accountId`, `tradeID`, `conid`, `dateTime` (`YYYYMMDD;HHMMSS`), `buySell`, `openCloseIndicator`, `quantity`, `multiplier`, `underlyingSymbol`, `putCall`, `strike`, `expiry` (`YYYYMMDD`), `currency`, `proceeds`, `ibCommission`, `ibCommissionCurrency`.
- `ORDER` / `CLOSED_LOT` / summary rows are skipped. Stock trades are skipped. Missing required fields **fail the entire Flex parse**.

Current code on **this production file** fails:

```
IBKR option execution undefined: missing levelOfDetail
```

The five option sells have `dateTime`, `buySell`, `quantity`, `proceeds`, `ibCommission`, strike/expiry/putCall — but not `tradeID`, `conid`, `levelOfDetail`, `openCloseIndicator`, or `ibCommissionCurrency`. That is a Flex **field** setting, not a period setting.

The archive still exists because it was written on 2026-09-15, before execution parsing was wired into `parseFlexQueryXml` (journal deploy 2026-09-17). A Sync of the same query **today** would miss `ibkr-flex/` success archive and land in `broker-raw/ibkr/` triage instead, unless Trades is removed or upgraded to Executions with those fields.

Stripping `<Trades>` from this file (what the old parser effectively did) maps cleanly: 147 lots (8 equity, 139 short options), USD cash from BASE_SUMMARY, nothing skipped.

## How this lands in the data model

The XML is not the books. After a successful apply, investor state holds only public types. Full field rules: [Data Model](./data-model.md).

| In this Flex file | Stored type | This sample |
|---|---|---|
| `OpenPosition` `STK` `position` | `portfolio["AMD@ibkr"]` (equity `Holding`) | 8 equity lots, `channel: ibkr` |
| `OpenPosition` `OPT` (short) | `portfolio["AMD-P-…-S@ibkr"]` (option `Holding`) | 139 short option lots; `units` = abs(position) |
| `CashReport` `BASE_SUMMARY` + EquitySummary on `toDate` | `cash[]` sleeve `{ currency: USD, amount, channel: ibkr }` | One USD sleeve; not a holding |
| `Trade` OPT rows | `option_executions[]` | **Not stored** — missing execution fields, parse fails today |
| `EquitySummaryByReportDateInBase` extra dates | nothing | 2026-09-11 row dropped |
| Whole XML | `drive/<slug>/ibkr-flex/activity-{asOf}-{stamp}.xml` | Raw archive only |

Worked snapshot (illustrative keys, not live amounts):

```yaml
portfolio:
  AMD@ibkr:
    instrument: equity
    units: …                   # Flex position
    avg_price: …               # costBasisMoney / position
    channel: ibkr
  AMD-P-150-20261017-S@ibkr:
    instrument: option
    units: 2
    avg_price: …               # contract premium, not per share
    channel: ibkr
    option:
      right: put
      side: short
      strike: 150
      expiry: "2026-10-17"
      multiplier: 100
      underlying: AMD
      settlement: physical
      mark: …                  # markPrice × multiplier
cash:
  - amount: …                  # BASE_SUMMARY endingCash, booked as USD
    currency: USD
    channel: ibkr
    updated_at: "2026-09-14"
option_executions: []          # would list AMD SELLs if Trades were Executions-level
```

Replace vs merge on this file: the 147 lots **are** the entire `ibkr` sleeve after apply (old `ibkr` lots vanish). Journal rows from earlier days would **remain** if Trades had parsed. `period: LastBusinessDay` means the raw file never contained August fills to merge.

## Step 3 — Map → public `BrokerStatement`

Vendor labels do not persist. `mapFlexDocToStatement` builds:

| Flex | Statement |
|---|---|
| `accountId` | `account_id` |
| `toDate` | `as_of` (IBKR books date; prior day) |
| `fromDate` | `from_date` |
| Cash sleeves | `cash[].currency` + `amount` (ending cash) |
| Open positions | `lots[]` with public `Holding` |
| Parsed OPT executions | `option_executions` (omitted if Trades wrapper missing) |

Lot mapping (`holdingsFromOpenPositions`):

| `assetCategory` | Result |
|---|---|
| `STK` / `ETF` | Equity holding. Short stock is skipped. Yahoo ticker from `symbol` (+ HK pad if `listingExchange` is SEHK). `avg_price` from `costBasisMoney / quantity` (else `costBasisPrice`). |
| `OPT` | Option holding. Needs multiplier, put/call, strike, expiry, `underlyingSymbol`, `markPrice`. `units` is `abs(quantity)`; sign becomes `option.side` long/short. `avg_price` is cost of the contract (costBasisMoney / units, or costBasisPrice × multiplier). Mark is `markPrice × multiplier`. |
| `FUND` / `BILL` / `BOND` | Fund holding with manual mark. |
| Anything else | `not_imported` |

`conid` → `holding.broker_ref.native_id` when present. This sample has **no** `conid` on positions.

Duplicate map keys skip the later row. Dashboard marks stay Yahoo; Flex `markPrice` is stored on the option lot for the snapshot, not used as the dashboard quote source.

## Step 4 — Apply (success) vs triage (failure)

**Success** (`applyBrokerStatement`):

1. Merge incoming option executions into `state.option_executions` by `(channel, account_id, execution_id)` **before** any lot write. Same row twice is a no-op; a conflicting row aborts the sync.
2. **Replace** every holding on channel `ibkr` with this statement’s lots. Other channels are untouched.
3. **Replace** `ibkr` cash sleeves with statement cash (ledger posts when books are on: close vanished lots, reopen current lots, adjust cash to ending amounts, `adjust_cash=false` on holding legs).
4. Write `broker_connections.ibkr.last_sync` (`ok`, `as_of`, lots upserted/removed, `not_imported`).
5. Save investor state (PostgreSQL). Executions are durable; there is no one-year purge.

So even a 365-day query still **overwrites today’s lots and cash** with the **end-of-period** snapshot. The extra days only matter for Trades/executions.

**Parse failure:** no apply. Case under `drive/<slug>/broker-raw/ibkr/<id>/` with `raw.xml` + `case.yaml` (`looks_like`, tag counts, error). Use `list_broker_triage` / `read_broker_raw`, or save a `csv_tables` spec (IBKR CSV only).

## What this sample would store (if Trades did not fail parse)

| Store | This file |
|---|---|
| Raw XML | Yes — one-day Activity statement |
| `ibkr` lots | 8 stocks + 139 short options as of 2026-09-14 |
| `ibkr` cash | One USD sleeve (BASE_SUMMARY resolved via EquitySummary) |
| `option_executions` | **None** with current parser (missing execution fields). With Trades stripped: field omitted, previous journal kept |
| Daily NAV / 2026-09-11 equity row | Dropped |
| Two-month history | **Not in the file.** Period is last business day |

## Flex query changes (if you want history)

Do **not** set a custom range whose **to-date is in the past** and then Sync — that would replace current lots with old positions.

To keep current books **and** import option fills back ~60 days:

1. **Period:** Last 90 Calendar Days (or Last 365). Query id can stay.
2. **Keep** Open Positions + Cash Report, format XML.
3. **Trades:** Executions level, with the fields listed on the Activity Query ID help in Settings (especially `tradeID`, `conid`, `levelOfDetail`, `openCloseIndicator`, `ibCommissionCurrency`).
4. Prefer per-currency Cash Report rows; BASE_SUMMARY-only still works if Equity Summary In Base is included.
5. Sync once. Confirm `last_sync.ok` and that `option_executions` gained rows. Raw XML for that pull will show `fromDate` covering the lookback, `toDate` still prior day.

For fills older than the Web Service window (~365 days, and IBKR may 1003 older ranges), download Activity XML from Client Portal and use Trades import (journal only).

## Code map

| File | Role |
|---|---|
| `src/ibkr/flex-client.ts` | SendRequest / GetStatement |
| `src/ibkr/flex-adapter.ts` | Catalog fetch + parse |
| `src/ibkr/flex-parse.ts` | XML → `FlexStatementDoc` |
| `src/ibkr/flex-executions.ts` | OPT execution rows |
| `src/ibkr/flex-map.ts` | → `BrokerStatement` |
| `src/brokers/connections.ts` | `syncBrokerConnection` |
| `src/brokers/apply-statement.ts` | Snapshot apply + execution merge |
| `src/brokers/import-executions.ts` | Historical XML upload |
| `src/ibkr/flex-apply.ts` | `ibkr-flex/` archive |
| `src/raw-data/store.ts` | `list_raw_data` provenance |
