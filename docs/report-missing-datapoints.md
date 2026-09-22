# Report missing datapoints

Tracked gaps between the Lovable Wheel Desk prototype (`https://velovest-ai.lovable.app/`) and Invage / Velovest books. Restyle **does not invent** these values. UI shows an empty state, `—`, or omits the section.

Last updated: 2026-09-21.

| Datapoint | Prototype use | Invage today | Surface treatment | How it could land later |
|---|---|---|---|---|
| Implied volatility (IV) | Column / IV rank vs “levels I usually sell at” | Not on `OptionSpec`. `options_insight` may fetch chain IV ephemerally; **not stored** on the user file | Omit column. Never a fake rank | Persist sourced IV on a quote snapshot, with as-of time |
| Prob. ITM / Black-Scholes \(N(d_2)\) | Risk radar, “est.” rows | No probability model. OptionsExpert forbids invented Greeks | Probability-weighted KPI stays `—` / “Not modeled” | Explicit model + stored IV; still not a connector field |
| “Act now” / 60% bands | `pill-danger` “76% · Act now” | Those bands are P(ITM) | Pills are `ITM` / `OTM` / `Unknown quote` / DTE only | Do not add score language without a documented model |
| Emotion tags / journal | Insights “which tags cost me” | No emotion field on investor state | Consultant: one empty card. `full`: section omitted | New journal schema (out of visual restyle) |
| Behavioral / win-rate edge | “Your personal edge”, closed-trade learning | No closed-trade statistics on books | Section 04 is **Book statistics** (inventory counts) | Would need fill-to-close pairing beyond IBKR executions |
| Daily net premium on **Dashboard** | Hero “Premium · daily” | Journal `daily[].net_premium` is a **decimal string** on `GET /trades` only | Dashboard KPI is **Premium · open** (`optionsPremiumCollected`). Daily series stays on Trades | Optional dashboard field if we accept a second fetch |
| Fill history (Tiger / MooMoo / Webull) | Open-contract journal | `option_executions` is **IBKR Flex Trades (Executions) only** | Trades journal empty until Flex import/sync | Per-broker execution mappers |
| Underlying last (ITM) | Spot vs strike | `equityPrices` from Yahoo; private / unquoted names missing | `Unknown quote` pill; do not treat as OTM | `underlying_mark` already optional on `OptionSpec` |
| Incomplete option lots | Full OCC/Futu codes | MooMoo/Webull skip unmapped codes (`not_imported`) | Lots never appear; Brokers lists skipped rows after sync | Root/code map expansion (`option-symbol.ts`) |
| Combo / multi-leg Webull | One row per strategy | Skipped `not_imported` | Not in Positions/Trades | Parser for combo legs |
| Futures / short stock | — | Not imported | Brokers “Not imported” copy | New instrument kinds (data-model change) |
| Lifetime premium vs open book | Premium engine | Open-book `premiumAbsolute` / collected / paid only | Caption says open book, not lifetime | Needs full fill history on every connector |
| Assignment **probability** | Radar | Assignment **size** only (`strike × multiplier × contracts`) | Size is shown; probability is not | Same as Prob. ITM |
| Broker “live sync forever” | Prototype topbar | Connectors sync on demand | Brokers H1: “Sync on demand.” | Unchanged |

## Honest substitutes already on the books

These **are** fillable without new ingest: NAV, P/L, cash, deposits, channels, option lots + `OptionSpec`, contingent cash/shares, DTE, expiry-month buckets, NAV concentration, covered-call coverage % (when both legs exist), mark/premium received for shorts, ITM vs quote, IBKR execution journal, `connectionMetrics` when recorded, 3-axis analyst-target analysis for equities.

## Related

- Design: `docs/plans/2026-09-21-velovest-report-visual-restyle.md`
- `src/market/types.ts` (`OptionSpec`)
- `src/brokers/option-executions.ts`
- `src/skills/knowledge/options-analysis.md`
