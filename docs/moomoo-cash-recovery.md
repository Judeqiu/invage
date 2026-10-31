# Historical option cash recovery

An expired option can retain its complete broker fills but lack current contract
metadata. Such fills cannot enter the option cash journal until the exact
contract multiplier is known. Regular moomoo and Futubull Cloud sync now fetch
complete contract fills and cash logs for those unresolved contracts, including
on incremental sync. Raw responses remain archived through normal sync capture.

Recovery derives a positive exact multiplier independently for each contract.
The full queried interval must cover both fills and cash. Broker execution cash
must match the signed quantity × price × derived size, either per fill or per
whole order, as an exact amount multiset. Buy and sell evidence must agree.
Zero-price fills can use a size established by other fills of the same contract;
zero-only contracts cannot establish one. Negative prices retain their signs.
Partial, conflicting, foreign-currency or unmatched evidence cannot establish a
multiplier. Existing exact metadata, cash and fees are preserved. There is no
default contract size or timestamp-based cash association.

## Applying an already collected API recovery

`scripts/recover-moomoo-cash.mjs` accepts the user UUID, evidence directory and
`--receipt-sha256=HEX`. It runs read-only unless `--apply` is supplied. Execute
with `node --import tsx` under the verified service environment and an absolute
`UTARUS_DATA_ROOT`; never print credentials. The collection receipt must contain
the verified account binding, complete paginated US/HK fills and account cash
ledger at the same cutoff, and SHA256/byte lengths for every source file.

The command verifies the immutable receipt and every source checksum, compares
fresh API fills with retained identities and economic terms, and enriches only
missing cash/multiplier fields. It preserves known values, checks idempotence,
and reports monthly totals and unrelated unknown fees. It does not infer
assignment, exercise, missing lifecycle events or realized profit.

Application holds the broker sync lease, prepares replacement account and broker
views from saved valuations while retaining quote/daily history, checks the
latest account revision and source hashes, and retains the previous state and
staged projection under `data/repairs/moomoo-cash`. The source package is retained
in the account Drive under `moomoo-cash-recovery/<receipt SHA256>`. After an
optimistic save it checks exact state readback and publishes a matching saved
projection, retaining a newer valid projection. Inspect the completed receipt
before declaring success. A repeated application adds no trades.

Unrelated fee gaps remain unknown. Resolving historical cash does not establish
that all historical broker events or fees are available.
