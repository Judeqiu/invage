# Report missing datapoints

Tracked gaps between the Lovable Wheel Desk prototype (`https://velovest-ai.lovable.app/`) and Invage / Velovest books. Restyle **does not invent** these values. UI shows an empty state, `—`, or omits the section.

Last updated: 2026-10-01.

| Datapoint | Prototype use | Invage today | Surface treatment | How it could land later |
|---|---|---|---|---|
| Implied volatility (IV) | Column / IV rank vs “levels I usually sell at” | Dashboard derives IV from a usable option mark and underlying quote; IV is **not stored** on `OptionSpec` | Show derived IV in Section 1 when solvable; otherwise `—` with a reason | Persist sourced IV and quote timestamps |
| Prob. ITM / Black-Scholes \(N(d_2)\) | Risk radar, “est.” rows | Dashboard solves zero-rate Black–Scholes IV from the option mark, then estimates finishing ITM probability; no dividend adjustment | Show scored contracts above 30% by default. All open exposes lower-scored and unscored contracts; unscored rows do not enter risk totals | Add synchronized option and underlying quote timestamps and a rate/dividend model |
| “Act now” / 60% bands | `pill-danger` “76% · Act now” | Dashboard bands are modeled P(ITM), not broker-provided risk advice | Show bands only for scored contracts; unscored rows show a reason | Validate and calibrate thresholds against realized outcomes |
| Emotion tags / journal | Insights “which tags cost me” | No emotion field on investor state | Consultant: one empty card. `full`: section omitted | New journal schema (out of visual restyle) |
| Behavioral / win-rate edge | “Your personal edge”, closed-trade learning | No closed-trade statistics on books | Section 04 is **Book statistics** (inventory counts) | Would need fill-to-close pairing beyond IBKR executions |
| Daily net premium on **Dashboard** | Hero “Premium · daily” | Journal `daily[].net_premium` is a **decimal string** on `GET /trades` only | Dashboard KPI is **Premium · open** (`optionsPremiumCollected`). Daily series stays on Trades | Optional dashboard field if we accept a second fetch |
| Fill history (Tiger / MooMoo / Webull) | Open-contract journal | `option_executions` is **IBKR Flex Trades (Executions) only** | Trades journal empty until Flex import/sync | Per-broker execution mappers |
| Underlying last (ITM) | Spot vs strike | Dashboard fetches Yahoo prices for held equities and option underlyings; private / unquoted names may still be missing | Show `No spot quote` and leave probability blank; do not treat as OTM | `underlying_mark` is optional on `OptionSpec` and could be used with an explicit as-of timestamp |
| Incomplete option lots | Full OCC/Futu codes | MooMoo/Webull skip unmapped codes (`not_imported`) | Lots never appear; Brokers lists skipped rows after sync | Root/code map expansion (`option-symbol.ts`) |
| Combo / multi-leg Webull | One row per strategy | Skipped `not_imported` | Not in Positions/Trades | Parser for combo legs |
| Futures / short stock | — | Not imported | Brokers “Not imported” copy | New instrument kinds (data-model change) |
| Lifetime premium vs open book | Premium engine | Open-book `premiumAbsolute` / collected / paid only | Caption says open book, not lifetime | Needs full fill history on every connector |
| Assignment **probability** | Radar | Section 1 models probability of **finishing ITM**, which is only a proxy for assignment likelihood | Label as Prob. ITM; keep unscored contracts out of weighted exposure | Broker exercise and assignment rules plus synchronized marks |
| Broker “live sync forever” | Prototype topbar | Connectors sync on demand | Brokers H1: “Sync on demand.” | Unchanged |

## Honest substitutes already on the books

These **are** fillable without new ingest: NAV, P/L, cash, deposits, channels, option lots + `OptionSpec`, contingent cash/shares, DTE, expiry-month buckets, NAV concentration, covered-call coverage % (when both legs exist), mark/premium received for shorts, ITM vs quote, IBKR execution journal, `connectionMetrics` when recorded, 3-axis analyst-target analysis for equities.

## Related

- Design: `docs/plans/2026-09-21-velovest-report-visual-restyle.md`
- `src/market/types.ts` (`OptionSpec`)
- `src/brokers/option-executions.ts`
- `src/skills/knowledge/options-analysis.md`
