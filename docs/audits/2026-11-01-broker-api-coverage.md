# Broker API processing coverage audit

Implementation follow-up: the SH-01/CL-01 safeguards and notification behavior are described in the [separate review register](2026-11-01-broker-api-data-review.md). The reproductions below record behavior before that fix; they remain evidence of the original defects, not a live-account impact assessment.


Reviewed: 2026-11-01 (Singapore). Source baseline: `01b21845743225765a1072041de88fcbb7b42e97`, branch `main`.

## Result

**The application does not yet process every available or returned broker datum into a normalized, reconciled financial record.** Current snapshots, trade history, raw evidence and reports have different coverage. Preserving a source bundle is not proof that its contents reach financial state or reports.

The separate [data review list](2026-11-01-broker-api-data-review.md) contains the unprocessed data, processing defects, unresolved interpretations and proposed exclusions. Its decisions are pending user review. This audit changes documentation only; it does not approve exclusions, change calculations, modify UI or operate production services.

## Scope and evidence

The [connector catalog](../../src/brokers/catalog.ts) and [adapter registry](../../src/brokers/adapter.ts) define five brokers. Six account transports were traced: IBKR Flex XML, Tiger OpenAPI, moomoo Cloud, Futubull Cloud, legacy Futubull OpenD and Webull Trading API. Connected Cloud market-data collection was also reviewed; it is a separate path from account sync.

For each path, the review followed request selection and pagination, decoded response construction, current-state mapping, normalized history, option-journal eligibility, source capture and saved reporting. Official documentation was checked for the integrated resources and additional account/activity resources. Broader API families were inventoried for review rather than assumed unnecessary.

This is a specification/code audit, with targeted synthetic reproductions. It is **not a fresh live reconciliation of every account, region, permission set or SDK version**. The earlier Tiger live reconciliation applies to its inspected account and cutoff; it does not establish other brokers' completeness. Vendor documentation describes availability, not entitlement for a particular credential. Neither an endpoint listed in another API product nor a similarly named Cloud/OpenD method establishes access through our existing connection.

Some Webull reference pages exposed only the endpoint shell when opened directly. Their official indexed schema content was used where available; a complete versioned field-by-field schema export was not obtainable in this review. The report therefore does not certify exhaustive coverage of every optional field, every vendor research endpoint or all future schema changes. Unclassified fields and inaccessible specification details must remain unresolved in the proposed coverage register, not be marked supported.

## Findings reproduced without changing financial state

### Returned invalid cash sleeve can disappear without a blocking diagnostic

A synthetic response supplied valid USD cash and an explicitly returned SGD cash field containing a nonnumeric unavailable value. Each of the Tiger, moomoo Cloud, Futubull Cloud, Webull and OpenD mappers accepted the USD sleeve, omitted SGD and emitted **no cash skip**.

