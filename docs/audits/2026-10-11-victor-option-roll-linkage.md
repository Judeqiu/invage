# Victor's option roll linkage review

Review date: 2026-10-11. Read-only review of Victor's retained broker archives on Velovest (`lextokprod02`, `/opt/victorconsultant/data/drive/<Victor user UUID>/`). No broker activity, production data changes, or application changes were made during the review.

## Findings

The raw archives contain enough evidence to identify many option roll relationships. Tiger and MooMoo provide explicit shared parent-order linkage. IBKR provides shared brokerage order IDs for some pairs and an observed execution-ID prefix pattern for others. Webull's retained records support only a weaker temporal candidate.

| Broker | Result | Evidence |
| --- | --- | --- |
| IBKR | 100 strongly linked short-option roll candidates | Equal quantities, matching fill-time intervals, and paired execution-ID prefixes; 24 also share a nonempty `brokerageOrderID` |
| Tiger | 111 filled roll-shaped combinations; preceding activity supports short-option rolls for 110 | Transactions share a parent `orderId`; parent order contains explicit contract legs and combination type |
| MooMoo | 125 explicitly linked short-option rolls | Shared `order_id`, explicit `BUY_BACK` and `SELL_SHORT` directions, and equal aggregate quantities |
| Webull | One possible resized roll; no directly linked roll found | Separate single-leg orders executed approximately 2 minutes 23 seconds apart |

These are conservative findings from the reviewed archives, not exhaustive counts of all rolls or a certification of complete account history. Unlinked or unequal-quantity activity may contain further rolls. Counts are order-pair or parent-order counts, not individual fill counts or numbers of contracts.

## Scope and method

The review used raw archived broker records rather than holdings snapshots or only the normalized execution journal. Position disappearance, accounting reconciliation postings, assignment, exercise, and expiration were not treated as roll executions.

| Broker | Retained history examined | Notes |
| --- | --- | --- |
| IBKR | Option execution records dated 2025-09-23 through 2026-10-07 | Overlapping XML archives deduplicated by account and trade ID: 1,263 unique option records, including exchange trades and lifecycle book trades; no conflicting duplicate attributes found |
| Tiger | Transaction history dated 2022-10-31 through 2026-10-06 | Reviewed history bundle containing 1,994 order records and 1,876 option transactions; order records also include stock and lifecycle activity |
| MooMoo | Fill history dated 2023-04-25 through 2026-10-08 | 1,383 unique deal records; not all records are options |
| Webull | Filled option orders dated 2024-12-10 through 2026-10-01 | 83 history groups containing 83 orders, of which 57 are option orders with nonzero filled quantity |

Dates are execution dates in the US market clock where converted from epoch or UTC timestamps. IBKR timestamps retain the broker's reported clock; no timezone was invented. Returned record dates describe observed coverage, not proof that every trade in those periods was returned.

Representative evidence sources relative to Victor's Drive root:

- IBKR: `ibkr-flex/activity-2026-09-22-2026-09-24T01-51-58-034Z.xml` and retained `broker-sync/ibkr/` XML archives through statement date 2026-10-08.
- Tiger: `broker-sync/tiger/2026-10-09T22-04-04.267Z-tiger.json` and the subsequent 2026-10-10 sync archive.
- MooMoo: `broker-sync/moomoo/2026-10-10-2026-10-10T00-28-10-991Z-fd08ee8f-b71d-4026-9b07-9c54ab495abc.json` and the earlier execution-history archive.
- Webull: `broker-sync/webull/2026-10-10-2026-10-10T00-28-16-092Z-02575e88-8145-4e44-af75-d52aa915eaa4.json` and the preceding history archive.

## IBKR

The 100 candidates all buy to close an old short option and sell to open an equal quantity of a different contract, within the same account, underlying, right, currency, and multiplier. Partial fills were aggregated by order, contract, and action. All quantities in each candidate reconcile to paired fills with matching execution-ID prefixes and timestamps.

- 97 move to a later expiry; 3 change strike within the same expiry.
- Of the later-expiry pairs, 60 change strike and 37 retain it.
- 64 are puts and 36 are calls.
- 97 produce a net cash credit and 3 a debit.
- 24 share an explicit, nonempty `brokerageOrderID`; the remaining 76 rely on corroborated execution patterns.

