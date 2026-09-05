# IBKR Flex

IBKR is catalog connector `ibkr` on skill **broker-integration**. Load that skill. Tools: `configure_ibkr_flex`, `sync_ibkr_flex`, `list_broker_triage`, and the broker-integration parse/apply tools when the Flex XML parser cannot read the statement.

Catalog XML: Open Positions quantity is `quantity` or `position`. Cash Report `BASE_SUMMARY` is booked only via Equity Summary In Base (same `toDate` cash + ISO `currency`); per-currency Cash Report rows still win. Parse failure writes `drive/<slug>/broker-raw/ibkr/<id>/` (`raw.xml` + `case.yaml`).
