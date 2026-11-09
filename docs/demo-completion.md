# Frozen worksheet demo

This workflow is authorized only for the isolated `demo@velovest.ai` account
carrying the existing synthetic-demo flag. It refuses broker connections and
never uses customer broker records. Normal accounts do not activate it, even
if they contain copied completion metadata.

The original workbook remains immutable. A reviewed typed plan identifies each
worksheet row as an opening or a combined roll. No prompt or description keyword
classifier selects behavior. The generator preserves the worksheet contracts,
quantities, currency, date and row cash, and records generated provenance.

Public historical stock bars are captured separately by
`scripts/capture-demo-market.mjs`. Calibration uses the observed workbook span
mirrored before the earliest entry, daily adjusted-close log returns and actual
calendar elapsed time. Every calculation excludes bars after its valuation day.
Historical stock closes and entry-day adjusted closes are sourced values.

Option prices and probabilities are illustrative models, not observed historical
option quotes or implied volatility. The model uses the existing dashboard
probability convention for rate/day count, no dividend adjustment, realized
stock volatility, European Black–Scholes and an intrinsic-value floor. The model
and dates are labeled in the existing dashboard and risk explanations.

Each source row gets a generated earlier completed short-put cycle using prior
observed trading days and the next standard monthly expiry. A source opening
uses its worksheet credit less debit. A source roll uses modeled replacement
opening credit and a closing debit that conserves its original combined cash.
Roll fee allocation conserves the worksheet fee in currency cents; raw Excel
numeric text stays in the workbook record. Generated execution clocks are
explicitly fictional. They do not establish broker execution evidence.

Cash and fictional reserve assets are allocated by current put-assignment
notional with the largest-remainder method. Reserve assets balance the supplied
NAV and have no artificial P&L. They are not backing shares or broker margin.
Initial cash is derived backwards from the final worksheet cash and the complete
generated cash ledger. Daily snapshots then replay those same fills and marks.

Premium cash flow includes option opening and closing cash before fees. Fees are
separate signed cash. Earned premium is FIFO completed-cycle realized P&L after
fees; current positions supply unrealized P&L. Assignment is put settlement at
expiry before premiums/fees. Net risk capital keeps the existing options-only
maximum-loss definition and excludes reserve principal. All use shared engines;
the old workbook headline premium, earnings, assignment and risk overrides are
not used by the completed demo. Empty periods in its complete fictional ledger
have a calculated zero rather than unknown coverage.

`scripts/complete-demo-workbook.mjs` previews by default. Application requires
`--apply`, the complete service environment and the service OS user. It stages
the replacement view before saving, verifies the original workbook checksum,
keeps the previous state/view and market/plan inputs, uses an optimistic revision,
preserves credentials/profile, and compares other active users' financial
digests before and after. Identical source inputs are idempotent. Use a named
ESM launcher, not Node `--input-type`, because wire preparation starts a worker.
