# Automatic option risk index

Give Velovest an exact option in chat: “Give me the risk index for
AAPL 2026-11-20 150 PUT.” The host's `get_option_risk_index` tool fetches all
market inputs and returns the calculated index directly. It also accepts an
OCC symbol. No private broker credentials, portfolio, manual prices or equity
input are needed. If no buy/sell side is specified, both scores are returned.

In the chat question library, **Reports → Options with calculated risk indexes**
starts `create_option_index_report` for all recorded open option positions. It
uses recorded sides and quantities, shares public feed requests across strikes,
keeps unsupported/missing-data lots visible, and publishes an owner-scoped HTML
report to the sidebar. It never sums the per-contract indexes into portfolio risk.

The optional `/option-risk` page provides the same contract-only lookup through
`POST /api/domain/invage/option-index`. Management → Agent configuration →
Portfolio dashboard → **Show option risk index page** controls its navigation,
app route and lookup API. The stored key remains `show_option_risk_calculator`;
its existing default/off value is preserved. Refresh after changing it. The
chat tool remains available independently. Page requests require a registered
session and same-origin JSON. The API limits concurrent lookups to four.

The index is **100 × worst nonnegative scenario loss / (spot × 100 shares)**,
for one standard contract. This normalization replaces the old manual form's
account-equity denominator. Do not call it an account-loss percentage or compare
it to older equity-normalized scores. Account impact and ES remain explicitly
null; there is no calibrated probability model. No high/medium/low grades or
0–100 safety scale are implied. Naked-call loss remains unbounded regardless of
its finite grid score.

The shared `model.js` prices a five-calendar-day horizon, capped at actual expiry
(including fractional days). Price shocks are ±30%, ±15%, 0; IV shifts are
±20 percentage points, 0, with IV floored at 1%. American pricing uses a 200-step
Jarrow–Rudd tree with continuous distribution yield. Fixed exit-cost estimates
come from the existing Management fee/slippage settings.

Only exact regular US-listed USD stock/ETF contracts are admitted. Yahoo supplies
last-trade premium, IV, underlying regular-session price, and genuine trade/spot
timestamps. Fetch time does not establish IV freshness. Stale/unsynchronized
quotes and material price/model mismatches are disclosed, not silently repaired.
Dividend yield uses a recent full-year event/price history, with ambiguous dividend/split share bases rejected; it is a trailing proxy, not a forward schedule.
Interest uses the existing FRED DGS1 parser and its recent flat one-year proxy.
Missing/invalid inputs return an error, never invented zero values or a score.
Discrete dividends, adjusted deliverables, exotics, futures/index options,
portfolio offsets, stressed liquidity and actual broker margin are outside scope.

Run `npm run build` and `npm run risk:index:test`. Checks cover numerical pricing,
contract matching, provider/metadata failures, normalization, unbounded exposure,
chat tool, HTTP gates, Management visibility, localization and Chromium UI
behavior. `CHROME_BIN` overrides `/usr/bin/chromium`. Screenshots are written to
`/tmp/velovest-option-index-{desktop,mobile}.png`.