The two legs have different `ibOrderID` values. Grouping only by that field would miss these pairs. Matching the first two dot-separated components of `ibExecID` is an observed pattern in this dataset, not an asserted universal IBKR identifier contract.

For example, the 2026-09-28 PATH $15 put roll contains three paired fills of 13, 5, and 12 contracts. Its close and open orders are `76410806` and `76411095`, while both share brokerage order `00d8b2fc.0001e121.6aba5a8b.0001`. One paired execution prefix is `0002be7d.6aba5e87`, with leg execution IDs ending in `.02.01` and `.03.01`.

| Trade date | Contracts | Closed | Opened | USD net cash credit |
| --- | ---: | --- | --- | ---: |
| 2026-09-04 | 138 | PATH $17 call, 2026-11-20 | PATH $19 call, 2027-03-19 | 13,734.61 |
| 2026-09-18 | 20 | PATH $14 put, 2026-09-18 | PATH $14 put, 2027-01-15 | 3,269.73 |
| 2026-09-28 | 30 | PATH $15 put, 2026-10-16 | PATH $15 put, 2027-03-19 | 2,474.47 |
| 2026-09-29 | 4 | SLV $60 put, 2026-10-16 | SLV $60 put, 2027-04-16 | 1,301.89 |
| 2026-10-02 | 1 | TSLA $395 put, 2026-10-16 | TSLA $395 put, 2027-02-19 | 2,270.62 |

Cash amounts above sum the raw `netCash` across both legs, including reported commissions and taxes, and are rounded to cents. They are roll cash flows, not realized profit.

An apparent 15-contract AMD call chain is:

| Roll date | Closed | Opened |
| --- | --- | --- |
| 2025-10-06 | 2025-12-19 $200 call | 2026-04-17 $220 call |
| 2025-10-27 | 2026-04-17 $220 call | 2026-12-18 $250 call |
| 2026-05-27 | 2026-12-18 $250 call | 2027-09-17 $270 call |
| 2026-07-27 | 2027-09-17 $270 call | 2028-06-16 $300 call |

Each transition has linked execution evidence. Continuous ownership of the same 15 contracts across the entire chain still requires reconciliation of all intervening activity.

Two additional shared-brokerage-order groups switch between puts and calls. They were excluded from the 100 conventional same-right candidates and should be displayed separately as strategy changes.

## Tiger

The archive includes 150 `MLEG` order records. Transactions for multiple contracts can reference the same parent order via transaction `orderId` matching parent `id`. Parent `legs` specify expiry, strike, right, action, ratio, multiplier, and filled quantity.

111 filled combinations pass the conservative two-leg, same-underlying, same-right, opposite-action, equal-quantity checks, with transaction quantities agreeing with the parent legs:

- 70 calendar combinations.
- 33 diagonal combinations.
- 8 vertical combinations.

A combination alone does not prove a roll: it could open a new spread. A chronological balance check using preceding transactions and explicit lifecycle order activity supports buying back an existing short and selling a replacement short for 110 combinations. This remains a historical reconciliation within the retained evidence, not a broker-provided per-leg open/close certification.

The remaining combination, parent order `37257690573833216`, has an existing long position on the sell leg. It needs separate classification rather than an automatic short-roll label.

| Trade date | Contracts | Closed | Opened | Parent order ID |
| --- | ---: | --- | --- | --- |
| 2026-09-28 | 20 | PATH $15 put, 2026-10-16 | PATH $15 put, 2027-03-19 | `44788439191785472` |
| 2026-10-02 | 1 | TSLA $400 put, 2026-10-16 | TSLA $390 put, 2027-01-15 | `44833572139568128` |
| 2026-10-06 | 1 | NVDA $235 call, 2026-11-20 | NVDA $245 call, 2027-01-15 | `44878331138280448` |

Tiger supplies combination-level commission and GST. Preserve the total at the parent level; allocating that fee to individual legs requires an explicit method. Parent `realizedPnl` must not be substituted for roll net cash or total strategy profit.

## MooMoo

125 order groups contain a `BUY_BACK` on the old contract and a `SELL_SHORT` on a different contract with the same underlying and right, with equal aggregate quantities. All 300 fill records comprising these groups have status `OK`.

- 124 move to a later expiry: 66 retain strike and 58 change strike.
- One changes strike within the same expiry.

