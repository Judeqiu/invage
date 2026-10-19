# Standalone option risk calculator

Velovest navigation: **Option risk**, app route `/option-risk`.
The iframe uses `index.html`, `app.js` and the pure browser-native `model.js`.
There are no new endpoints, saved records, credentials or service dependencies.

The user supplies current per-share option premium, underlying price, strike,
calendar days remaining, IV, rate, continuous dividend yield, side, exercise
style, quantity, multiplier, account equity and a fixed total exit-cost estimate.
The score is worst nonnegative grid loss / equity × 100; it can exceed 100.
The grid is five symmetric underlying shocks × three IV shocks after the effective
calendar-day horizon, capped at expiry. IV is floored at 1%. Scenario values are
compared directly with the entered quote; a quote/model deviation above 10%
shows a warning. Scores depend on the chosen grid, and are not comparable across
different assumptions without adjustment.

European pricing uses Black–Scholes; American pricing is a 200-step equal-
probability Jarrow–Rudd tree with a European value floor. These are indicative
vanilla-option models, separate from the connected portfolio QuantLib worker.
No calibrated probability distribution is available, so ES is explicitly null.
Expiry loss bounds exclude subsequent stock exposure. Short-put gross delivery
cash and uncovered-call shares are displayed separately; no broker margin or
cash-sufficiency estimate is inferred. Discrete dividends, adjusted contracts,
futures options, portfolio offsets and stressed liquidity are outside scope.

Run `npm run risk:index:test` for numerical reference/payoff/scaling checks and
an actual Chromium desktop/mobile interaction check. Set `CHROME_BIN` if Chromium
is installed somewhere other than `/usr/bin/chromium`. The browser check writes
preview screenshots to `/tmp/velovest-option-risk-{desktop,mobile}.png`.
Run `npm run build` to validate the WebUI extension integration.
