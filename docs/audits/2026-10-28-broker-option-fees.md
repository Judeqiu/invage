# Broker option fee reconciliation

Moomoo and Futubull Cloud share the signed Cloud transport and history mapper.
Both publish `GET /api/v1.0/accounts/{acc_id}/cash_logs`; a read-only Futubull
production probe confirmed actual `Option Sell Fee` and `Option Sell Execution`
rows, including the contract symbol, signed cash and balance currency.

## Implemented

Fetch every cash-log page for observed multi-leg option contracts and retain
unaltered responses in the account-bound source archive. Match by exact contract
and side only when a single parent order is possible, all final fills reconcile,
the execution cash agrees exactly, the fee currency is verified, and the sum of
leg fees equals the broker's parent fee. Keep zero fees and rebates as reported.
Store hashes of supporting cash rows on enriched executions. Do not infer a
cash-log timezone, estimate leg splits, or treat missing evidence as zero.

Incremental sync revisits previously retained multi-leg fills with unknown fees,
using the original retained history bounds and contract-filtered API requests.
Repeated fills must agree; enrichment updates missing fees without changing
execution prices, quantities, cash or IDs. Unavailable or ambiguous evidence
retains unknown fees and records a retryable coverage gap. Recovery clears the
corresponding gap. Refresh current funds after the historical requests finish.
No UI changes or David-specific matching rules are required.

## Other connectors reviewed

- IBKR Flex supplies execution commissions. Four inspected accounts had no
  missing commissions among their recorded option executions.
- Tiger retains multi-leg charges on the parent. Victor's inspected Tiger
  history contained 289 option executions with unknown fees and 156 multi-leg
  orders. This is a similar unresolved coverage issue; Tiger needs its own
  verified per-leg source. The Cloud cash-log parser is not applicable.
- Webull queries order details and uses reported actual commission/fee values,
  excluding receivable estimates. It does not produce the same normalized
  execution dataset, so an execution-based completeness count cannot verify
  full fee coverage.
- Futubull OpenD is a separate gateway adapter using order fee queries. This
  Cloud change does not add per-leg cash-log reconciliation to OpenD.
- The inspected Futubull Cloud account had 27 option executions with no missing
  fees and no multi-leg orders. Production endpoint compatibility was verified;
  multi-leg handling for both Cloud providers is covered by regression fixtures.

The counts are a point-in-time audit, not a guarantee that future broker
responses always include final fees.

## Broker references

- https://open.moomoo.com/api/trading/account/get-cash-logs
- https://open.futunn.com/api/trading/account/get-cash-logs
- https://open.moomoo.com/api/trading/order/get-order-fees
- https://docs-en.itigerup.com/docs/orderinfo-java

## Verification notes

TypeScript build and focused cash-log/history/fee regressions pass. The wider
checks also exposed two existing failures, reproduced from the unchanged HEAD:
`broker-sync-history.test.ts` still uses non-UUID fixture IDs, and
`moomoo-executions.test.ts` expects failed history pagination to reject rather
than retain the current snapshot with `history_error`. Database persistence
integration checks require `UTARUS_TEST_DATABASE_URL`; it is not configured in
this local environment. These are not counted as passing checks.
