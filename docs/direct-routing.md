# Direct lookups and selective expert routing

Both product profiles use `src/agents/routing-policy.ts`. The host purpose,
message context and scheduled-task guidance follow the same policy.

| Requested outcome | Route |
| --- | --- |
| Existing holdings, trades, dates, balances, quotes, filters or deterministic tool totals | Host read tools; zero expert calls |
| Recommendations, strategy comparisons, risk interpretation, research or planning | Relevant expert only |
| Writes, broker sync/configuration or unresolved reconciliation | Bookkeeper |
| Disputed evidence, material analytical claims or an explicit independent audit | Focused Factchecker audit |
| An explicitly requested installed expert | Requested expert |

Prices, dates and money fields alone never trigger delegation. Missing data,
provider failures and empty results should produce a concise limitation rather
than a consultation loop. At most one focused correction and recheck follows a
failed audit. Routine scheduled lookups also stay direct.

For “TSLA puts opened in the past 30 days, with quotes,” calculate the date
window from the injected server clock, query retained opening executions with
the requested filters, and call `get_option_quotes` for the distinct contracts.
Report all matching rows; use revision-pinned pagination if needed. Match
current positions only when the request requires positions still outstanding.
Do not widen the date range, guess one intended contract, or add unsolicited
payoff/risk analysis.

The host now has `get_portfolio`, `list_option_trades`, `get_quote` and
`get_option_quotes`, alongside its existing structured queries. It does not gain
ledger mutation, broker-sync or options-strategy tools. The option quote tool
shares one chain request per underlying/expiry within a call, returns prices
per underlying share, preserves explicit missing values and per-contract
errors, and does not claim an option quote timestamp when none is supplied.

This is an agent instruction policy with capability boundaries, not a runtime
classifier that disables delegation based on natural-language requests. Expert
tools remain available for valid escalation. Five seconds is a lookup target;
external quote latency and model execution are not bounded by this change.
Production latency and routing compliance require live session measurement.
