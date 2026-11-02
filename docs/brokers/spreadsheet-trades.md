# Offline spreadsheet trade reconstruction

`scripts/import-spreadsheet-trades.mjs` imports an explicitly approved year of
extracted worksheet rows into the option trade journal. It requires the original
workbook in the target account Drive, a matching source manifest, a checksum of
the extracted JSON and an explicitly approved contract multiplier. It defaults
to a dry run; `--apply` saves the accepted records and a private recovery receipt.

```sh
node --import tsx scripts/import-spreadsheet-trades.mjs USER_UUID JOURNAL_JSON ORIGINAL_XLSX \
  --year=YYYY --multiplier=APPROVED_VALUE --journal-sha256=SHA256 [--apply]
```

The extracted JSON follows `SpreadsheetJournalRow` in
`src/brokers/spreadsheet-trades.ts`. The adjacent `manifest.json` binds its
`scope.user_id`, `scope.account_id`, `scope.channel`, `source.sha256` and
`source.sheet`. Obtain approval for interpreting Credit as sell, Debit as buy,
Quantity as option contracts and the supplied multiplier before running an import.

Accepted rows identify a single option and have matching symbol, strike and
expiry columns. Their cash is Credit minus Debit; signed fee cash is minus Fees.
Amounts stay exact decimal text. IEEE-754-equivalent strike serialization is
accepted without rounding cash. Zero cash, negative Credit/Debit, conflicting
terms and ambiguous quantities remain source evidence for human review.

Manual IDs and `spreadsheet_source` preserve the workbook checksum, Drive file,
sheet and row. Dates remain dates, with no invented midnight timestamp. Position
effect remains unknown, so these rows contribute recorded premium cash but do
not manufacture opening lots, realized profit or expiration/assignment events.
They are not represented as broker-confirmed executions in shared broker history.

The importer rejects overlapping existing year records rather than deduplicating
unrelated broker evidence by date or amount. Repeating the same import is a no-op.
It uses a broker lease and optimistic revisions, prepares views using saved
valuations, preserves current holdings, cash, lifecycle evidence, quote times and
daily history, and retains a newer valid projection. Source files are rechecked
before saving; the persisted state is verified before publication. Recovery
artifacts live under `data/repairs/spreadsheet-trades/` and must be inspected if
publication fails after the account save.

## Resolve held IBKR rows from Activity CSVs

`scripts/resolve-ibkr-worksheet-review.mjs` resolves only the rows rejected by the
original worksheet reconstruction. It requires the same account-bound journal,
workbook and manifest, plus a directory of immutable statement CSVs and review
files. `sources.json` lists their `{name, sha256}` pairs; its checksum must be
supplied as `--sources-sha256=HEX`. It defaults to preview; `--apply` saves the repair.

Matching requires a unique statement order with the same contract description,
date and cash magnitude. The broker supplies the signed proceeds, exact signed
commission, quantity, instrument multiplier and opening/closing code. Cash
magnitude identifies evidence only; it never replaces the broker's signed cash.
Same-day opening and closing orders are distinguished by the recorded cash.
No order aggregate is presented as an execution-level broker fill or inserted
into broker API history. Statement record IDs retain the source hash and CSV line.

Explicit `Ep` and `A` codes resolve expirations and assignments. Assignments also
require a unique stock delivery with matching quantity, strike, date/time and
signed principal. Share principal stays outside option premium cash. Lifecycle
quantity discrepancies remain in the resolution receipt alongside the unchanged
worksheet row. Expiration does not imply a settlement method.

The repair verifies the prior approved import, refuses overlapping records,
prepares account and broker views from the existing valid saved valuation, and
checks optimistic revisions, source checksums and readback. It retains source
files, row-level evidence, a state backup, prepared views and a receipt. Repeating
an identical repair adds nothing. It preserves current holdings, cash, raw broker
history, valuation timestamps and daily history. It does not revise other accepted
worksheet rows or claim that the supplied months establish full historical coverage.
