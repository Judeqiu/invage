# Remaining broker fee recovery

## Tiger

A live read-only query confirmed that `fund_details` returns individual option
trade cash and fee lines back to at least May 2024. In the inspected PLTR roll,
fees total USD 9.11 for the buy leg and USD 9.23 for the sell leg, exactly matching
the parent total USD 18.34. Commission, platform and regulatory fee rows identify
the contract and direction. GST rows can omit the contract description.

The user explicitly approved associating unlabeled GST with the Trade block
containing it in broker record-ID order, only when date, currency, update time,
trade cash and the parent fee total reconcile uniquely. This approval applies to
source association, not an estimated proportional split between contracts.

The connector fetches every fund-details page at the documented ten-call/minute
quota, preserving exact amount/ID tokens and incomplete responses. Matching
requires complete final fills, uniquely reconciled contract/side/date and cash,
verified Trade blocks, GST evidence and exact parent conservation. Ambiguous or
contradictory evidence leaves execution fees unknown with a coverage gap. The
original parent totals and unaltered cash rows remain available in the archive;
enriched executions retain source-row hashes.

Incremental sync revisits the retained history bounds when prior execution fees
are missing. This also recovers parents outside the normal incremental window.
No arbitrary history cutoff or result cap is added.

## Futubull OpenD

OpenD order fees provide a reported total independently of the optional item
breakdown. Keep that total, including zero or rebates, when the breakdown is
absent. Repeated shared parent IDs are retained once; fees are not duplicated
across different contracts. Contradictory parent fee observations remain
unallocated. Incremental sync revisits older missing fee evidence.

The documented OpenD account cash-flow schema contains currency, amount, type
and free-text remarks, but no contract/order identifier field. Unlike the Cloud
API's contract-filtered cash logs, these fields alone do not prove an exact
multi-leg fee assignment. No live OpenD account is configured in the inspected
Velovest accounts, so live gateway validation is unavailable.

For exact source facts absent from either API, the generic statement evidence
importer now accepts optional `execution_fees`, each with execution ID, currency,
signed `fee_cash`, and source reference. It verifies the source file SHA256 and
account scope, fills missing fees only, rejects conflicts atomically, preserves
rebates/zero, records provenance, and refreshes the same existing projections.
No UI change or broker-specific estimated fee schedule is required.

Example evidence addition (negative is a fee; positive is a reported rebate):

```json
{"execution_fees":[{"execution_id":"broker-execution-id","currency":"USD","fee_cash":"-3.29","reference":"Statement page 2, transaction row 10"}]}
```

This is an optional field on the existing version-1 statement evidence document;
all original scope/source/contracts/lifecycle/annotations fields still apply.
Use `scripts/import-statement-evidence.mjs` in preview mode first. Supplying a
parent total without exact per-execution evidence does not authorize inventing
a leg split.

## References

- https://docs-en.itigerup.com/docs/accounts-java
- https://docs-en.itigerup.com/docs/ratelimit
- https://github.com/tigerfintech/openapi-python-sdk/blob/master/tigeropen/trade/request/model.py
- https://openapi.futunn.com/futu-api-doc/en/trade/order-fee-query.html
- https://openapi.futunn.com/futu-api-doc/en/trade/get-acc-cash-flow.html

## Read-only reconciliation before deployment

A complete 82-page export contained 8,167 cash-flow records for the inspected
Tiger account from 2024-05-28 through 2026-10-28. Applying the matcher to a copy
of its retained history recovered all 289 previously missing execution fees.
Every recovered parent conserved its reported total; no unmatched fee result
remained in that preview. No user state was modified by the preview.
