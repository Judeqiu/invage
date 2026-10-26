# Insights v2

Independent management setting: **Insights page version**, default V1. Dashboard, Positions and Trades switches remain independent. Reference: https://velovest-ai.lovable.app/insights.

The page follows all five mockup sections: Today's risks, Book patterns, Recommended actions, Book statistics, Premium and P&L by underlying. The five underlying columns are Underlying, Contract lines, Premium received, Open P&L and Signal. All recorded underlyings are included, rather than only the mockup's eight sample rows. The eight statistics retain the mockup's names. V1's NAV, unrealized P&L, cash, assignment cash, separate broker fund balances and broker filtering remain available.

Calculations reuse the Positions v2 projection and shared matching-quote probability helper. Monetary values use the existing dashboard FX projection. Reconciled remaining short-option opening cash supplies premiums; book cost never substitutes for missing fills. Long option P&L remains included and long purchase debits are not labelled premium received. Rankings require complete comparable P&L for the selected book; unknown contributors are not silently omitted.

High-risk lines have estimated Prob. ITM above 60%. Near-expiry (0–21 days) short positions currently ITM remain highlighted when expiry probability is unavailable but a current underlying price exists, preserving V1's check. Matching quotes and broker dates older than four calendar days are unscored. Prob. ITM is not early-assignment probability. Past-expiry rows are flagged for broker verification, excluded from upcoming 30-day counts and review candidates, and never inferred to be assigned or expired. Risk cards show the first three flagged lines, with the complete flag count and scoring coverage visible.

Assignment cash is the existing gross physical short-put purchase obligation. Cash-settled or uncertain contracts do not invent a physical purchase amount. A comparison against recorded cash does not establish broker margin availability or net out protective long options. Gross marked concentration sums absolute market values by underlying and divides by NAV; it is explicitly different from strike notional or a normalized portfolio weight.

Review candidates require a recent recorded short position, reconciled remaining opening premium, a comparable current closing mark, and at least 50% retained gross premium. Retained fraction = (remaining opening premium − displayed closing cost) / remaining opening premium. Values are before commissions, spread and execution costs; these are review priorities, not trade instructions. Broker links open the corresponding Trades view. No trades are placed and no LLM calls run automatically.

Statistics distinguish option lines from contract quantities. Contracts in profit counts current option rows with positive unrealized P&L, not historical wins. Average DTE is an arithmetic mean of rows; Average premium is per remaining short-option row. LEAP exposure counts contracts beyond 365 days and also states line count. Best contributor must have positive option P&L; Biggest drag must have negative option P&L. Signals describe current P&L and observed risk, not investment success or investor psychology.

Loading uses the same private snapshot/revalidation stream as Dashboard and Positions. Cached data renders immediately, progress remains visible, refresh requests fresh pricing, and failed refreshes retain their last successful snapshot with a retry action. No new database fields, migrations, production model calls, or API endpoints are required. Version settings remain independent.

Verification covers independent configuration, exact columns/statistics, remaining premium, FX and missing-data rules, long/cash-settled positions, filtered cash/NAV, risk coverage, review ranking, UTF-8 cached streams, escaped notes, desktop/mobile layout, horizontal table scrolling, truncated streams and retry behavior.


Both Insights versions provide explicit Explain buttons for aggregate cards. V2 also includes a button on each underlying row without adding a table column. Multi-figure cards offer a figure chooser before starting the conversation. Explanations use the dashboard side-chat protocol and include the displayed values, selected broker scope, snapshot timestamp, broker dates, currency and calculation/coverage notes. Existing conversations reopen without sending another prompt. Failed launches can retry their original immutable snapshot even after broker filtering or refresh. No explanation starts automatically; cancelling the chooser sends no message.


October 26 feedback update: one Explain control in each section header opens a
selector containing that section's figures. Overview, risks, patterns, actions,
statistics and underlying totals all retain their selected broker and snapshot
context. Empty sections offer an explanation of missing figures rather than
reusing a previous broker's data. The older Insights page retains its existing
controls. Risk and action lists now show every qualifying candidate. Typography,
broker text colors, compact headings and scrolling shell behavior are shared
with Positions and Trades.