The [cash replacement function](../../src/brokers/apply-statement.ts#L43) replaces the complete account-channel cash set. [Books reconciliation](../../src/books/broker-snapshot.ts) also treats an omitted existing currency as a zero target. Consequently, the accepted partial cash result can remove a previous sleeve if applied. This is a verified code path and synthetic reproduction, not a claim that a particular live balance has already been removed. Rejecting a completely empty cash result does not protect a partially valid result. Review item **SH-01**.

### Broker cost validity is ignored by the Cloud position mapper

A synthetic Cloud stock row with a numeric cost and an explicit false cost-validity flag was accepted as a holding without a skip. The [Cloud position mapper](../../src/moomoo/moomoo-map.ts) checks numeric convertibility but does not consume that flag. Both Cloud brands use that mapper. The provider documents the flag in its [Cloud position schema](https://open.moomoo.com/api/trading/account/get-positions). Review item **CL-01**.

Reproduction receipt: five partial-cash cases each returned only USD with zero cash skips; the false-validity stock case returned one lot with zero skips. Synthetic values and account IDs were used. No account was saved and no broker was called for these reproductions.

## Processing and persistence layers

| Layer | Current implementation | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Fetch | Per-broker clients and OpenD bridge | Selected resources were requested; successful history paths check pagination | That every account resource was requested, all regions covered, or pages fetched before a later failure were archived |
| Source archive | [adapter archives](../../src/brokers/adapter.ts), account sync and triage | Saved Flex bytes or reconstructed JSON bundle is available | That reconstructed JSON is the original HTTP body or includes discarded wrappers, headers and intermediate responses |
| Source index | [activity extraction](../../src/brokers/activity.ts), [SQL capture](../../src/brokers/activity-store.ts), [source queries](../../src/data-query/sources.ts) | Captured source records can be inspected independently of portfolio mapping | That source observations are financial postings, that an unqueried endpoint had no activity, or every archive is indexable |
| Normalized financial state | [statement](../../src/brokers/statement.ts), [history schema](../../src/brokers/history.ts), [apply](../../src/brokers/apply-statement.ts) | Supported holdings, cash, orders, legs, executions and selected metrics persist | A general normalized dividend, interest, tax, transfer, corporate-action or tax-lot ledger |
| Books | [broker snapshot reconciliation](../../src/books/broker-snapshot.ts) | Current balances are reconciled through accounting entries, including signed debit cash | That snapshot adjustment entries explain the underlying broker cash activities |
| Option journal | `optionExecutionsFromHistory` and Webull's order-derived importer | Eligible option cash enters shared journals | That excluded executions have been accounted for individually or that stock cash belongs in option premium |
| Saved reports | [account projections](../../src/state/projection-store.ts), [broker projections](../../src/report/broker-projections.ts) | Persisted calculations can be served consistently | That missing source records or fields have been recovered merely because a projection is valid |
| Cloud risk market data | [collector](../../src/risk/market-provider.ts), [advanced collector](../../src/risk/advanced-market.ts) | Selected model inputs, quotes and aligned history are saved | Full retention of every returned quote, chain, bar, dividend field or rejected observation |

Negative broker cash is supported by the current books import (`allowNegativeCash: true`). Older notes suggesting that all debit cash is unsupported are not current evidence. Source observations must not be summed as transactions: the same trade can recur in multiple snapshots or archives.

## Account resource inventory

Endpoint paths below are code evidence. Related specifications are linked in the final section. “Retained” means the adapter's saved representation, subject to the source-capture limitations above.

| Broker/path | Requested resources | Normalized use | Remaining coverage |
| --- | --- | --- | --- |
| IBKR Flex | `SendRequest`, `GetStatement`; configured Activity query; additional calendar reports for Full sync | Supported open positions and cash; execution-level trades; selected option events from the current report | Template-dependent sections, broader activity, old lifecycle attachments, detailed lots, source valuation history and corrections need review |
| Tiger | `accounts`; `assets` or `prime_assets`; `positions` for stock/option/fund sleeves; `orders`; stock/option `order_transactions`; conditional `fund_details` | Positions/cash; three margin metrics; orders, legs, fills, fees; approved exact cash-derived option sizes | General cash collection is conditional; other asset sleeves, historical account analytics, lifecycle normalization and many supplied metrics are incomplete |
| moomoo Cloud | `/accounts/authorized_trd_accs`; account `/funds`, `/positions`, `/fills_history`, `/orders_history`, `/orders/detail`, order `/fees`; selected `/cash_logs`; option basic information | Cash and supported positions; selected funds/margin totals; US/HK fills, orders/legs/fees and option cash | Account-wide cash activity, other history markets, validity flags, additional metrics, corrections and unsupported instruments need review |
| Futubull Cloud | Same resource paths through `webapi.futunn.com`, with a distinct broker/schema/account scope | Same mapping as moomoo Cloud | Shared implementation does not establish live entitlement or field parity for every Futubull account; separate spec links are retained |
| Futubull OpenD | `get_acc_list`, `accinfo_query`, `position_list_query`, historical deals/orders and order fee query | Per-currency cash and supported stock-like positions; historical fills/orders/fees | Current option lots explicitly unsupported; cash-flow method unused; contract metadata, legs, funds metrics and broader instrument handling incomplete |
| Webull Trading | `/trading/accounts/list`; balance and position endpoints; historical orders; conditional order detail; token creation/check | Cash, buying power and supported positions; normalized orders/legs/fees; terminal single-leg cumulative option cash using `order:` IDs | General activity/transfers and open-order polling absent; normalized individual executions absent; active partial fills, multi-leg cash and additional balance/position metadata incomplete |

Account sync uses a recent overlapping interval unless Full sync is explicitly requested. Pending enrichment can widen some broker requests. This is not equivalent to continuously re-fetching the entire historical universe. Existing hard stops and the IBKR calendar range are listed for review rather than treated as provider-proven completeness.

### Cloud market-data resources already in use

The Cloud connection is also used by the risk collector for stock quotes, snapshots, static information, option chains, dividend reference data, combo quotes and historical bars. Market-data permissions can fail independently of account-data permissions. Returned data is filtered into model inputs, not passed through account activity capture.

The optional API-family review must therefore distinguish unused research resources from these existing calls. In particular, an underlying's announced dividend calendar is already used for option modeling, but that is not the investor's actual dividend receipt ledger. See **MK-01–MK-05** and **EX-04–EX-05**.

## IBKR Flex section disposition inventory

The official [Flex section directory](https://ibkrguides.com/reportingreference/reportguide/activity%20flex%20query%20reference.htm) was compared with the current parser. These are section families; report inclusion still depends on the configured query.

| Section family | Current disposition |
| --- | --- |
| Delivery/general configuration; account information; models; codes | Protocol/binding fields used selectively; remaining supplied material is source evidence |
| Open positions | Supported position subset; detailed lots and additional fields are not fully modeled |
| Trades | Execution rows normalized; selected option cash projected; aggregate/other detail rows and extra attributes remain source evidence |
| Option exercises/assignments/expirations | Selected current-report option events mapped; historical attachment processing requires review |
| Cash report | Ending balance selected; independent settled balance, movement components and other fields not fully modeled |
| NAV summary; NAV changes; position-value changes; prior positions; net stock summary | No complete normalized account valuation-history series from these sections |
| Cash transactions; statement of funds; interest accruals and tiers | Source-only if supplied, without a general broker cash-event importer |
| Dividend accrual changes and open accruals | Source-only if supplied |
| Corporate actions; transfers; incoming/outgoing trade transfers; unsettled transfers | Source-only if supplied, without a full normalized action/transfer ledger |
| Commission details; routing commissions; transaction fees | Additional detail not comprehensively reconciled to the selected execution commission field |
| Client fees/expense details; borrowing details/markup; securities lending/borrowing and related activity/fees | Source-only if supplied |
| FX rates/balances/P&L | No comprehensive normalized FX activity and broker-rate history |
| Complex positions; pending exercises; unbooked trades; instrument information | No complete dedicated normalized representation |
| MTM, month/year performance and realized/unrealized performance summaries | Broker performance observations are not interchangeable with application-calculated performance; mostly source-only |
| Debit-card activity; soft-dollar activity; IBG notes | No dedicated portfolio processing; retain supplied evidence and review product relevance |

## Completion standard proposed for follow-up work

For each account/resource and source version, account for every record as normalized, deliberately source-only under an approved policy, or unresolved with a specific reason. Reconcile record IDs as well as signed cash and fees by currency; keep orders, fills, lifecycle deliveries, stock principal, FX and premiums distinct. Include terminal and active partial fills, corrections, duplicates, zero/rebate values, unsupported instruments and rejected metadata.

A complete receipt should compare fetched, archived, indexed, normalized and report-eligible populations, and recheck them after persistence. Existing raw indexing and generic history warnings do not implement that complete receipt today. This is a recommendation, not a claim that the mechanism was added by this audit.

## Official specifications checked

- IBKR: [service request](https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/generate-the-report), [API families](https://www.interactivebrokers.com/docs/), [Flex section directory](https://ibkrguides.com/reportingreference/reportguide/activity%20flex%20query%20reference.htm), [positions](https://ibkrguides.com/reportingreference/reportguide/open%20positionsfq.htm), [trades](https://ibkrguides.com/reportingreference/reportguide/tradesfq.htm), [cash](https://ibkrguides.com/reportingreference/reportguide/cash%20reportfq.htm), [cash transactions](https://ibkrguides.com/reportingreference/reportguide/cash%20transactionsfq.htm), [option events](https://ibkrguides.com/reportingreference/reportguide/options_exercises_expirations_fq.htm), [corporate actions](https://ibkrguides.com/reportingreference/reportguide/corporate%20actionsfq.htm).
- Tiger: [account resources](https://docs-en.itigerup.com/docs/accounts-java), [orders/fills](https://docs-en.itigerup.com/docs/orderinfo-java), [contracts](https://docs-en.itigerup.com/docs/get-contract-java), [exercise request resources](https://docs-en.itigerup.com/docs/option-exercise-java), [API families](https://docs-en.itigerup.com/docs/trade-java).
- moomoo Cloud: [API families](https://open.moomoo.com/api/overview/api-reference), [accounts](https://open.moomoo.com/api/trading/account/get-accounts), [funds](https://open.moomoo.com/api/trading/account/get-funds), [positions](https://open.moomoo.com/api/trading/account/get-positions), [cash logs](https://open.moomoo.com/api/trading/account/get-cash-logs), [fills](https://open.moomoo.com/api/trading/deal/get-history-deals). Cash-log content was retrieved directly from the official page after the browser-text service timed out.
- Futubull Cloud: [funds](https://open.futunn.com/api/trading/account/get-funds), [positions](https://open.futunn.com/api/trading/account/get-positions), [accounts](https://open.futunn.com/api/trading/account/get-accounts), [cash logs](https://open.futunn.com/api/trading/account/get-cash-logs), [fees](https://open.futunn.com/api/trading/order/get-order-fees). These were checked separately from moomoo's pages.
- OpenD: [funds](https://openapi.futunn.com/futu-api-doc/en/trade/get-funds.html), [positions](https://openapi.futunn.com/futu-api-doc/en/trade/get-position-list.html), [historical orders](https://openapi.futunn.com/futu-api-doc/en/trade/get-history-order-list.html), [historical fills](https://openapi.futunn.com/futu-api-doc/en/trade/get-history-order-fill-list.html), [cash flows](https://openapi.futunn.com/futu-api-doc/en/trade/get-acc-cash-flow.html).
- Webull: [official index](https://developer.webull.com/apis/llms.txt), [API families](https://developer.webull.com/apis/docs/), [balances](https://developer.webull.com/apis/docs/reference/account-balance/), [positions](https://developer.webull.com/apis/docs/reference/account-position/), [cash activity](https://developer.webull.com/apis/docs/reference/trade-cash-activity-by-type/), [transfers](https://developer.webull.com/apis/docs/reference/list-transfer-activities/), [historical orders](https://developer.webull.com/apis/docs/reference/order-history/), [open orders](https://developer.webull.com/apis/docs/reference/order-open/), [detail](https://developer.webull.com/apis/docs/reference/order-detail/). The separately documented Broker API execution resource is not evidence of access through Trading API credentials.

## Validation of this audit

Source inspection and six targeted synthetic mapping cases were completed. Code paths supporting the findings are linked in the review file. No new parser tests, database migrations, live account queries or deployments are part of this documentation round. Documentation link and review-ID consistency checks are required before committing the files.