The shared `order_id` establishes the order relationship, while trade directions explicitly establish short closing and short opening. `deal_id` identifies each fill, allowing partial fills to be retained and quantities aggregated without double counting.

| Trade date | Contracts | Closed | Opened | USD gross credit before fees |
| --- | ---: | --- | --- | ---: |
| 2026-09-18 | 30 | PATH $14 put, 2026-09-18 | PATH $14 put, 2026-12-18 | 4,350.00 |
| 2026-09-28 | 20 | PATH $15 put, 2026-10-16 | PATH $15 put, 2027-01-15 | 1,280.00 |
| 2026-10-02 | 1 | TSLA $410 put, 2026-10-16 | TSLA $410 put, 2027-03-19 | 2,233.00 |
| 2026-10-06 | 1 | NVDA $235 call, 2026-11-20 | NVDA $245 call, 2027-01-15 | 80.00 |

For the NVDA example, both fills share order `FS1D3F386FDE137000` and execution timestamp `1791294035162267` (epoch microseconds). Buyback price is $15.91 and opening sale price is $16.71 for one standard 100-share contract.

The reviewed Cloud fill rows do not contain commissions. Amounts above are gross premium differences before fees, not net cash or realized profit.

## Webull

The retained history contains one order per group and no multi-leg option orders. Option orders have distinct `order_id` values; no useful shared parent reference was found. `position_intent` is absent in these records, so buy/sell alone does not establish opening or closing.

One temporal candidate occurs on 2026-04-02:

| US market time | Action | Contracts | Contract |
| --- | --- | ---: | --- |
| 10:45:02.270 | Sell | 5 | PATH $12 put, 2026-11-20 |
| 10:47:24.805 | Buy | 2 | PATH $17 put, 2026-05-15 |

An earlier sale supports treating the two-contract buy as a short close. The later-expiry sale precedes it by 142.535 seconds. This could represent a roll with a size increase, but timing and underlying alone do not establish intent. Label it **possible resized roll**, with separate source order IDs, rather than a confirmed pair.

Both groups use `NONE_CLIENT_ORDER_ID`. This is a placeholder shared by unrelated orders and must never be used as a linkage key.

## Implications for implementation

1. Preserve raw linkage fields and source provenance in addition to normalized contract and execution data: IBKR brokerage/order/execution IDs; Tiger parent ID, combination type, and legs; MooMoo order/deal IDs and trade direction; Webull order/group IDs and position intent when supplied.
2. Prefer explicit parent-order linkage. Keep execution-prefix matching as corroborated inference and timing-only matches as weaker candidates, with visible evidence and confidence.
3. Verify position effect before labeling a combination a roll. Handle long rolls, same-expiry strike changes, resized rolls, cross-right strategy changes, and partial fills separately.
4. Import historical contract metadata independently of current holdings. The current Tiger, MooMoo, and Webull history mappers restrict imported history to contracts matched to current lots, which can omit the closed leg of a roll.
5. Keep roll links separate from position episodes and lot matching. A linked close/open pair does not establish continuous ownership, complete realized P&L, or the profitability of the replacement position.
6. Deduplicate overlapping archives, scope every relationship to its broker and account, and never consume the same fill twice in competing candidate pairs.

The current `OptionExecution` shape does not preserve these parent-order linkage fields. Raw archives therefore remain necessary evidence for this review and any later backfill.

## References

- [IBKR Flex Trades fields](https://www.ibkrguides.com/reportingreference/reportguide/tradesfq.htm): order/execution identifiers, open/close indicator, proceeds, commissions, taxes, and net cash.
- [Tiger order and transaction history reference](https://quant.itigerup.com/openapi/en/java/operation/trade/orderInfo.html).
- [Webull Trading API overview](https://developer.webull.com/apis/docs/trade-api/overview/): general API support includes multi-leg options; absence of multi-leg orders here is a finding about Victor's retained data, not a claim that Webull cannot support them.

MooMoo findings rely on the actual archived Cloud response. OpenD documentation was not treated as proof of the Cloud API's response contract. Relevant local implementations are `src/ibkr/flex-executions.ts`, `src/tiger/tiger-executions.ts`, `src/moomoo/moomoo-executions.ts`, `src/webull/webull-executions.ts`, and `src/brokers/option-executions.ts`.
