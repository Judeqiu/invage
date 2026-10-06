# IBKR Flex

IBKR is catalog connector `ibkr` on skill **broker-integration**. Load that skill. Tools: `configure_ibkr_flex`, `sync_ibkr_flex`, `list_broker_triage`, and the broker-integration parse/apply tools when the Flex XML parser cannot read the statement.

Catalog XML: Open Positions quantity is `quantity` or `position`. Cash Report `BASE_SUMMARY` is booked only via Equity Summary In Base (same `toDate` cash + ISO `currency`); per-currency Cash Report rows still win. Parse failure writes `drive/<slug>/broker-raw/ibkr/<id>/` (`raw.xml` + `case.yaml`).

For performance questions, call `inspect_ibkr_nav_history` for the requested month. It summarizes authenticated archived XML without importing it. `EquitySummaryByReportDateInBase` can contain one `total` NAV mark per report date; the current portfolio ingest drops extra dates, so absence from the dashboard is not evidence that the raw statement lacks daily marks. The standard query may omit deposits and withdrawals. Verify period-boundary NAV, currency, the latest report date, and dated external flows and valuations at flow times (or their verified absence) before computing TWR. A single later mark does not repair missing history. Do not use `list_journal_entries` as a substitute for NAV marks.
