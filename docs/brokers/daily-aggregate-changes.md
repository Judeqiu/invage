# Daily aggregate changes

Every projection refresh, including every broker sync, persists daily aggregate comparison data with the portfolio read model. Portfolio, individual account and combined broker scopes have separate checkpoints. Both dashboard layouts render these saved differences, with no request-time financial calculation.

Days follow Singapore time (UTC+8). Each successful refresh replaces that day's closing checkpoint; comparisons use the latest saved checkpoint from the immediately preceding calendar day. Multiple syncs today continue to compare with yesterday, including after a process restart. The last 35 calendar checkpoints are retained in the private, atomically replaced user projection file.

The dashboard shows signed absolute changes and relative percentages where the prior value is nonzero. Percentage-valued metrics use percentage-point differences. NAV, cash, positions value/cost, unrealized P/L, deposits, equity totals, open option premiums, assignment obligations, position counts, recorded premiums/fees, realized P/L, portfolio/benchmark indices and saved risk aggregates are included when available. The NAV card expands to list all available daily aggregate comparisons.

Missing days, missing values, incomplete valuations, changed currencies and changed membership of a combined scope suppress comparisons. A new account or broker begins accumulating its own checkpoints automatically. Existing full-portfolio snapshots can supply explicit prior-day values when their currency and account membership match. Older merged snapshots cannot supply account or broker cash history. An unavailable comparison remains absent, rather than appearing as zero.

These are changes in saved aggregate values, not investment returns adjusted for deposits, withdrawals or trades. Daily and MTD premium comparisons compare the respective window totals as calculated for each day; month-boundary resets are included. Version 4 projections are rebuilt by the background worker; broker/account daily comparisons become available after two consecutive Singapore dates have been saved.
