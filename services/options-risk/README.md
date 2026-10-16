# Section 01 conditional risk

The management boolean `show_option_risk_model_view` defaults false. Only the
`consultant` product profile advertises the second view. The expiry/assignment
renderer and its quote math are unchanged. Refreshing starts on that view.

This is the initial conditional engine, not completion of every delivery stage in
the design. It prices validated standard 100-share physically settled options,
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
worker at a time, one active job per investor, up to 100 contract positions and 100 pending jobs deployment-wide, a
60-second worker deadline, 2 MiB input/output limits, five-second heartbeats, and
at most one recovery attempt after a worker lease expires. Invalid financial
inputs/model failures are not retried automatically. Browser requests return
queued status promptly. The claimed worker handles the whole portfolio.

## Validated input provider boundary

**Existing Yahoo valuation/probability quotes are insufficient for this engine.**
They do not verify exercise style, deliverables, exact expiry, rate/dividend
provenance or fresh executable quotes. The initial adapter consumes an immutable
snapshot written by an operator-controlled market-data ingestion process, rather
than asserting defaults for those fields. There is no HTTP endpoint accepting
caller-supplied valuations, no automatic conversion of manual marks into verified
inputs, and no commercial feed bundled in this repository.

Write atomically with private permissions to:
`$UTARUS_DATA_ROOT/option-risk/market/<digest>.json`, where `digest` is SHA-256 of
`JSON.stringify(ownerUserUUID)`. See `RiskMarketSnapshot` and
`RiskMarketContract` in `src/risk/types.ts` for the exact schema. A snapshot includes:

- Stable snapshot ID, investor revision, metadata version and capture timestamp.
- One contract entry per portfolio holding key, matching underlying/right/strike,
  multiplier, currency and expiry date.
- Verified American/European exercise, `standard-shares` deliverable,
  `America/New_York` expiry timezone and an offset-qualified expiry timestamp.
- Spot, premium **per contract**, implied volatility as a decimal, annual rate as
  a decimal, and an explicit dividend schedule (empty only when verified empty).
- Actual option/spot quote timestamps, provider source, rate reference and
  dividend reference. Fetch time is not a quote timestamp.

Quotes must be no older than 24 hours and synchronized within 15 minutes. The
oldest used quote determines the displayed as-of time and quote age. Missing,
stale, duplicate or mismatched entries become exclusions; no supported entries
produces a durable `unavailable` result. The recalculate button rereads the
provider snapshot; ingestion must publish a new snapshot for fresher inputs. A
new computation from the same old snapshot remains visibly stale. This adapter
needs an actual licensed provider assessment/integration before live enablement.

The numerical engine uses calendar dates with the NYSE trading-day calendar.
Contracts whose horizon reaches/crosses expiry are excluded because exercise,
settlement and post-delivery lifecycle cash flows are not implemented. Interim
scenarios explicitly condition on no early assignment. Funding branches show
full gross put cash and call shares, without assuming broker collateral netting
or early-assignment probabilities. Cash interest, borrow/transaction costs,
partial assignment paths and close/hedge action comparisons remain unavailable.
No forecast, VaR, ES, probability-of-profit or action-ranking capability is claimed.

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
purged at the next configured queue scan, even while the feature is disabled. `RiskRepository.deleteUser(ownerUUID)`
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
increasing the single-worker pool or enabling this feature. Forecast calibration,
FX aggregation, quoted action comparisons and complete assignment lifecycle
handling remain later delivery stages.

Local fixture benchmark (2026-10-16, this development host): 1 / 25 / 100
European contract positions took 0.090 / 2.186 / 9.280 seconds respectively;
result payloads were 3.5 / 7.2 / 18.6 KB. Maximum 200-vs-400 grid difference was
0.00373 per underlying share. Scenario prices are checked on both grids. These synthetic measurements do not establish
production capacity or validate every instrument. With the feature disabled,
the legacy dashboard adds only a false capability flag and null context; no
model calculation or market-provider request runs in its loading path.
