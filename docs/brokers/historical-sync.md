# Broker history and sync

`BrokerStatement.history` and `InvestorState.broker_history[channel]` are the shared history contract. History is bound to broker, immutable custody channel and account ID. It contains all returned executions (securities and options), parent orders, order legs, coverage and explicit gaps. Decimal quantities and money stay strings. Missing multipliers, cash, currencies and fees stay null. Historical executions do not change today's cash or holdings and are not automatically realized P/L.

Normal manual and scheduled account sync calls `planBrokerHistorySync`. A position sync's `last_sync.ok` never proves historical completeness. Missing history, partial history or an absent full-history marker requests a full fetch. A complete retained full history permits incremental requests with a two-day overlap. Failed page retrieval or conflicting execution economics does not advance coverage. Duplicate executions merge by account-scoped broker ID; equivalent decimal scales are accepted, unknown metadata/fees can be enriched, and existing records survive subsequent snapshots. The common apply path validates history before books writes and saves history with the investor revision.

Other broker adapters can implement the same optional `fetchRaw(..., {history})` plan and return the same statement history. Existing adapters that do not implement it retain their behavior and acquire no invented completeness marker.

## Moomoo

The Cloud API adapter requests explicit bounds (full requests start at 2000-01-01, rather than the API's default 90-day window), reads every fill/order page for US and HK, and batches parent order details at 50 IDs per request. Parent details include IDs referenced by newly fetched fills, even if the parent was created before the incremental window. Raw responses are archived for source-level queries.

Options include closed contracts and protective long legs independently of current holdings. One exact-contract resolver combines quote metadata, explicit position multipliers and authoritative option parent-leg premium multipliers. Contradictory sources stop the import. Missing expired-contract metadata retains the execution with unknown cash and a retryable gap, while other valid executions and current snapshots can be applied. Missing current-held contract size stops snapshot replacement. Order-detail failures retain partial history and cause a full retry on the next sync. Fees not supplied by these Cloud endpoints remain unknown; gross premium is never labeled net after fees.

Completeness describes the requested data returned by these broker APIs, not a guarantee about records the broker no longer exposes. Historical dividends, transfers and lifecycle events are not inferred from fills or disappearing holdings.

## Agent queries

The data dictionary exposes `broker_executions`, `broker_orders`, `broker_order_legs`, `broker_history_sync`, and `broker_history_gaps`. Always scope joins with broker/channel/account. Execution `clock` supplies the timezone of the retained local timestamp. Inspect coverage and gaps before claiming historical totals. `option_executions` remains the existing common projection of verified option execution cash. The `financial_state` source also exposes the retained shared history; archived raw responses retain fields outside normalized projections.

The operator backfill script `scripts/backfill-moomoo-executions.mjs` uses the same planner, merge and projection. Its default is read-only. `--apply` archives prior execution/history state and updates retained history without replacing cash or holdings.
