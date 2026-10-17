# Section 01 conditional risk

The management boolean `show_option_risk_model_view` defaults false. Only the
`consultant` product profile advertises the second view. The expiry/assignment
renderer and its quote math are unchanged. Refreshing starts on that view.

The conditional engine prices validated standard 100-share physically settled options,
including American exercise and explicit discrete dividends, using QuantLib 1.40.
It provides signed stress P/L, numerical Greeks, account-specific gross assignment
branches, and exact standalone expiry payoff bounds for legs grouped by account,
currency, underlying and expiry. Aggregate P/L requires a single currency. Missing
cash remains unknown. All related shares contribute to scenario P/L; calls are covered only by free shares in the same account
and underlying. Long and short option quantities are counted in absolute units.

## Runtime preparation

No infrastructure is changed automatically by the application or migration.
Prepare the virtual environment and database as part of an authorized deployment:

```sh
python3 -m venv /opt/invage-risk-venv
/opt/invage-risk-venv/bin/pip install -r services/options-risk/requirements.txt
npm run risk:migrate
```

Set `INVAGE_OPTION_RISK_PYTHON` to that environment's Python, and set a random
`INVAGE_OPTION_RISK_CONTEXT_SECRET` with at least 32 bytes of entropy. Store it
like other deployment secrets. Changing it invalidates dashboard contexts. The
queue uses `INVAGE_BOOKS_DATABASE_URL`, with a dedicated `option_risk_jobs` table;
financial records and dashboard caches are not used for storage. The DB service
role needs DML on this table; run migrations separately with a schema-owner role.
Keep the database private, as with books. Inputs/results are private portfolio
records. Queries constrain owner UUID; the numerical worker never gets credentials.

The server starts a two-second queue scan without putting numerical work on the
Express event loop. PostgreSQL leases and a deployment-wide claim lock allow one
worker at a time, one active job per investor, and up to 100 pending jobs
deployment-wide. There is no portfolio position-count cap. Provider quote
requests are batched without truncating the portfolio. Collection has a six-minute
deadline with paced requests and expiry-range metadata queries, followed by a 60-second numerical worker deadline. Workers retain
32 MiB input and 2 MiB output limits, five-second heartbeats, and at most one recovery
attempt after a worker lease expires. Invalid financial
inputs/model failures are not retried automatically. Browser requests return
queued status promptly. The claimed worker handles the whole portfolio.

## Validated input provider boundary

Live recalculation now uses the investor's enabled Futubull/Moomoo Cloud connection
for all selected custodian accounts, including Tiger and IBKR holdings. Requests
use the existing signed, read-only quote API. No connection from another investor
is used. Trading endpoints are rejected before credentials are sent. Collection
runs inside the leased queue, with bounded response sizes and timeouts; the HTTP
submission returns immediately. The collected inputs are frozen using the active
lease before the isolated QuantLib worker receives them. The worker never receives
broker credentials or network access.

The connected adapter admits standard USD, 100-share,
physically settled US stock and ETF options. It verifies exact underlying, strike,
right and expiry against the option chain, STANDARD deliverables, and American
exercise against the quote metadata. Adjusted contracts still require a deliverable-aware model.
It pairs option last trades with regular-session underlying prices using actual
`stock-quote.data_time` values; overnight snapshot update times are not substituted.
Quote age and synchronization no longer exclude positions. Actual timestamps and
ages remain visible. Valuation uses the current calculation date even when quotes
are older. These are indicative conditional inputs, not executable bid/ask offers.

The rate source is the Federal Reserve's DGS1 series published through FRED. The
latest observation at or before the quote date must be within seven days. Its
one-year investment-basis Treasury yield is converted from semiannual to continuous
compounding and used as an explicitly disclosed **flat one-year proxy**, rather
than a maturity-matched zero curve. Failure never becomes a zero rate.

Dividend-paying stocks and ETFs are included. Announced future cash distributions
are used when present; otherwise the reported TTM cash distribution amount divided
by spot supplies an explicitly estimated continuous annual distribution yield.
This trailing proxy is not a verified future cash schedule. The engine uses that
yield for option pricing and a simple yield-times-spot-times-years estimate for
related-share cash distributions; it does not double-count announced cash amounts.
Missing distribution amounts and schedules remain missing. Exact contract terms,
finite prices, IVs and genuine timestamps remain required.

Recalculate collects fresh inputs. A private atomic snapshot is also saved at
`$UTARUS_DATA_ROOT/option-risk/market/<digest>.json`, where `digest` is SHA-256 of
`JSON.stringify(ownerUserUUID)`. See `RiskMarketSnapshot` and `RiskMarketContract`
in `src/risk/types.ts`. Snapshot entries bind the investor revision, metadata
version, actual quote timestamps, verified terms, premium **per contract**, decimal
IV/rate and dividend provenance. Existing validated operator snapshots can still
be used if a connected refresh yields no usable contracts. Missing data is never
filled with manual marks or Yahoo probability estimates.

