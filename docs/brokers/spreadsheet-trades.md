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
