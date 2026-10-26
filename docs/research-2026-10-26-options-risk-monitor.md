# Options risk monitor: research and implementation decisions

Research date: 26 October 2026. Scope: the personal, opt-in `/account-risk` page in Velovest. The separate contract risk-index calculator and dashboard scenario engine are different products.

## Product conclusion

The page should answer three questions at a glance: what needs attention, how much is involved, and what should the investor verify next? A single risk score obscures different mechanisms. Prioritize broker margin pressure, immediate expiry deadlines, settlement funding, share delivery and concentration. Attach an amount or date, an action, and expandable evidence to each finding.

Current inputs are saved account holdings, cash, broker metrics and reporting FX. They support structural warnings, not a live portfolio loss forecast. Price stress, dividend events and exit liquidity remain explicitly unassessed. A positive cash balance or absence of alerts cannot establish safety.

## Research findings

### Assignment and the spread trap

An American-style short option may be assigned before expiration. Assignment is an obligation to buy or deliver the underlying, not simply a mark-to-market loss. A protective option can bound an economic payoff without automatically satisfying another leg's assignment: the investor may need to exercise or close it separately. Therefore, do not infer cash sufficiency from the spread's maximum loss, and do not label a gross cash gap a margin call. Source: [FINRA and OCC, Understanding Assignment](https://www.finra.org/investors/insights/trading-options-understanding-assignment).

OIC further explains that assignment timing cannot be predicted reliably; owning a covered position does not prevent assignment. Early assignment deserves monitoring throughout the contract's life. Dividend-related assignment requires product-specific evidence rather than a blanket expiration-only alert. Source: [OIC, Options Assignment](https://www.optionseducation.org/referencelibrary/faq/options-assignment).

Implementation: show gross physical-put purchases and their difference from cash in the same account. Show physical short-call delivery requirements without inferring an uncovered call from absent share matching. Keep protective-leg assumptions in the evidence.

### Nonlinear price exposure near expiry

Gamma describes how delta changes as the underlying moves. Short options have negative gamma; at-the-money contracts close to expiry can experience rapid changes in directional exposure. A low option premium or a small current delta is insufficient evidence of low risk. Source: [OIC, Gamma](https://www.optionseducation.org/advancedconcepts/gamma).

Implementation: escalate options expiring today or tomorrow above ordinary structural findings, below a nonpositive reported margin cushion. This is deadline triage, not a measured gamma warning. A genuine gamma alert needs synchronized underlying prices, contract terms and validated Greeks. Do not treat all expiring options as at the money.

### Exercise and settlement are operational risks

Exercise styles and last trading days vary by product. Brokers may set exercise cutoffs earlier than exchange cutoffs. Calendar expiry alone cannot identify the investor's final decision time. Source: [OIC, Options Exercise](https://www.optionseducation.org/referencelibrary/faq/options-exercise).

Implementation: show long and short positions in a 14-calendar-day settlement watch using the New York date. Long-option holders also need a decision: the option can expire worthless, or exercise can create stock or cash exposure. Ask the investor to verify broker deadlines rather than inventing a universal cutoff.

### Premium, time and volatility

A long option can lose its entire premium. An unhedged short call can have unbounded loss. Premium reflects intrinsic value and time value; volatility, dividends, interest and time can change its value even without the desired underlying move. Source: [OIC, Leverage & Risk](https://www.optionseducation.org/optionsoverview/leverage-risk).

Theta is a conditional sensitivity to time, not a promised daily return. Source: [OIC, Theta](https://www.optionseducation.org/advancedconcepts/theta). Vega measures sensitivity to implied volatility; longer-dated options typically have more vega. Source: [OIC, Vega](https://www.optionseducation.org/advancedconcepts/vega).

Future implementation: reprice supported structures jointly for spot, IV and time shocks. Show option-only and combined shares-plus-options P/L distinctly. A tested scenario loss is neither maximum possible loss nor a calibrated probability. Do not sum standalone contract risk indexes into account risk.

### Liquidity and exit costs

The bid/ask spread, displayed size and order type affect execution. Wide spreads can increase slippage; the last trade or midpoint is not a guaranteed closing price. Source: [OIC, Understanding Bid and Ask Prices](https://www.optionseducation.org/news/understanding-the-bid-and-ask-prices-for-options).

Implementation: exit liquidity is explicitly unassessed. Next stage requires timestamped bid/ask, displayed size and contract quantity, plus contract fee estimates. A rolling transaction closes one exposure and opens another; it does not erase a realized loss. Do not recommend a roll from funding arithmetic alone.

### Margin and liquidation

The broker's actual margin rules, collateral eligibility and requirements govern capacity. Cash and NAV cannot substitute for broker margin measures. Brokers may liquidate without advance contact and may raise house requirements. Source: [FINRA Rule 2264, Margin Disclosure Statement](https://www.finra.org/rules-guidance/rulebooks/finra-rules/2264).

Implementation: allow signed excess liquidity through snapshot validation so a reported deficit reaches the monitor. Nonpositive broker-reported excess liquidity is the highest-priority structural warning. Zero buying power means verify capacity, not necessarily imminent liquidation. Do not invent a cushion percentage from NAV or calculate a liquidation price without the broker's margin model.

### Concentration and data uncertainty

Our design inference: aggregating physical-put strike obligations by underlying reveals repeated purchase exposure across strikes and expiries. It is not a measure of delta, portfolio volatility or correlation. The 50% concentration threshold is a product triage rule, not a regulatory or statistically calibrated boundary. A second account does not automatically supply collateral to the first.

Saved snapshots can be obsolete during intraday markets. The existing four-calendar-day freshness gate is retained for structural findings; it does not establish real-time freshness. Display snapshot dates and missing assessments, suppress current findings for stale or future-dated inputs, and withhold complete totals when import or FX data is incomplete.

The governing disclosure reference is [OCC's current Options Disclosure Document landing page](https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document), which should be consulted for contract-specific risks and amendments.

## Implemented hierarchy

1. Compact account headline and the next action.
2. Excess liquidity, all-assigned put cash gap, nearest option expiry.
3. Ranked alerts with an amount/date, one action and expandable evidence.
4. Long/short settlement watch and assessment coverage.
5. Account comparison; optional cash illustration and methodology collapsed.

Fresh holdings are required for structural alerts. A cash gap is `max(0, gross physical-put purchases - recorded cash)`, with complete currency conversion; it excludes hedge offsets and is not required margin. Call delivery is gross contracts × recorded multiplier, not verified deliverable coverage. Invalid dates and contract sizes must not produce fabricated deadlines or quantities.

## Next data-dependent work

Connect the existing scenario engine to this workspace only after account scope, holdings revision, currencies and quote timestamps agree. Then add conditional full repricing, validated structure payoff bounds, broker margin previews, event calendars and executable closing quotes. Each capability needs its own coverage status. Forecast probabilities and VaR/ES require separate historical and calibration validation; they should never be inferred from the current deadline and funding checks.