Provider references: [Futu quote API](https://open.futunn.com/api/quote/realtime/stock-quote),
[option chain](https://open.futunn.com/api/quote/derivatives/option-chain),
[dividends](https://open.futunn.com/api/quote/corporate-actions/dividends),
[FRED DGS1](https://fred.stlouisfed.org/series/DGS1), and
[OCC equity option specifications](https://www.theocc.com/clearance-and-settlement/clearing/equity-options-product-specifications).

The numerical engine uses calendar dates with the NYSE trading-day calendar.
Contracts whose horizon reaches/crosses expiry are included at intrinsic value.
The full scenario spot shock is assumed to occur by expiry; the cash-equivalent
intrinsic proceeds remain unchanged until the selected horizon. Post-expiry
delivery shares are not retained. Interim scenarios condition on no early assignment. Funding branches show
full gross put cash and call shares, without assuming broker collateral netting
or early-assignment probabilities. Cash interest, borrow costs and partial assignment paths remain excluded. Forecasts and read-only comparisons have the separate evidence requirements below.

### Connected-broker assessment (16 October 2026)

The existing Futubull Cloud connection returned real US stock/option quotes,
standard option-chain terms and dividend histories in read-only production probes.
Tiger's read-only permission query, after supplying the required device identifier,
returned no quote permissions. No primary-device permission was transferred.
The existing IBKR connection is Flex statement reporting, which does not supply
TWS/Gateway live option inputs. Futubull can price this investor's compatible
positions held at these other custodians without moving holdings or changing
broker configuration.

When no positions have usable model inputs, the dashboard shows a single input
readiness panel and recorded position/contract counts. It omits empty metric cards,
tables and discussion controls. Rechecking data never invents missing inputs or
creates a new provider connection. Model details and exact exclusions remain in the
coverage disclosure. When inputs are usable, results are grouped into scenario,
funding, payoff and exposure sections; unsupported probability/action analytics
are explained together rather than displayed as empty KPIs.

## Access, lifecycle and retention

All APIs use the framework's trusted registered session loader. Submission also
requires same-origin JSON. Configuration writes use the existing admin-only
management router; no alternate write endpoint is added. Job/result retrieval
rechecks effective configuration. Read-only discussion retrieval binds ownership
to the trusted web run, with no model-supplied owner ID; incognito conversations
are refused. The dashboard operates on registered persisted portfolios and has
no incognito/session-only portfolio mode; anonymous/private session identities
cannot submit jobs through this API.

A 30-day TTL applies to immutable inputs/results, checked on every read and
purged at the next configured queue scan, even while the feature is disabled. Latest
market snapshots receive the same TTL (hourly cleanup) and explicit user deletion. `RiskRepository.deleteUser(ownerUUID)`
provides explicit deletion of that user's risk corpus. It must also be wired to
any deployment-specific account erasure procedure (the user-state and books
stores are separate databases). Do not delete only the financial state and leave
risk records behind. Queued jobs are cancelled after feature disablement; a
running worker can finish but no result is served while disabled.

The browser fetches lazily, polls only in the visible risk panel, drops obsolete
account/date responses, retains old results marked stale during recalculation,
and checks capabilities every 60 seconds while visible and on focus. A loaded
page that was originally disabled receives the flag on refresh; originally
enabled pages can observe disable/re-enable through capability checks. Historical
views retrieve only a matching saved result for the authorized revision/date;
they never submit live work. Saved/static reports do not run private analyses.

Rollback: disable the boolean. No accounting state needs rollback. Model-version
changes invalidate analysis contexts; result readers must explicitly reject
versions they no longer support.

## Verification

```sh
npm run build
# Invoke this checkout's runner if npm/npx resolves a different installation:
INVAGE_OPTION_RISK_PYTHON=/opt/invage-risk-venv/bin/python \
  node node_modules/vitest/vitest.mjs run tests/option-risk*.test.ts \
  tests/option-probability-quotes.test.ts tests/dashboard-views.test.ts \
  tests/dashboard-progress-api.test.ts
/opt/invage-risk-venv/bin/python -m unittest discover \
  -s services/options-risk -p 'test_*.py'
```

Queue integration tests require `UTARUS_TEST_DATABASE_URL` explicitly naming the
isolated `utarus_test_admin` database. The helper creates/drops disposable DBs;
never point tests at an application DB. Benchmark the actual deployment before
increasing the single-worker pool or enabling this feature. FX aggregation and complete assignment lifecycle handling remain unavailable.

Local fixture benchmark (2026-10-16, this development host): 1 / 25 / 100
European contract positions took 0.090 / 2.186 / 9.280 seconds respectively;
result payloads were 3.5 / 7.2 / 18.6 KB. Maximum 200-vs-400 grid difference was
0.00373 per underlying share. Scenario prices are checked on both grids. These synthetic measurements do not establish
production capacity or validate every instrument. With the feature disabled,
the legacy dashboard adds only a false capability flag and null context; no
model calculation or market-provider request runs in its loading path.

## Physical forecasts and read-only comparisons

The v4 worker collects completed daily underlying closes and exact-contract
observed implied volatility from the same investor-owned Cloud connection.
Historical requests are unadjusted daily bars, paginated backward across up to
five years; missing IV is never interpolated from stock volatility. A synchronized
contiguous NYSE trading-date intersection is required. Unresolved stock price
jumps above 50% invalidate forecasts rather than truncating tails. This guard is
not a complete corporate-action adjustment service. Short-lived option contracts
will often have insufficient history. A separate licensed historical IV surface
provider would be needed for broader practical coverage.

Joint filtered historical simulation uses EWMA lambda 0.94 and synchronized
five-day residual blocks, zero log drift, a deterministic context-derived seed,
and 8,192 paths. No forecast probability is attached to a conditional shock.
Forecast qualification requires at least 252 daily pairs and 126 training returns
plus 60 non-overlapping horizon outcomes: 40 validation and 20 final holdout
origins. Each origin fits only its past. Fixed checks cover 50/80/95% interval
coverage, 95% VaR exceedances/clustering, a joint VaR/ES identification moment,
and an unfiltered historical challenger. Rejection thresholds are 1% for coverage
and independence diagnostics and 2.58 for the tail moment, with a challenger
comparison. These are risk-factor and equal-weight factor-basket checks, **not
validation of historical trading-strategy returns or every portfolio tail**.
The final holdout is never used to fit or select parameters. Passing a diagnostic
is not a statistical guarantee. The validation report is stored with the result.

Each joint path reprices the options and related shares; ES is computed from the
aggregate currency loss distribution, never by adding standalone ES. American
and discrete-dividend prices use a checked finite-difference correction grid,
refined through 5/9/17 points per dimension, with direct 400-grid checks at
stratified/tail points (0.5% relative price tolerance). Failure suppresses the
forecast only. Expiries settle at their simulated expiry spot into cash-equivalent
proceeds; early assignment remains excluded. The 95% ES sampling interval uses
128 percentile bootstrap resamples of simulated paths; it measures Monte Carlo
error only, not parameter/model uncertainty. A width above max($1, 50% of absolute
ES) suppresses publication. Forecast coverage is distinct from stress coverage;
headline ES requires complete priced-scope coverage in a single currency.

Comparisons show hold and each individual close, plus a nearest further-OTM
same-expiry long option for shorts when verified terms and indicative bid/ask
are available. Quotes come from exact single-leg combo quotes, in batches of 20;
this endpoint supplies no exchange timestamp, so collection time and that
limitation are explicit. Displayed depth and account-specific cash are checked
independently; unknown cash/depth is never treated as sufficient. These are
read-only analysis candidates, not orders or guaranteed executable combinations.

Management exposes estimated USD fee per contract (default 0.65), minimum fee
per order (1.00), and adverse slippage (25 basis points beyond bid/ask). These
are generic configurable assumptions, not verified broker charges. Changes
invalidate the analysis context. All comparisons use terminal **marked wealth**,
with initial execution fees/slippage charged once, without future liquidation,
settlement fees, interest, borrow costs, or reuse of historical entry cost basis.
Close removes the selected leg's terminal wealth and records its cash flow once;
hedge adds its terminal value and deducts entry cost once. Comparisons retain
related shares. They are per-leg changes to the covered currency portfolio,
not optimized multi-leg strategies. Probabilistic close comparisons reuse exactly
the hold paths and require full currency coverage. Hedge probabilistic comparisons join the same calibrated paths only when exact
hedge-IV history covers every held-portfolio date; otherwise hedge ES remains
unavailable and is never assigned zero. Costs are explicitly estimated throughout the UI and discussion.

References: [Cloud historical bars](https://open.moomoo.com/api/quote/basic-data/history-kline)
and [Cloud indicative combo quotes](https://open.moomoo.com/api/quote/derivatives/combo-option-quote).

## Standalone report in chat

Users can ask “Create my Risk & scenarios report” or “Create a 21-day risk report
for my IBKR account.” The host and OptionsExpert expose
`create_option_risk_report`, using the same feature gate, runtime, owner-scoped
repository, connected market collection and numerical worker as Section 01.
No dashboard visit is required. Default scope is all accounts and five trading
days; optional `account_ids` and `horizon_trading_days` select the scope.

The tool queues a fresh analysis and waits briefly for completion. A pending
response supplies `result_id`; subsequent calls with that ID resume waiting and
publish when complete. Existing dashboard result IDs can also be exported.
Saved-result calls must not supply a different horizon or accounts. Failed jobs,
missing results and unsupported engine versions do not produce report links.

Completed results are rendered as a static, self-contained HTML report with
scenario P/L by currency, exposures, assignment funding, payoff bounds, physical
forecast availability and validation, action comparisons, assumptions and source
evidence. Missing inputs remain explicit; old prices and changed portfolio
revisions are flagged. Reports are snapshots, not a live dashboard.

Publishing uses Utarus `publishReportHtml`, which saves the private BinDrive file
and registers a Web run HTML asset for the existing sidebar. The agent includes
the durable authenticated session URL as a Markdown link; signed links remain
available for other channels. Incognito runs cannot persist reports. Runtime
also needs `UTARUS_REPORTS_URL`, as for other Utarus reports. This feature adds no
trading or ledger writes and needs no new database migration.
