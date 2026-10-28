# Historical option reconciliation

Trades and Dashboard Section 03 use the same saved historical rows. A partial
close realizes the closed contracts under the existing FIFO method; remaining
contracts stay in the open book. Opening premium and fees are allocated by the
quantity consumed from each opening fill. Source quantities and money are never
rewritten. Exact fractions are retained during calculation; non-terminating
fractions are rounded to native currency precision for presentation, with a note.
Missing commissions keep net P&L unknown while before-fee P&L remains available.

## Statement evidence imports

Use the generic operator importer to supplement retained broker history with
explicit statement facts. It does not change current holdings or cash. This is
an evidence import, not an automatic parser for arbitrary PDF or XLSX layouts.
Prepare a JSON evidence document from explicit source rows, retaining the original
file and its SHA256. The importer archives both files under the user's private
Drive and stores source references in state. It rejects conflicting metadata,
foreign account bindings and duplicate lifecycle replacement links. Preview first:

```sh
node --import tsx scripts/import-statement-evidence.mjs USER_UUID evidence.json original-statement.xlsx
node --import tsx scripts/import-statement-evidence.mjs USER_UUID evidence.json original-statement.xlsx --apply
```

Run as the service user with its full environment and absolute `UTARUS_DATA_ROOT`.
The source file's bytes must match `source.sha256`. Re-importing identical evidence
is idempotent. New imports require the matching account's broker sync lease.
No code or script contains a special user, symbol or multiplier default.

Document shape:

```json
{
  "version": 1,
  "broker_id": "moomoo",
  "channel": "configured-account-channel",
  "account_id": "configured-broker-account-id",
  "source": {"name": "Original statement", "sha256": "64 lowercase hexadecimal characters", "reference": "page or sheet and cells"},
  "contracts": [
    {"native_symbol": "exact broker contract ID", "multiplier": "reported decimal", "reference": "exact source location"}
  ],
  "lifecycle": [],
  "annotations": []
}
```

Each lifecycle row follows `OptionLifecycleEvent`, uses `source: broker_statement`
and `source_ref` equal to the original source SHA256, and lists explicit
`replaces_execution_ids`. These links must identify retained zero-price closing
fills with matching contract terms and total quantity. Event dates come from the
statement's actual event date, not its posting date. An exercise is not counted
as an ordinary zero-price options loss; physical delivery without broker-reported
option profit leaves that profit unavailable. Zero-price records alone do not
prove exercise or expiry. Raw records remain intact and are not counted twice.

A liquidation annotation is
`{"execution_id":"retained closing fill ID","kind":"forced_liquidation","reference":"statement * at source location"}`.
Its classification and provenance appear in trade details; the API's ordinary
buyback is not relabelled as broker-reported forced liquidation without evidence.

Spread order fees remain shown as whole-order fees. The importer does not infer
per-leg fees or import estimated allocations as broker facts. Both a supplied
workbook and its original broker statements can be archived, but the source name
must accurately describe the evidence actually supplied.
