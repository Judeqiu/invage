# Fund identity, classification and query evidence

Fund holdings preserve their broker product name, original broker symbol, ISIN
when established, native contract identity, quote policy, mark, units, currency
and cost. Missing classifications do not erase positions or market values.

`positions` exposes the recorded fund name, symbol, ISIN, product class and issuer
document provenance. `fund_valuations` exposes **all** recorded funds using the
latest valid saved valuation and FX, including non-money-market and unclassified
funds. Its market-value availability is separate from money-market eligibility.
Unknown classifications remain null rather than being guessed from a name.

The stock/cash/money-market formula remains a separate query from dashboard NAV.
An unresolved `channel_asset_values.asset_value` does not imply that dashboard NAV
or the fund's own market value is unavailable.

## Source-backed reference data

`src/funds/reference-data.json` stores reviewed instrument reference facts, not
account holdings. Each entry has a validated ISIN/check digit, share-class
currency, product class, issuer source URL, source-document SHA-256, retrieval
time and classification basis. Optional broker symbol bindings identify the same
instrument through an exact broker/symbol/currency tuple. No name, description,
substring or prompt matching supplies a classification. New verified products
can be added as reference facts without changing adapter/calculation branches.

The initial issuer sources are the Phillip US Dollar Money Market Fund Class A
factsheet and the Fullerton SGD Liquidity Fund Class A factsheet. The latter
explicitly applies the Money Market Funds Investment Guidelines to the fund.
Document digests and exact public share-class identities are stored with the
reference facts. No customer balances or account identifiers are in this data.

Tiger records its full native fund name and contract identity. IBKR retains the
Flex description and reported ISIN/security-ID identity when present. Reference
enrichment can resolve an explicit ISIN from any broker without relying on its
symbol spelling. Unsupported broker fund aggregates remain aggregates, not
fabricated individual positions or money-market holdings.

The shared account snapshot apply path retains recorded classification only
when account channel, currency and exact security identity remain compatible.
It never carries old marks, quantities or costs over newer broker values.
Conflicting identities/classifications require review rather than silently
overwriting evidence.

## Existing-account repair

`scripts/repair-fund-metadata.mjs` previews a repair from retained account-bound
broker archives. It verifies each existing fund's currency, quantity, cost, mark
and quote policy exactly before adding metadata. Apply mode saves through the
normal optimistic PostgreSQL/books path, retains a private recovery artifact,
and publishes metadata projections prepared from saved valuations. Source hashes,
account revision and portfolio fingerprints are rechecked. Newer valid saved
generations are retained. No live broker/market/FX requests are made, and valuation
timestamps, execution journals and daily history are preserved.

The command requires the verified application environment and service OS owner:

```sh
node --import tsx scripts/repair-fund-metadata.mjs <user-uuid>
node --import tsx scripts/repair-fund-metadata.mjs <user-uuid> --apply
```

## MooMoo / Futu Cloud fund retrieval

Cloud snapshots additionally request the read-only, bound-account
`GET /api/v1.0/accounts/{acc_id}/fund_positions` endpoint on the selected broker
host. The archived `fund_positions` section preserves the original response
body, HTTP status, observation time, structured response when parseable, and an
independent `available`/`unavailable` status. HTTP, broker, malformed-response and
transport failures do not prevent ordinary cash, securities or history sync.
A successful explicit `position_list: []` is distinct from an unsupported API.
Existing archives without this section remain readable.

To query these records, select the channel's archived sync through `raw_files`,
then use `source_records` with that file's ID and version. Fund fields are under
`/fund_positions/response/d/position_list`; check `/fund_positions/status` first.
The original body remains available through `fetch_raw_data`, including HTTP
error bodies and exact numeric tokens. This is source evidence, not additional
cash, a new accounting posting or a new current portfolio valuation.

The documented holdings structure includes symbol, short_name, sub_acc_id,
share_holdings, hold_cost and market_value, but does not declare a currency.
Do not infer currency from account reporting currency, market prefix or name,
or infer money-market classification from the product name. These source rows
are not automatically turned into priced portfolio lots or added to
`fund_valuations`/NAV. Account `funds_assets` remains a separate reported aggregate.
Currency, valuation basis and product classification require source-backed facts
before financial aggregation. No currency conversion is applied to raw values.

This retrieval applies to both Cloud hosts. The separate legacy Futu OpenD
transport is unchanged; Cloud documentation does not establish OpenD support.
