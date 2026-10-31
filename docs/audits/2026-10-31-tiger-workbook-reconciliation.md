# Tiger historical journal reconciliation

Target: Velovest, `victorconsultant`, https://chat.velovest.lextok.com.
Branch: `main`. No UI, valuation method, schema or dependency changes.

## Evidence and diagnosis

The supplied Tiger trading journal contains 1,447 dated trade/activity rows in
47 monthly sheets. Preserve original row dates, blanks, assignment notes and
multi-contract roll descriptions. A worksheet row is not necessarily one fill.
Compare option execution cash before fees separately from commissions, transfers,
assignment principal, current position cost and realized P&L.

An authenticated, read-only Tiger `order_transactions` query covering 2000 through
2026-10-31 returned 1,920 option fills across 20 completed pages. Every ID, account,
contract, side, quantity, price, cash amount and market-local execution time matched
the retained history. This investigation found no missing API fills relative to
that complete query.

The saved option journal contained only 590 of those fills. The retained history
had 1,346 missing multipliers across 591 contracts; 16 fills already had separately
retained journal metadata. `optionExecutionsFromHistory` requires a multiplier,
so 1,330 fills with known cash and fees were omitted. Their net execution cash
before fees totals USD 491,255. Existing journal cash was USD 568,206; the full
broker execution total is USD 1,059,461. These are cash-flow totals, not profit.
All 590 existing journal cash/fee records matched retained source values exactly.
All 1,413 parent fee totals conserved their retained execution fees.

## Workbook comparison

- The 2022 workbook cash total and retained API cash both equal USD 17,903.
- The 2024 workbook cash total and retained API cash both equal USD 125,884;
  the original saved journal included only USD 63,633.
- January through July 2026 each match the broker's calendar-month option cash.
- October 2026 worksheet option trade cash is USD 8,590 through its last recorded
  trades; the broker matches at that cutoff. Later October fills must not be
  treated as worksheet discrepancies.
- January 2023 includes a USD 2,650 worksheet debit alongside a verified USD 2,255
  sale, and a USD 2,215 worksheet debit where Tiger reports a sale. These account
  for the month's USD 7,080 cash difference. Preserve the source observations.
- November 2023 includes a USD 3,336 worksheet TSLA credit versus broker cash
  USD 3,326. November 2025 includes a USD 14 worksheet VRT debit versus broker
  cash USD 18. July 2023 differs by USD 1.
- The August 2026 sheet includes USD 3,520 on an MBLY row explicitly marked
  Assigned (Put), with no fee/debit. Keep it separate from option fill premiums.
- Some entered dates differ from sheet headings and broker market dates. For
  example, May 2024 contains a PANW row dated March 17. No dates were corrected
  or absent buybacks fabricated.

Matching annual or monthly totals does not establish every row's correctness.
Assignment rows and incomplete cash fields remain distinct from verified fills.

## Approved recovery and sync behavior

The user explicitly approved cash-derived multipliers when all exact-contract
fill evidence agrees. Signed broker execution cash divided by quantity and price
independently produces 100 for all 902 observed contracts. Recovery does not
default to 100: exact finite decimal division also supports other verified sizes.
It groups by account, channel, native contract and currency, cross-checks every
available fill and existing size, and leaves contradictions unresolved. It never
changes reported cash, fees, quantities, dates or opening/closing intent.

`mapTigerHistory` uses the recovery during normal parsing. Incremental sync
revisits retained history when historical multipliers remain absent, including
when all fees are known. Missing metadata and contradictory source evidence remain
explicit gaps. Broker open/close uncertainty is independent of multiplier recovery.

`scripts/recover-tiger-multipliers.mjs` previews by default. It requires a checksummed
complete account-bound API export, matches every retained option fill against it,
checks idempotence, preserves every existing journal entry, and prepares account
and broker projections from saved valuations. Apply takes the account sync lease,
rechecks the optimistic revision and source fingerprint, saves the prior state and
prepared projection with immutable API evidence, then publishes a projection
against the reloaded persisted fingerprint. A newer valid generation wins.

## Validation

Independent live-evidence replay through the production parser and retained-history
recovery agreed for all 1,920 fills: 1,346 multipliers recovered, 1,330 journal
entries added, no remaining multiplier gaps, existing economic evidence unchanged,
and a second recovery added nothing. Full option fees total USD 8,049.31.
Regression coverage includes the workbook's first PLTR sale and both partial
buybacks, differing contract sizes, exact decimal arithmetic, conflicting cash,
known-size conflicts, zero-priced fills, rebates, account/currency isolation,
expired contracts without current positions and incremental metadata retries.

Sources: [Tiger order and transaction fields](https://docs-en.itigerup.com/docs/orderinfo-java),
the account-bound fresh API export, retained broker history and saved projection,
and the user-supplied workbook. Private evidence stays outside Git.
