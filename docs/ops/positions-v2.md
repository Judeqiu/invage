# Positions v2

Select **Management → Portfolio dashboard → Positions page version → V2** and
refresh the app. The Positions preference is independent of Dashboard version;
both default to V1 for existing installations. V1 remains available at its
original asset path. V2 is `/domain-assets/invage/positions/v2.html`.

The reference is https://velovest-ai.lovable.app/positions. Both reference tables
have eleven columns; their order and labels are preserved exactly.

| Stock column | Recorded source / calculation |
| --- | --- |
| Ticker | Holding symbol, grouped across the selected broker channels |
| Shares | Sum of recorded long-equity units |
| Avg cost | Converted total cost ÷ shares |
| Total cost | Sum of recorded holding costs in reporting currency |
| Last | Converted market value ÷ shares; quantity-weighted across broker marks |
| Market value | Sum of marked holding values; unavailable if any quote/FX is missing |
| Unrealized P&L | Market value minus total cost |
| Return | Unrealized P&L ÷ total cost |
| % of NAV | Market value ÷ selected-scope NAV; unavailable for incomplete/nonpositive NAV |
| Covered | For each channel: min(shares held, physical short-call delivery), then summed |
| Broker | Distinct contributing channels |

| Assignment column | Recorded source / calculation |
| --- | --- |
| Ticker | Canonical underlying of recorded short options |
| Last | Available underlying quote when its currency agrees with reporting currency |
| Shares held | Recorded long equities for the same underlying and selected scope |
| Put contracts | Positive open short-put quantities |
| Cash if assigned | Gross physical short-put strike obligation, already converted in the dashboard model |
| Call contracts | Positive open short-call quantities |
| Shares if called | Physical short-call deliverable shares; cash-settled calls require zero shares |
| Premium | Reconciled opening gross proceeds attributable to still-open short lots, before fees |
| Open P&L | Recorded marked short-option P&L, in reporting currency |
| Nearest expiry | Minimum calendar DTE against the dashboard valuation date |
| High risk | Number of option rows whose matched-quote Prob. ITM exceeds 60%; missing scores are identified |

Stock rows are alphabetical. Assignment rows sort by gross put obligation,
with unavailable values last. The broker filter applies to **both** sections;
the cash banner and totals use the same scope. Coverage never transfers shares
between brokers. Channels correspond to bound custody accounts. Funds remain
visible in a separate table and do not cover equity calls.

Both pages use the same `webui/option-probability.js` calculation. It requires
validated matching option/underlying quotes; stored marks cannot fill missing
probability inputs. Broker dates more than four calendar days old (or missing)
leave affected assignment, premium, P&L and coverage figures unavailable.
Unscored options are never labeled Clear. Cash-settled and unknown-settlement
contracts do not imply a physical strike purchase/delivery obligation.

V2 uses the private dashboard SSE snapshot/revalidation endpoint. A cached
snapshot renders immediately, valuation continues, and a failed update leaves
the timestamped snapshot visible with Retry. Broker sync or page reload updates the view; the page has no separate Refresh positions button.
Money is never summed across unconverted currencies. Unknown premium remains
unknown, with an explicitly labeled known subtotal; position cost is not used
to fabricate cash-flow history. Book-cost fallbacks cannot produce a current
stock Last, market value or zero P&L.

There is no option-ID column in the current mockup, as confirmed during review.
No new identifier or data/schema migration is needed for this page. Existing
books `accounts.id` UUIDs and option-history episode IDs retain their existing
meanings; broker-native contract IDs remain broker identifiers. No positions,
trade records, identities, quantities or financial journal entries are rewritten.


October 26 feedback update: Positions, Trades and Insights share Proxima Nova
with Arial, Verdana and sans-serif fallbacks, compact headings and broker text
colors (IBKR red, moomoo orange, Tiger yellow, Webull light blue). Positions
removes the introductory valuation line and the general valuation-notes panel.
The shell header scrolls away using the same behavior as Dashboard.
Stock and assignment tables fit at least 15 standard rows in a desktop view
verified at 1440 × 900; smaller screens retain horizontal table scrolling.
Missing premium and unscored-risk badges expose the affected contracts and
reasons through keyboard focus or hover. Missing values remain unavailable.
Lifecycle events without a native contract ID match by account and exact terms;
conflicting IDs, accounts or terms are still rejected.
