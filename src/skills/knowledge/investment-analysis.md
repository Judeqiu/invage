# Investment Analysis

**Invester agent skill** for evaluating stocks, **options (calls/puts)**, and portfolio positions across **US, Hong Kong, and China** markets. Combines:

1. **Portfolio 3-axis** — cost basis vs live price vs analyst targets (action on holdings)
2. **Stock evaluation workflow** — fundamentals, valuation, style filters, risks (analyze any ticker)
3. **Undervalued discovery funnel** — find candidates that are *cheap ∩ quality/health ∩ not a trap* (idea generation)
4. **News → price-path analysis** — smart trend/hypothesis from news (underreaction vs overreaction, PEAD, surprise vs consensus)
5. **Index relative framework** — evaluate names vs a wide range of market / sector / style / regional indices (Part E)
6. **Multi-market equities** — US + HK + China A/H dual listings, ticker conventions, local sources (Part F)
7. **Options evaluation** — calls/puts structure, moneyness, IV, Greeks *when sourced*, strategy gates (Part G)

Load for portfolio analysis, stock evaluation, **options / call / put analysis**, **finding undervalued stocks**, **HK/China listings**, **index-relative value**, **news impact / trend after news**, earnings reaction, screens, value traps, P/E·PEG·ROE·P/B, analyst targets, buy/sell/hold, DCF/multiples, moat/value/growth, or "what should I do with my stocks".

For news/filings/IR/key-statistics/Finviz/HKEX/China sources and options-chain pages, also load **`firecrawl`**. For saving reports, use **`bindrive`**.

Background research (human reference): `docs/deep-research-find-undervalued-stocks.md`, `docs/deep-research-news-stock-price-prediction.md`, `docs/deep-research-stock-analysis-methods.md`.

---

## Investment Playbook (per-user methodology)

Every linked user has an **Investment Playbook** (strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, watchlists). It is injected into message context and applied by `portfolio_analyzer` when analyzing a saved portfolio.

| Axis | Options | How it guides you |
|------|---------|-------------------|
| **Strategy** | `growth` · `income` · `capital_preservation` | What outcome to optimize (appreciation vs yield vs drawdown control) |
| **Philosophy** | `value_investing` · `growth_investing` · `dividend_investing` | Which cheapness/quality lenses and PE/PEG bars to emphasize |
| **Risk** | `conservative` · `balanced` · `aggressive` | Buy upside bar, take-profit speed, deep-loss SELL, sizing aggressiveness |
| **Allocation** | max position % · cash target % · max sector % | Cap suggested size; flag concentration breaches |
| **Buy / sell rules** | free-text criteria + AI style | Hard constraints on when BUY/SELL language is allowed |
| **Rebalancing** | `monthly` · `quarterly` · `threshold` | When to suggest rebalance / drift checks |
| **Watchlists** | markets · sectors · themes | Default discovery universe when no ticker is named |

**Defaults:** if the user never configured a playbook, use the **balanced market-standard** defaults (value philosophy, balanced risk, 10% max position, 35% max sector, quarterly rebalance, US markets). Do **not** interview them unsolicited — just apply defaults. Tools: `get_playbook`, `update_playbook`.

**Guided setup:** when the user *asks* to configure methodology / risk / playbook, load **`playbook-setup`** and run the patient one-question-at-a-time wizard (this is the only preference questionnaire allowed).

### Playbook → recommendation rules

1. **Always filter trade language through buy_criteria / sell_criteria** and risk profile before saying BUY/SELL/accumulate.
2. **Size suggestions** as % of portfolio; never propose a single name above `position_limit_pct` or a sector above `sector_exposure_pct` without explicitly flagging the breach.
3. **Philosophy tilt:**
   - *value* — cheapness yardstick + trap gate required; Street upside alone is not BUY
   - *growth* — PEG/growth/margins can justify higher multiples; trap gate still required
   - *dividend* — yield + coverage/sustainability; avoid yield traps
4. **Strategy tilt:** income → prefer durable payout; growth → trajectory; capital_preservation → quality/defensive, avoid speculative accumulate.
5. **Risk tilt:** conservative raises the bar (more WATCH, earlier take-profit); aggressive lowers upside bar and allows sizing toward the cap when gates pass.
6. **Watchlists:** for undervalued/theme discovery with no ticker named, prefer configured markets/sectors/themes before a generic screen.
7. **Rebalancing:** if mode is calendar or threshold drift, mention when holdings look out of band vs cash target or concentration limits.
8. Changing playbook only when the user asks (e.g. "set me to conservative value") — use `update_playbook`, confirm the new summary.

## Hard rules

### Fact grounding (highest priority)

- **Tool-before-claim.** Do not write market/company facts until tools have returned in this turn (or the same conversation with still-valid data).
- **Every sentence in the final reply** is either: (A) grounded in tool/scrape/analyzer output, (B) process/method, or (C) explicitly labeled hypothesis/opinion. Delete anything else before sending.
- **Fail fast — never invent:** prices, PE/PEG/ROE/P/B/FCF/EV, F-Scores, targets, **IPO/S-1/listing status**, "reserved ticker", grey market, open/close, volumes, private-vs-public status, filing dates, roadshow claims.
- If \`portfolio_analyzer\` fails or returns no real quote for a ticker, say **not tradable / not verified** — do **not** invent an IPO story to explain it.
- On user pushback ("that's wrong"): **re-run tools**, then correct from evidence. Never elaborate an ungrounded story.
- Prefer: short answer with citations over a long fluent answer with unchecked claims.

### Analysis rules

- **No unsolicited profile / setup questions.** Never ask display name, email, watchlist-as-prerequisite, "do you have holdings?", or process menus (Option A/B) for research jobs. Channel identity and portfolio come from tools/context. **Exception:** user-initiated playbook config → load **`playbook-setup`** (one easy question per turn).
- **Query clarifications only.** Ask at most one short question only when the *research query* is incomplete (e.g. "analyze this stock" with no ticker; two companies mentioned without specifying which). If the ask is clear, execute with tools this turn — no interview.
- **Execute, don't menu.** Never present "Option A / Option B", "give me a watchlist or I screen", or "which direction?". Pick a default path + tools **this turn**.
- **Empty portfolio is not a blocker** for discovery/research asks — run **Recipe 3** (external Finviz/Yahoo value screen) or theme research immediately. Never stall to collect profile data.
- Never give buy/sell without showing underlying numbers (targets and/or metrics from tools).
- Always show **median and high** analyst targets when available.
- Flag any holding with **>30% unrealized loss** as high risk.
- Do not recommend averaging down without fundamentals (PE, ROE, quality) supporting it.
- Prefer a **valuation range** over a single magic price.
- Industry model first — do not force one multiple or DCF on every sector.
- **Price drop ≠ undervalued.** Cheapness needs a yardstick (earnings, cash flow, assets, peers) and a quality/trap check.
- Do not call a stock a "buy" on Street upside alone — run the undervalued / trap gates when the user wants undervaluation or accumulation.
- **Headline ≠ next-tick prediction.** Never claim guaranteed short-term direction from a headline. Use Part D: surprise, horizon, under/overreaction hypothesis, then fundamentals gate.
- Do not recommend chasing mega-cap first-print spikes (analytics/HFT usually already moved the quote). Prefer post-call / multi-day–multi-week paths when evidence supports underreaction.
- Web facts need Firecrawl URLs; portfolio math needs portfolio/analyzer tools.

---

## Tools (which when)

| Need | Tool |
|------|------|
| Holdings, cost, units | `get_portfolio` |
| Strategy / risk / buy-sell methodology | `get_playbook` / `update_playbook` |
| Live price, P/L, PE/PEG/ROE/P/B, analyst targets | `portfolio_analyzer` (Yahoo Finance; uses playbook thresholds for channel users) |
| EV/EBIT, FCF, enterprise value, detailed stats | Load **`firecrawl`** → Yahoo `/key-statistics`, Finviz quote |
| News, earnings, filings, IR, "why it moved", news→trend | Load **`firecrawl`** → search/scrape primary + 1 quality secondary; then Part D |
| Multi-name screens / idea lists | Firecrawl Finviz/Yahoo screeners or peer scrapes — then `portfolio_analyzer` on short list |
| Macro (Fed, CPI, PBOC, HKD peg context) | Firecrawl → official + Reuters / BLS / HKMA when relevant |
| Index levels / regional benchmarks | `portfolio_analyzer` with index or ETF tickers (Part E table); Firecrawl if quote fails |
| HK / China A-share / dual listing | Yahoo suffix tickers via `portfolio_analyzer` (Part F); Firecrawl → HKEX / SSE / CNINFO / IR |
| Options chain, IV, open interest | Firecrawl Yahoo options page (Part G) — **not** invent Greeks; analyzer is for underlying first |

### Metrics available from `portfolio_analyzer` (always try first)

| Field | Use in value work |
|-------|-------------------|
| Price, short name, sector | Context |
| Trailing PE, forward PE | Earnings cheapness (sector-relative) |
| PEG | GARP / growth-adjusted cheapness |
| Price-to-book | Asset cheapness (banks, asset-heavy; weak for software) |
| ROE, ROA, operating/gross/profit margins | Quality / profitability |
| FCF yield, earnings yield, FCF yield on EV | Cash / earnings cheapness (derived when inputs exist) |
| EV/EBITDA (`enterpriseToEbitda`), EBITDA, free/operating cash flow | Operating value (non-financials) |
| Market cap, enterprise value, total cash/debt, D/E, current ratio | Size, leverage |
| Revenue / earnings growth | Trajectory / trap flags |
| Analyst median / mean / high | Street re-rating range (not intrinsic value) |
| **Value screen block** | Tool-computed `cheapness` / `quality` / `trapRisk` + signal lines — use as Part C starting point |

**Still via Firecrawl when needed:** full Piotroski F-Score, NCAV, peer tables, 10-K narrative, ROIC if not on Yahoo, exact EBIT (vs EBITDA).

### Minimum paths

**Portfolio:** `get_portfolio` → `portfolio_analyzer` (channel user) → 3-axis below. For "which holdings look undervalued?" also run **Part C gate** on each candidate.

**Single ticker:** `portfolio_analyzer` with `tickers=TICKER` → Part B (+ Part C undervalued verdict if asked or if recommending buy).

**Find undervalued / screen:** Part C discovery → short list → `portfolio_analyzer` on each → Part B deep dive on top names → thesis gate.

**Deep dive:** above + Firecrawl (Yahoo key-statistics/analysis, Finviz, `TICKER 10-K site:sec.gov`, company IR).

**News / "will this move the stock?" / earnings reaction:** Load **`firecrawl`** + **`investment-analysis` Part D** → primary source scrape → `portfolio_analyzer` on ticker → path hypothesis + value gate. Never invent the news content.

**Index-relative / "vs market / vs HSI / vs CSI 300":** Part E → pick fit-for-purpose index/ETF → quote both name and benchmark when tools allow.

**HK / China / dual-list ticker:** Part F ticker map → `portfolio_analyzer` with correct Yahoo suffix → local filing source via Firecrawl if needed.

**Call / put / options strategy:** Part G → analyze **underlying** with Part B/C first → scrape chain for premium/IV only if user asks options → never invent Greeks or premiums.

---

## Part A — Portfolio 3-axis framework

Every **held** position is classified through three lenses (from `portfolio_analyzer` + cost basis).

### 1. Laggards — Cost > Analyst High Target

Underwater with limited recovery path vs Street high.

| Loss vs cost | Action |
|--------------|--------|
| > 30% | **SELL** — Deep loss, weak recovery path |
| 15–30% | **HOLD** — Monitor for catalyst |
| < 15% | **REDUCE COST** — Average down only if fundamentals strong **and** Part C trap gate passes |

### 2. Overpriced — Current Price > Analyst Median Target

| Premium over median | Action |
|---------------------|--------|
| > 20% | **TAKE PROFIT** — Significant overvaluation vs Street |
| 10–20% | **TRAIL STOP** — Protect gains |
| < 10% | **HOLD** — Slight premium; momentum may continue |

### 3. Buy opportunities — Upside to Median > 15%

Street upside is a **signal, not a full undervaluation thesis**. Before STRONG BUY / BUY / accumulate:

1. Part C cheapness + quality + trap gates (at least with analyzer metrics).
2. If trap gate fails → **WATCH** or **HOLD**, not accumulate — say why.

| Upside to median | Action (only if trap gate passes) |
|------------------|-----------------------------------|
| > 30% | **STRONG BUY** — High conviction + solid fundamentals |
| 20–30% | **BUY** — Moderate conviction |
| 15–20% | **WATCH** — Interesting; monitor |

### Portfolio recommendation checklist

Always provide for each position discussed:

1. Current price vs cost basis (P/L %)
2. Current price vs analyst targets (median, mean, high)
3. Key metrics (P/E, forward P/E, PEG, P/B, ROE) when available
4. Classification: Laggard / Overpriced / Opportunity / Normal
5. Specific recommendation + reasoning
6. When undervalued or accumulate: **why cheap / what closes gap / kill criteria** (Part C thesis gate)
7. When depth requested: Part B stock workflow on that ticker

### Sector benchmarks (this product’s funds)

| Fund / category | Benchmark ETF | Tracks |
|-----------------|---------------|--------|
| Financial | SPY | S&P 500 |
| Healthcare | IYH | US Healthcare |
| Aerospace | ITA | US Aerospace & Defense |
| Food Staples | VDC | Consumer Staples |
| Utility | XLU | US Utilities |
| Technology | QQQ | NASDAQ-100 |

For names outside these funds, or for **regional / style** context, use **Part E** index map (do not force every HK/China name onto SPY alone).

---

## Part B — Stock evaluation workflow

Use for "analyze TICKER", valuation questions, or deepening a holding. Run in order; skip only if the user asked for a narrow slice (state what you skipped).

### 1. Business & industry map

- What does the company sell? Who pays?
- Cycle: growth / mature / cyclical / regulated
- Competitors; key risks (10-K when scraped)

**Industry-default valuation lenses:**

| Industry / type | Prefer | Avoid as sole lens |
|-----------------|--------|--------------------|
| Banks / financials | P/B, ROE, tangible book | Unadjusted PE alone; Magic Formula–style EV/EBIT |
| Insurers | Book / embedded-value style | Generic DCF without context |
| REITs | P/AFFO, FFO | Standard PE |
| Consumer goods / staples | P/CF, EV/EBITDA, margins | Growth PE without cash |
| Pharma / energy / telecom | DCF + pipeline/reserves; EV multiples | Single-year PE only |
| Software / asset-light growth | FCF, growth+margin, EV/Sales if early | Book value / pure P/B as "cheap" |
| Utilities | PE, regulated ROE, dividend coverage | Aggressive growth DCF; Magic Formula ROC as sole rank |
| Conglomerates | Sum-of-parts + EV/EBITDA | Single peer multiple |

### 2. Financial-statement snapshot

| Statement | Look for |
|-----------|----------|
| Income | Revenue trend, margins, earnings quality |
| Balance sheet | Net debt, liquidity, goodwill, leverage |
| Cash flow | OCF vs net income; FCF; capex; buybacks/dividends |

**Quality flags:** OCF << net income; rising leverage without ROIC; dilution/serial M&A; concentration risk.

If only Yahoo metrics: report PE/PEG/P/B/ROE and say "No full statement scrape this run."

### 3. Absolute valuation (when data supports)

| Model | Use when | Skip when |
|-------|----------|-----------|
| DDM / Gordon | Stable dividend & payout | Non-payer / irregular |
| DCF (2-stage) | Mature, positive, somewhat predictable FCF | Pre-profit / chaotic FCF without scenarios |
| Asset / SOTP / liquidation | Asset-heavy, conglomerate, distress | Pure intangible compounder |

**DCF discipline:** base/bull/bear range only; terminal value often dominates — fragile; prefer reverse DCF if forecasts weak; never invent cash-flow forecasts. If you cannot build a DCF from data, say so and use multiples. **DCF is a short-list tool, not a market scanner.**

### 4. Relative valuation (multiples)

| Metric | Attractive (screen) | Caution | Expensive (screen) |
|--------|---------------------|---------|---------------------|
| Trailing P/E | < 20 | 20–30 | > 30 |
| Forward P/E | < 18 | 18–28 | > 28 |
| PEG | < 1.0 | 1.0–1.5 | > 2.0 |
| P/B | < 2 | 2–5 | > 5 (context!) |
| ROE | > 20% | 10–20% | < 10% |

Screens, not law. High-growth / high-ROE / banks differ. Negative earnings → P/S, EV/Sales, or P/CF. Always show price vs median (and high) targets when available.

**Composite > single metric:** Prefer reading PE **and** forward PE **and** P/B **and** ROE together (plus EV/EBIT or FCF yield when scraped). Pure P/B alone is a weak modern large-cap definition of value for asset-light firms.

### 5. Style filters

**Value:** margin of safety vs intrinsic/peer value; **require Part C trap gate**.

**Growth / GARP:** PEG, FCF conversion; PEG ≲ 1 only if growth durable; stress "growth halves."

**Quality / moat:** intangibles, cost advantage, switching costs, network effects, efficient scale — still require fair valuation; ask if moat is eroding.

### 6. Street consensus

Median / mean / high targets; upside to median. Consensus ≠ intrinsic value.

If held: also apply **Part A** vs investor cost.

### 7. Factor lens (one line unless asked)

Market beta, size, value, profitability, investment intensity, momentum — so factor beta is not mistaken for unique insight.

### 8. Optional technicals (timing only)

Trend, support/resistance, RSI/MACD as confirmation only. Never sole thesis; never override broken fundamentals.

### 9. Behavioral self-check

| Bias | Fix |
|------|-----|
| Overconfidence | Force scenarios |
| Confirmation | One contrarian risk source |
| Herding | Re-check valuation |
| Anchoring | Re-value from current data (not just cost) |
| Loss aversion | Explicit invalidators |

---

## Part C — Undervalued discovery (find stocks with potential)

**Core definition for this agent:** a stock is a candidate undervaluation only if:

```text
cheap on a fit-for-purpose yardstick
  ∩  strong or improving fundamentals (quality/health)
  ∩  not structurally broken (trap gate)
  ∩  stated thesis: why cheap / what closes the gap / kill criteria
```

Evidence base: quality-at-a-discount and composite value outperform naïve "low multiple only"; value traps are the main failure mode. See `docs/deep-research-find-undervalued-stocks.md`.

### C0 — Intent routing

| User ask | Path |
|----------|------|
| "Analyze AAPL" / valuation | Part B (+ C gate if buy recommended) |
| "Is X undervalued?" / "value trap?" | Part B + **C2–C4** on that ticker |
| "Find undervalued stocks" / "screen for value" / "what looks cheap" | **C1 discovery** → short list → B + C2–C4 |
| "Which of my holdings are undervalued?" | Portfolio analyzer → **C2–C4 on each** → ranked list |
| "Average down on X?" | Part A + **C3 trap gate** — refuse if trap |

### C1 — Discovery funnel (idea generation)

```text
Universe (liquidity / sector / user holdings or named list)
  → Cheapness layer (composite metrics)
  → Quality / financial-health layer
  → Trap / structural layer
  → Short list (target ~5–15 for deep work; never dump 50 raw screen rows without filter)
  → Deep dive (Part B) on survivors
  → Thesis gate (C4) before BUY language
```

#### C1.a Universe

- **Default decision tree (no questions):**
  1. `get_portfolio`. If holdings exist **and** the user asked about *their* names / "my holdings" → Recipe 1.
  2. Else (empty portfolio, or "find undervalued stocks" / "screen for value" / "what looks cheap" with no ticker list) → **Recipe 3 this turn**. Do not ask for a watchlist. Do not offer paths.
  3. If they named tickers or a sector → use that as the universe (still run tools this turn).
- Prefer **user holdings** or user-provided tickers when present; otherwise **always** load **`firecrawl`** and scrape a Finviz/Yahoo value screen (or sector screen). Then `portfolio_analyzer` on the resulting tickers.
- **Playbook markets:** if `watchlists.markets` includes `HK` and/or `CN`/`China` (and not only `US`), bias Recipe 3 screens and example tickers toward those markets (Part F suffixes). If only `US` (default), stay US-liquid mid/large. If user says "Hong Kong" / "A-shares" / "H-shares" explicitly, that overrides default US.
- Default external screen when none specified: Finviz overview or Yahoo "undervalued" / high earnings yield style list (liquid mid/large cap preference). Sector if user named one. For HK: Yahoo or HKEX-linked liquid large caps / Hang Seng constituents. For China A: liquid CSI 300–style names via Yahoo `.SS` / `.SZ` — flag ADR/OTC confusion.
- Apply liquidity common sense: if scrape shows tiny market cap / illiquid microcap, flag capacity risk; do not size as a core position without warning. HK small-caps and ST/* China special-treatment names need extra trap emphasis.
- Sector exclusions when using Magic Formula–style ranks: **financials and utilities** are poor fits for EV/EBIT + ROC ranking (use industry lens instead).

#### C1.b Cheapness yardsticks (pick industry-fit primary + 1 supporting)

| Yardstick | Prefer when | Analyzer | Firecrawl extras |
|-----------|-------------|----------|------------------|
| Trailing / forward PE | Stable earners | Yes | Peer PE |
| PEG | Growth mispricing (GARP) | Yes | Growth estimates page |
| P/B | Banks, asset-heavy | Yes | Tangible book if available |
| EV/EBIT or EV/EBITDA | Non-financial operating cos | No | Yahoo stats / Finviz |
| FCF yield | Cash compounders | No | Cash flow stats |
| NCAV / net-net | Deep asset value only | No | Balance sheet scrape |
| Street discount | Any | Yes (targets) | — |

**Rules:**

- State **which yardstick** you used. Never claim "undervalued" without naming it.
- Prefer **composite**: e.g. forward PE cheap *and* ROE healthy *and* P/B not absurd for sector.
- **Peer-relative when possible:** same sector/sub-industry beats absolute "PE < 15" alone.
- Sector-wide cheapness can still be a **sector trap** — call that out.

#### C1.c Quality / health layer (kill weak cheap names)

Use whatever is available; fail soft only by **labeling missing**, not inventing:

| Signal | Healthy (prefer) | Red flag |
|--------|------------------|----------|
| ROE | > ~10–15% (sector-aware) | Persistently low/negative with no turnaround evidence |
| PEG | < ~1.5 with durable growth claim | PEG high *and* PE high |
| Earnings quality | Stable PE; OCF supports NI (if scraped) | One-off earnings driving low PE |
| Leverage | Manageable for sector | Rising debt + falling book/earnings |
| Piotroski-style health | High F-Score if scraped (e.g. ≥ 6–7) | Very low F-Score on "value" name → likely trap |
| ROC / ROIC | High (Magic Formula spirit) | Chronically low returns on capital |

**Magic Formula spirit (when EV/EBIT + ROC available via scrape):** prefer high earnings yield **and** high return on capital together — "good business at a fair/attractive price," not deep distress alone.

**Piotroski spirit (when F-Score or statement trends available):** among cheap/high P/B names, favor improving profitability, cash flow > accruals, stable/declining leverage, no dilutive equity issuance, improving margins/turnover. If you cannot compute F-Score, approximate with available flags and say "F-Score not computed."

### C2 — Cheapness verdict (single name)

After metrics load, output explicitly:

```text
Cheapness: YES | MIXED | NO
  Yardstick(s): …
  Evidence: … (numbers)
  Peer/sector context: … or "not compared this run"
```

- **YES** — multiple supportive signals or clear discount vs peers + Street.
- **MIXED** — one metric cheap, others not, or only Street upside.
- **NO** — expensive on fit metrics or no data.

Street upside alone → at best **MIXED**, never full YES without fundamentals.

### C3 — Value-trap gate (mandatory before accumulate / average-down)

A **value trap** looks cheap on multiples while **intrinsic value is falling toward (or below) price**.

| Check | Fail (trap risk) | Pass |
|-------|------------------|------|
| Business trajectory | Structural decline, disrupted moat | Stable/improving demand story |
| Profitability | Collapsing margins/ROE, serial losses | ROE/margins stable or recovering |
| Cash | Negative FCF without investment thesis | FCF positive or explained growth capex |
| Balance sheet | Distress leverage, going-concern risk | Solvent for cycle |
| Industry | Dying industry, no niche defense | Cyclical trough or temporary stigma OK if argued |
| Management | Value-destructive M&A, dilution, denial | Rational capital allocation |
| "Why cheap?" | No answer except "PE is low" | Clear mispricing or temporary stigma |

**Gate result:**

| Result | Language allowed |
|--------|------------------|
| **PASS** | BUY / accumulate / average-down (with risks) |
| **WATCH** | Interesting but incomplete evidence — no size-up |
| **FAIL** | Do **not** recommend buying because "cheap"; prefer avoid / sell if held and thesis broken |

If data is insufficient for trap assessment → **WATCH** + list missing fields. Do not invent a pass.

### C4 — Thesis gate (required on undervalued BUY)

Before STRONG BUY / BUY / accumulate on valuation grounds, force three bullets with numbers:

1. **Why is it cheap?** (yardstick + cause: temporary earnings, sector fear, neglect, one-off, etc.)
2. **What closes the gap?** (earnings recovery, multiple re-rating, capital return, catalyst, peer re-rating — not "hope")
3. **Kill criteria:** what would prove the trap thesis (e.g. another ROE collapse, covenant risk, lost contract)

If any bullet is empty → recommendation maxes at **WATCH**.

### C5 — Portfolio construction notes (when recommending several value names)

| Style | Diversification | Holding mindset |
|-------|-----------------|-----------------|
| Quality-at-discount / Magic Formula–like | Focused basket OK (~10–30 if systematic) | Annual re-check ranks |
| Pure deep value / net-net / distress | **Higher diversification** — single names high variance | Portfolio return matters more than one hero |
| Special situations (spinoffs) | Satellite size | Research-heavy; not core screen |

Value strategies can underperform for years — do not promise calendar outperformance; frame process and risk.

### C6 — Efficient recipes (agent-executable)

#### Recipe 1 — Holdings undervaluation sweep (no external screen)

1. `get_portfolio` → `portfolio_analyzer` (all holdings).  
2. Read the tool's **VALUE SCREEN** block (`cheapness` / `quality` / `trapRisk`) plus full metrics lines.  
3. Prefer names with cheapness YES or MIXED, trapRisk LOW, quality not WEAK; cross-check Street upside from 3-axis.  
4. Run C3 human trap gate on top 5–10 (tool trap is a screen, not a business thesis).  
5. Output ranked table: ticker | cheapness | trap | quality | upside | action.  
6. Offer deep dive (Part B + Firecrawl) on top 3.

#### Recipe 2 — "Is TICKER undervalued?"

1. `portfolio_analyzer` for TICKER.  
2. Industry lens (Part B.1).  
3. C2 cheapness + C3 trap + optional Firecrawl key-statistics/Finviz for EV/FCF.  
4. C4 thesis if recommending buy.  
5. Template **Undervalued verdict** below.

#### Recipe 3 — External idea list → filtered short list (default when portfolio empty)

**Trigger:** "find undervalued stocks" / "screen for value" / empty portfolio discovery. **Run immediately — zero clarifying questions.**

1. Load \`firecrawl\`. Scrape Finviz or Yahoo Finance value/overview screen (or sector screen if named). Extract **tickers only** from the page.  
2. If scrape fails, try one alternate URL/query; surface the error if both fail — still no "pick option A/B".  
3. \`portfolio_analyzer\` on full short list (~8–15 names; fail fast per ticker errors).  
4. Drop: missing price; clear expensive on PE+forward PE+PEG without asset case; ROE disaster without turnaround evidence.  
5. Keep ~5–10; deep-dive top 3 with C2–C4.  
6. Output ranked results with numbers + yardsticks. Optional one-liner: "Say a sector or tickers to re-screen" — only after the table.  
7. Never present raw unfiltered screener spam as "undervalued stocks."  
8. Never reply with only a menu of how you *could* help.

#### Recipe 4 — Magic Formula–style check (when stats scraped)

1. Exclude financials/utilities for this recipe.  
2. From scrape: earnings yield ≈ EBIT/EV (or closest EV multiple inverse), ROC/ROIC if present.  
3. Prefer names that are **both** high yield **and** high ROC vs their list.  
4. Still run C3 trap gate and C4 thesis — ranks are not a substitute for business risk.

---

## Part D — News → price-path analysis (smart trend hypothesis)

**Goal:** Turn news into a *structured path hypothesis* (underreaction / overreaction / already priced / unknown) — not a next-tick prophecy.

**Evidence base (human ref):** `docs/deep-research-news-stock-price-prediction.md`  
Key research priors:

| Prior | Implication for the agent |
|-------|---------------------------|
| Semi-strong EMH ≈ true on liquid names | First-print mega-cap moves are hard to capture; do not sell “I can beat the wire” |
| PEAD / earnings drift | After clear earnings surprises, multi-week continuation is the main *researched* news edge — monitor, don’t guarantee |
| Chan: public news vs no-news | Hard public news → watch for **drift**; large move with **no** fundamental news → suspect **reversal** |
| Bad news often slower | Asymmetry: negative shocks may underreact longer (frictions, disposition) |
| Daily sentiment weak; weekly aggregates stronger | One headline is weak for multi-month path; use second-order fundamentals for themes |
| Media pessimism (Tetlock-type) | Extreme narrative/sentiment → short-term pressure + possible **mean reversion**, not permanent DCF change |
| News analytics / HFT | By the time retail reads a popular summary, price may already have moved |

### D0 — Intent routing

| User ask | Path |
|----------|------|
| "What's going on with TICKER?" / "Why did it move?" | D1 capture + classify + reaction; light path hypothesis |
| "How will this news affect price / trend?" | Full D1–D5 + template **News path** |
| "Earnings just dropped — what now?" | Earnings playbook D3 + PEAD watch rules |
| "Should I buy the dip after bad news?" | D path + Part C trap gate + Part A if held |
| Theme without single ticker | Firecrawl theme playbook (not Part D single-name) |

Always load **`firecrawl`** for news content. Run **`portfolio_analyzer`** on the ticker when known.

### D1 — Capture pipeline (run in order)

```text
1. Capture    Primary source (PR, 8-K, IR, Reuters) + timestamp; cite URL
2. Classify   Earnings | Guidance | Corporate action | Product | Macro | Pure narrative | Stale/reprint
3. Surprise   Vs consensus / prior guidance / prior narrative (only if sourced; else "consensus not in tools")
4. Hardness   Cash-flow relevant? One-off? Legal binary? Accounting?
5. Reaction   Live price + today's move if available; vs "typical event day" only if you have evidence
6. Regime     UNDERREACT | OVERREACT | ALREADY_PRICED | UNKNOWN
7. Horizon    Intraday (usually skip for retail) | days–weeks | multi-quarter
8. Gate       Value screen + trap (Part C) before BUY language
9. Action     Watch | add watchlist | size-up only if gates pass | avoid chase
10. Kill      What would falsify the path hypothesis?
```

### D2 — Classify & hardness

| Type | Price mechanism | Agent default |
|------|-----------------|---------------|
| Hard earnings / guidance | Surprise + often PEAD | Quantify numbers from scrape; prefer post-call context |
| M&A / legal / discrete | Binary re-rating | Risk filter; low confidence trend unless deal terms clear |
| Product / competitive | Slow multi-quarter path | Map to units/margins; easy story-overfit |
| Macro print | Factor/sector more than single name | Sector betas; optional holding exposure |
| Pure media/opinion | Sentiment / attention | Mean-reversion risk; weak fundamental signal |
| Stale reprint | Inattention noise | Label stale; do not treat as new info |

**Hard news** = changes expected cash flows, risk, or capital structure with verifiable facts.  
**Soft news** = tone, opinion, recycled narrative without new numbers.

### D3 — Regime priors (default hypotheses)

| Situation | Prior regime | Prefer language |
|-----------|--------------|-----------------|
| Clear positive earnings surprise + strong initial move (liquid) | UNDERREACT / PEAD-watch | "Continuation *possible* over days–weeks; not guaranteed. Reassess next print." |
| Clear beat but price flat/down ("sell the news") | MIXED / ALREADY_PRICED | Dig guidance & call; do not force long |
| Hard public **bad** news, limited initial drop (esp. smaller names) | UNDERREACT risk | Caution; don't average down without trap PASS |
| Large price move, **no** identifiable fundamental news | OVERREACT candidate | Mean-reversion *hypothesis* only after confirming no buried filing |
| Extreme bullish media after large run-up | OVERREACT / sentiment | Flag reversal risk; not a short recommendation unless asked |
| Complex 8-K / buried detail, thin coverage | Slow diffusion | Deep-dive edge; higher research value |
| Mega-cap first headline, minutes-old | ALREADY_PRICED for retail | Do not chase; re-value on full release |

### D4 — Earnings-specific playbook

1. Scrape **release** (IR/8-K) + search **vs estimates** if available.  
2. Extract: EPS, revenue, margins, **guidance** change — only from tool output.  
3. Prefer waiting for / summarizing **earnings call / prepared remarks** when user wants a trade decision (practitioner best practice).  
4. Classify surprise: beat / miss / mixed (guidance often matters more than EPS).  
5. Run `portfolio_analyzer` — price, targets, value screen *after* news.  
6. If surprise is clear and liquidity adequate: set **PEAD watch** (multi-week path hypothesis in surprise direction) + kill criteria (next guidance cut, peer miss, macro shock).  
7. Combine EAR-style thinking: market reaction *in the event window* embeds more than EPS alone — if reaction and soft fundamentals disagree, say so.

### D5 — Gates before action language

| Want to say | Required |
|-------------|----------|
| "Likely short-term up/down tomorrow" | **Avoid** unless user forces speculation — then max confidence **low**, label guess |
| "Multi-week drift watch (PEAD-style)" | Hard earnings/event surprise sourced + liquid enough + regime UNDERREACT |
| BUY / accumulate after news | Part C cheapness + trap PASS + D path not ALREADY_PRICED chase + thesis |
| Average down after bad news | Trap PASS + hard news already reflected or overshot + kill criteria |
| Ignore / no trade | Soft news, stale, or mega-cap first print with no new analysis |

### D6 — Output: news path verdict (required template)

```text
{TICKER} news → path
  Source: … (URL) | Time context: …
  Class: earnings|guidance|corp action|product|macro|narrative|stale
  Hardness: hard|soft|mixed
  Surprise vs expectations: … (or "not in tools")
  Key facts: … (numbers only from scrape)
  Live: price $… | value screen: cheapness=… quality=… trap=…
  Regime: UNDERREACT | OVERREACT | ALREADY_PRICED | UNKNOWN
  Horizon: days–weeks | multi-quarter | n/a (intraday skip)
  Path hypothesis: …
  What would falsify: …
  Action: watch | PEAD-watch | re-value only | avoid chase | (buy only if gates pass)
  Confidence: low|med|high
  Gaps: …
```

### D7 — What not to do (news)

- Predict next-minute direction from a headline  
- Treat social buzz as PEAD  
- Buy gap-ups solely because the article is bullish  
- Ignore guidance when EPS beats  
- Invent consensus estimates or "Street expected X" without a source  
- Confuse media *explanation of yesterday* with a forecast of tomorrow  

---

## Part E — Index framework (relative evaluation)

**Goal:** Never evaluate a stock in a vacuum when a fit-for-purpose **index or liquid ETF** can contextualize performance, beta, sector rotation, and “cheap vs what.”

Indices are **context and relative-performance tools**, not intrinsic value. A stock can beat its index and still be a trap (or lag and still be undervalued).

### E0 — When to use indices

| User ask | What to do |
|----------|------------|
| "How is TICKER doing?" / performance | Quote TICKER + **primary** regional index (and sector ETF if known) over same horizon if tools allow |
| "Is the market expensive?" | Quote broad index ETF(s) + value metrics on the ETF if available; label regime as hypothesis |
| Sector rotation / "tech vs market" | Sector ETF vs SPY/QQQ or local broad index |
| HK / China names | Prefer local benchmarks (HSI, HSCEI, CSI 300) over SPY alone |
| Style (value/growth/small) | Style indices/ETFs (e.g. IWD/IWF/IWM) as factor context — one line unless asked |
| Options on an index | Part G on the **underlying index/ETF** first |

### E1 — Index & liquid proxy map (Yahoo-style symbols)

Use **`portfolio_analyzer`** with these symbols when you need a live level/proxy. Prefer **ETF proxies** for multi-metric screens; use caret indices (`^…`) for level only when needed. If a symbol errors, say **not verified** — do not invent levels.

#### E1.a Broad equity — United States

| Role | Index (level) | Liquid proxy ETF | Use for |
|------|---------------|------------------|---------|
| Large-cap US | `^GSPC` S&P 500 | `SPY` / `VOO` | Default US portfolio / large-cap context |
| Mega-growth / tech-heavy | `^NDX` Nasdaq-100 | `QQQ` | Growth/tech names, software, semis |
| Blue-chip price-weighted | `^DJI` Dow | `DIA` | Industrial/blue-chip narrative only |
| Small-cap | `^RUT` Russell 2000 | `IWM` | Small-cap risk-on / domestic cyclical |
| Total market | — | `VTI` / `ITOT` | Broader-than-S&P context |
| Volatility (fear gauge) | `^VIX` | — | Risk regime only; **not** a stock valuation |

#### E1.b US sector & industry (common)

| Sector lens | Proxy ETF | Use for |
|-------------|-----------|---------|
| Technology | `XLK` or fund `QQQ` | Tech holdings (this product: QQQ for SL Tech) |
| Healthcare | `XLV` / `IYH` | Pharma, devices, managed care |
| Financials | `XLF` | Banks, brokers (use P/B lens on names) |
| Energy | `XLE` | Oil/gas operators |
| Industrials / aero | `XLI` / `ITA` | Aerospace & defense (ITA for SL Aero) |
| Consumer staples | `XLP` / `VDC` | Staples / food |
| Utilities | `XLU` | Regulated utilities |
| Consumer discretionary | `XLY` | Retail, autos (cyclical) |
| Communication | `XLC` | Platforms, media |
| Real estate | `XLRE` | REITs (use AFFO/FFO when scraped) |
| Materials | `XLB` | Cyclical materials |

#### E1.c Style / factor proxies (US)

| Style | Proxy | Use for |
|-------|-------|---------|
| Value | `IWD` / `VTV` | Value-factor backdrop |
| Growth | `IWF` / `VUG` | Growth-factor backdrop |
| Quality / high dividend | `QUAL` / `SCHD` (when relevant) | Quality or income tilt context |
| Momentum | `MTUM` | Momentum regime (optional one-liner) |

#### E1.d Hong Kong & China-related

| Role | Index / note | Proxy ETF (examples) | Use for |
|------|--------------|----------------------|---------|
| HK large-cap | `^HSI` Hang Seng | `2800.HK` (Tracker Fund) when available | Default **HK** listed names |
| HK China enterprises | `^HSCE` Hang Seng China Ent. (H-share style) | — | H-shares / China SOE–linked HK |
| HK tech | Hang Seng TECH (quote via related ETF if `^HSI` alone is wrong fit) | `3067.HK` / `KWEB` (US-listed China internet) when available | HK/China internet & tech |
| Mainland broad | SSE Composite `000001.SS` | — | China A **mood** only (not investable pure-play for most retail abroad) |
| Mainland large blue-chip | CSI 300 `000300.SS` | `ASHR` / `MCHI` (US) when available | A-share large-cap relative |
| Mainland mid | CSI 500 `000905.SS` | — | Mid-cap China context |
| Shenzhen component | `399001.SZ` | — | SZ-listed lens |
| China large (US access) | — | `FXI`, `MCHI` | ADR / US-listed China basket |
| China internet (US) | — | `KWEB` | Platform / internet names |

**Currency note:** HK stocks trade in HKD; A-shares in CNY; many ADRs in USD. When comparing A vs H of the **same company**, discuss **AH premium/discount** only with sourced prices for both lines (Part F). Do not convert FX inventively — if tools give currency codes, state them; if not, label FX gap.

#### E1.e Global / other regions (when user asks)

| Region | Index | Proxy ETF examples |
|--------|-------|--------------------|
| Japan | `^N225` | `EWJ` |
| Europe broad | — | `VGK` / `IEUR` |
| Euro STOXX | `^STOXX50E` when available | `FEZ` |
| Emerging ex-specific | — | `EEM` / `VWO` |
| Developed ex-US | — | `EFA` / `VEA` |
| Gold / rates backdrop | — | `GLD`, `TLT` (macro context only) |

### E2 — How to apply indices in analysis

1. **Pick 1 primary + optional 1 secondary** benchmark (do not dump 10 indices).
   - Primary = listing region + size (e.g. HK name → HSI or 2800.HK; US large → SPY; A-share large → CSI 300 / 000300.SS).
   - Secondary = sector or style ETF when the story is sector-driven.
2. **Relative performance:** if history is available (snapshots or scraped returns), state stock vs index over the same window; if not, quote **current** levels only and say full relative return not computed this run.
3. **Relative valuation:** when comparing PE of a stock to “the market,” prefer **sector peers** first; index aggregate PE only if sourced (ETF stats scrape). Absolute PE bands from Part B remain screens, not law.
4. **Risk regime:** rising `^VIX` or risk-off tape → raise caution on aggressive accumulate language; do not claim a VIX level you did not quote.
5. **Product funds:** keep existing SL fund → ETF map; add Part E only when the name is outside that map or user asks market/index context.
6. **Fail fast:** bad index ticker → omit that benchmark line; do not substitute a guessed number.

### E3 — Index context one-liner (required when discussing performance or “is this strong?”)

```text
Benchmark context: primary={SYMBOL} ({name}) | secondary={optional}
  Stock: … | Index/ETF: … (from tools)
  Relative note: leading | lagging | in-line | not compared this run
```

---

## Part F — Multi-market equities (US · Hong Kong · China)

**Goal:** Correct tickers, correct filings culture, and market-structure traps for **US, HK, and China** listings. Yahoo Finance is the default quote path via `portfolio_analyzer` — **suffixes matter**.

### F0 — Intent routing

| User ask | Path |
|----------|------|
| Ticker with `.HK` / `.SS` / `.SZ` / Chinese name | Normalize → `portfolio_analyzer` → Part B (+ C if value) |
| "Tencent" / "Moutai" / "Alibaba" without venue | Prefer primary liquid listing user implies; if dual-listed, state venues and ask **only** if two venues would change the answer (else pick playbook market or most liquid and label) |
| "A-share vs H-share" / AH premium | Quote both lines with correct suffixes; compare prices only with currency labels |
| Screen "cheap HK / China stocks" | C1 with Part F universe + local benchmarks (Part E) |
| China ADR in US (e.g. BABA, PDD, JD) | Treat as US-listed **China exposure** — SEC + variable China policy risk; still Part B/C |

### F1 — Yahoo ticker conventions (mandatory)

| Market | Yahoo form | Examples | Notes |
|--------|------------|----------|-------|
| US common | `SYMBOL` | `AAPL`, `MSFT`, `BRK-B` | Use hyphen for class shares (`BRK-B`) |
| Hong Kong | `####.HK` or `#####.HK` | `0700.HK` Tencent, `9988.HK` Alibaba HK, `0005.HK` HSBC, `2800.HK` Tracker | **Zero-pad** to 4 digits when that is the local code (e.g. `700` → `0700.HK`). Always include `.HK` |
| Shanghai A | `######.SS` | `600519.SS` Kweichow Moutai, `601318.SS` Ping An | 6-digit code + `.SS` |
| Shenzhen A | `######.SZ` | `000001.SZ` Ping An Bank, `300750.SZ` CATL | 6-digit code + `.SZ` |
| US index | `^GSPC`, `^VIX`, … | see Part E | Caret prefix |
| HK index | `^HSI`, `^HSCE` | | |
| China index | `000001.SS`, `000300.SS`, `399001.SZ` | | Do not confuse SSE Composite `000001.SS` with stock `000001.SZ` |

**Normalization rules:**

1. Strip spaces; uppercase letters; preserve numeric codes and dots.
2. If user writes `0700`, `700.HK`, or `HK0700` and context is Hong Kong → try `0700.HK`.
3. If user writes a 6-digit code and says Shanghai / 沪 / SSE → `.SS`; Shenzhen / 深 / SZSE → `.SZ`. If venue unknown and both could work, **fail with a clear ask** (one short question) rather than invent the exchange.
4. Never invent a listing. If `portfolio_analyzer` errors: say **not tradable / not verified on Yahoo** — then Firecrawl search for correct listing; do not invent IPO stories.

### F2 — Market structure notes (analysis, not trivia)

| Topic | Implication for evaluation |
|-------|----------------------------|
| **US** | Deep analyst coverage; SEC 10-K/10-Q/8-K; shorting & options liquid on large names |
| **Hong Kong** | International investors; HKD peg; southbound/northbound Stock Connect flows matter for some names; filings via **HKEXnews** / company announcements (not SEC) |
| **China A-shares** | T+1, daily limit moves on many names, retail-heavy tape; accounting/standards differ from US GAAP; local filings on exchange / CNINFO / company IR |
| **H-shares / red chips / P-chips** | China business, HK listing — use HK ticker + China macro/policy risk |
| **AH dual listing** | Same economic entity can trade at different valuations in CNY vs HKD — **AH premium/discount** is a real object of analysis when both quotes exist |
| **VIE / ADR China** | US-listed China ADRs often use VIE structures — flag regulatory/structure risk when discussing; do not invent legal conclusions |
| **Connect programs** | Northbound/southbound liquidity can affect who sets the marginal price — qualitative only unless sourced flow data |
| **Currency** | Report price **with currency** from tools (USD/HKD/CNY). Do not silently treat all prices as USD |

### F3 — Filings & news sources by market (via Firecrawl)

| Market | Primary disclosure | News bias |
|--------|-------------------|-----------|
| US | `site:sec.gov` EDGAR 10-K / 10-Q / 8-K | Reuters, CNBC, company IR |
| HK | HKEXnews / company “announcements” / annual & interim reports | SCMP, Reuters, company IR |
| China A | SSE/SZSE announcements, CNINFO (`cninfo.com.cn`), company IR | Reuters, official Xinhua cautiously, local IR — **prefer primary filing over blog** |

Always load **`firecrawl`** for non-US filings text. Prefer primary announcement over aggregator paraphrase.

### F4 — Valuation & trap adjustments by market

| Lens | US | HK | China A |
|------|----|----|---------|
| Multiples | Sector-relative PE/EV standard | Often cross-check HSI peers + China comps for H-shares | Peer A-shares; beware limit-up narrative chasing |
| Quality | ROE, FCF, 10-K risks | Same + geopolitical / Connect / property-sector spillovers when relevant | Earnings quality, related-party, policy sector risk (education, gaming, internet historically) |
| Street targets | Often available on Yahoo | Patchier — if missing, say so; do not invent | Often missing/patchy on Yahoo — **do not force Part A Street upside**; use Part B/C without fake targets |
| Value traps | Classic melting ice cube | SOE capital allocation, property chain stress when evidenced | ST/* status, repeated goodwill, policy cliff, accounting restatements when evidenced |

**Part A (3-axis) when targets missing:** Still report cost vs live price. For Street axes, say **analyst targets unavailable** — classify using fundamentals (Part B/C) only. Never invent median/high targets.

### F5 — Dual-list / ADR recipe

1. Identify all relevant lines (e.g. `BABA` vs `9988.HK`; A-share + H-share pair).
2. `portfolio_analyzer` on **each** ticker the user cares about (or both if comparing).
3. Table: venue | ticker | price | currency | market cap if present | PE/PB when present.
4. AH or ADR–HK gap: state **premium/discount only if both prices and currencies are tool-sourced**; else “gap not computed.”
5. Thesis: which line is more liquid / investable for *this* user (playbook markets); structure risks for ADRs/VIEs when relevant.
6. Recommendation language applies to a **specific ticker**, never “buy Alibaba” without venue.

### F6 — Multi-market discovery (extends Recipe 3)

When playbook or user intent is HK/China:

1. Universe from liquid index constituents or named sector (HSI / CSI 300 style lists via scrape) — extract tickers **with correct suffixes**.
2. `portfolio_analyzer` on the list ( cap ~8–15 ).
3. Part C gates; prefer local Part E benchmark in the write-up.
4. Flag: foreign ownership limits, Connect eligibility, and illiquidity when evidence appears in scrape — do not invent eligibility.

---

## Part G — Options (calls & puts)

**Goal:** Evaluate **calls and puts** as contingent claims on an underlying — not as lottery tickets and not as a substitute for Part B/C on the stock.

**Hard fact rule:** Never invent **premium, bid/ask, IV, delta, gamma, theta, vega, open interest, volume, or greeks**. If not in tool/scrape output → say **unavailable**.

### G0 — Intent routing

| User ask | Path |
|----------|------|
| "Analyze CALL/PUT on TICKER" / strike & expiry | G1–G5 on that contract family + Part B on underlying |
| "Should I buy calls on X?" | Underlying Part B/C first → options structure → only then directional language |
| "Protect my shares" / hedge | Prefer **protective put** or collar framing; size vs holding from `get_portfolio` |
| "Covered call income" | Confirm long stock exists or is assumed; yield = premium/spot only if premium sourced |
| "IV crush after earnings" | Part D earnings path + G IV section; no guaranteed crush magnitude |
| Index options (SPX/SPY) | Underlying = index/ETF from Part E; same gates |

### G1 — Definitions (use precisely)

| Term | Meaning |
|------|---------|
| **Call** | Right to **buy** underlying at strike before/at expiry (style depends on product) |
| **Put** | Right to **sell** underlying at strike |
| **Long call/put** | Paid premium; max loss ≈ premium; convex upside (call) or downside hedge/speculation (put) |
| **Short call/put** | Received premium; **obligation** — undefined or large risk if naked; always state risk |
| **Strike / expiry** | Contract identity — must be user-specified or scraped; never invent “the” ATM strike |
| **Moneyness** | ITM / ATM / OTM vs **live** underlying price from tools |
| **Intrinsic** | Call: max(S−K,0); Put: max(K−S,0) with S,K from tools |
| **Extrinsic / time value** | Premium − intrinsic (only if premium sourced) |
| **IV** | Market’s implied vol — compare to history only if IV rank/percentile sourced |
| **Delta / theta / vega** | Sensitivity labels — optional; only quote if scraped |

### G2 — Workflow (always this order)

```text
1. Underlying   portfolio_analyzer on stock/ETF/index proxy → Part B snapshot (+ C if buy/sell stock implied)
2. Thesis       Directional / vol / income / hedge? Horizon vs expiry?
3. Contract     Strike, expiry, call vs put, long vs short — from user or scrape (fail if missing)
4. Market data  Firecrawl Yahoo options chain for that expiry when user needs premium/IV
5. Structure    Moneyness, intrinsic/extrinsic, breakeven = f(premium) when premium known
6. Risk         Max loss / max gain / assignment / naked short risk
7. Gate         G4 — do not recommend long options on a Part C trap FAIL underlying for “bullish lottery”
8. Output       Template Options verdict
```

**Yahoo options scrape pattern:** load **`firecrawl`**, scrape  
`https://finance.yahoo.com/quote/{TICKER}/options`  
(optionally with date query if the page supports a known expiry). Extract only rows you can see. HK/China single-stock options liquidity is often thin or absent on Yahoo — if chain missing, say **options chain not verified** and stop inventing.

### G3 — Strategy cheat-sheet (recommendation framing)

| Strategy | When it can fit | Kill / caution |
|----------|-----------------|----------------|
| **Long call** | Defined-risk upside; bullish underlying + accepts time decay | IV already extreme; short-dated lottery; trap FAIL underlying |
| **Long put** | Defined-risk downside / hedge | Buying puts as sole “analysis” without underlying view; expensive IV |
| **Covered call** | Long stock + short call; income / mild upside cap | Assignment risk; caps upside on strong re-rating |
| **Protective put** | Long stock + long put; floor | Cost of insurance; wrong expiry/strike vs risk horizon |
| **Collar** | Long stock + put financed by short call | Upside cap + floor; complexity |
| **Naked short call/put** | Rarely appropriate in this product’s advice tone | **State unlimited/large risk**; prefer avoid unless user explicitly accepts and playbook risk is aggressive |
| **Vertical spreads** | Defined risk debit/credit | Need both strikes’ premiums; if missing data → WATCH |

### G4 — Options gates (before BUY call/put language)

| Want to say | Required |
|-------------|----------|
| Buy calls (bullish) | Underlying thesis not trap FAIL; horizon fits expiry; premium/IV sourced or explicitly unknown; max loss = premium stated |
| Buy puts (bearish/hedge) | For hedge: holding or explicit hedge target; for speculation: underlying thesis + premium risk |
| Sell covered calls | Confirmed or assumed long shares; strike/expiry; upside cap explained |
| Sell naked | Strong warning + risk profile aggressive + user intent clear — else refuse naked short |
| “Cheap options” | Means **low premium vs structure**, not “stock is undervalued”; still run stock Part C separately |
| Earnings long straddle/strangle | Part D event; IV likely elevated — say crush risk; no guaranteed profit |

### G5 — Link to indices (index options & beta)

- Prefer liquid proxies (`SPY`, `QQQ`, `IWM`, `2800.HK` if chain exists) over illiquid names for index-vol discussion.
- Stock vs index: if user hedges a portfolio with index puts, map **exposure** qualitatively from holdings (sector weights) — do not invent beta unless sourced.
- VIX (`^VIX`) is a **regime indicator**, not a hedge by itself.

### G6 — Output: options verdict (required template)

```text
{TICKER} options — {CALL|PUT} | strike … | expiry … | side long|short
  Underlying: price … | currency … | Part C: cheapness=… trap=… (or N/A)
  Benchmark context: … (Part E one-liner if relevant)
  Contract: moneyness ITM|ATM|OTM | intrinsic … | premium … | extrinsic … (or unavailable)
  IV / greeks: … (or unavailable — not invented)
  Breakeven: … (only if premium known) | max loss … | max gain …
  Thesis fit: hedge|income|directional|vol | horizon vs expiry: …
  Gate: PASS|WATCH|FAIL — …
  Action: … | Confidence: low|med|high
  Gaps: …
```

### G7 — What not to do (options)

- Invent Greeks, IV rank, or “fair” premium  
- Treat options advice as stock advice without expiry/strike  
- Recommend naked shorts by default  
- Claim guaranteed earnings IV crush profits  
- Ignore that OTM short-dated options often expire worthless  
- Use options language when the user only asked about the stock  

---

## Output templates

### Portfolio position (3-axis)

```text
{TICKER} — {Company}
  Cost $… | Price $… | P/L …%
  Median target $… (upside …%) | High $…
  PE … | Fwd PE … | PEG … | P/B … | ROE …
  Class: Laggard | Overpriced | Opportunity | Normal
  Undervalued gate: Cheapness … | Trap … | Thesis …
  Action: … — reason with numbers
```

### Single-stock / deep analysis

```markdown
## {TICKER} — Analysis

### Snapshot
- Price: $… | Median target: $… (upside …%) | High: $…
- PE: … | Fwd PE: … | PEG: … | P/B: … | ROE: …
- If held: Cost $… | P/L …% | 3-axis class: …
- Data gaps: …

### Business
- … | Industry lens: …

### Fundamentals
- … | Quality flags: …

### Valuation
- Absolute: … (or "not built — reason")
- Relative / composite: …
- Range: base … / bull … / bear …

### Undervalued assessment
- Yardstick: …
- Cheapness: YES | MIXED | NO — evidence …
- Trap gate: PASS | WATCH | FAIL — …
- Why cheap / what closes / kill criteria: …

### Style read
- Value / Growth / Quality: …

### Consensus & factors
- Street: … | Factors: …

### Risks & invalidators
- Thesis breaks if: …

### Recommendation
- Action + conviction (low/med/high)
- Why (≤3 bullets, numbers required)
```

### Undervalued verdict (short)

```text
{TICKER} undervalued verdict
  Cheapness: YES|MIXED|NO — yardstick … (numbers)
  Quality/health: … (ROE / PEG / scraped FCF or F-Score)
  Trap gate: PASS|WATCH|FAIL — …
  Street: median $… (…% upside) | high $…
  Thesis: why cheap · what closes · kill if …
  Action: … (WATCH if any gate incomplete)
  Gaps: …
```

### Discovery short list

```text
Undervalued candidates (n=…)
  Universe: holdings | user list | scraped screen …
  Filters: cheapness … + quality … + trap …

| Ticker | Cheapness | Trap | Street upside | Next step |
|--------|-----------|------|---------------|-----------|
| … | YES/MIXED | PASS/WATCH/FAIL | …% | deep dive / watch / reject |

Top deep dives: …
Rejected as traps / expensive: …
```

### News path (Part D)

Use the **News path verdict** block in Part D6. Keep Slack/Telegram scannable: regime + horizon + 3 fact bullets + action + sources.

### Index context (Part E)

Use the **Benchmark context** one-liner in Part E3 whenever discussing performance or market-relative strength.

### Multi-market / dual-list (Part F)

```text
{NAME} listings
  | Venue | Ticker | Price | Ccy | PE/PB | Notes |
  |------|--------|-------|-----|-------|-------|
  | … | … | … | … | … | … |
  AH/ADR gap: … | not computed
  Preferred line for this user: … (playbook markets / liquidity)
```

### Options (Part G)

Use the **Options verdict** block in Part G6.

---

## Recommendation language

| Situation | Prefer |
|-----------|--------|
| Cheapness YES + trap PASS + solid thesis + Street support | Accumulate / strong interest (with risks) |
| Fair value, quality | Hold / core |
| Price ≫ median + stretched multiples | Trim / take profit / wait |
| Broken thesis; deep loss; cost > high, no catalyst | Sell; do not average down |
| Cheapness YES but trap FAIL or WATCH | Do not buy for "value"; explain trap risk |
| Street upside only, no fundamental cheapness | WATCH — not undervalued claim |
| Hard earnings surprise, UNDERREACT regime, gates OK | PEAD-watch or measured add — not "guaranteed up" |
| Soft headline / mega-cap first print | Avoid chase; re-value when full info in |
| Incomplete data | Watch — no size-up; list gaps |
| HK/China name, targets missing | Fundamentals + local index context; no fake Street median |
| Long call/put, gates pass, premium known | Defined-risk framing + max loss; not “free leverage” |
| Options data missing | WATCH on contract; still may analyze underlying only |
| Naked short options | Avoid / heavy warning — not default advice |

---

## What not to do

- Fake DCF with invented growth/WACC
- Treat analyst median as ground truth alone
- Apply PE bands as hard law for banks, biotech, hyper-growth software
- Call a stock undervalued **only** because price fell or PE is "low" in absolute terms
- Skip trap gate when recommending buy/average-down on "value"
- Dump unfiltered screener results as recommendations
- Claim guaranteed outperformance — analysis is for risk, process, and ranges
- Predict next-tick price from a single headline
- Skip stating uncertainty or data gaps
- Invent EV/EBIT, F-Score, FCF, or consensus estimates when not in tool/scrape output
- Use **SPY alone** as the only benchmark for HK/China names when local indices are available
- Invent Yahoo suffixes or swap `.SS` / `.SZ` / `.HK` without evidence
- Treat all prices as USD — always carry currency from tools
- Invent options premiums, IV, or Greeks
- Recommend options without strike/expiry (or explicit “structure-only, no live chain”)
- Confuse SSE Composite `000001.SS` with Shenzhen stock `000001.SZ`

---

## Related skills

| Skill | Role |
|-------|------|
| **`playbook-setup`** | Patient wizard to configure strategy / risk / buy-sell / watchlists (incl. markets US/HK/CN) |
| **`firecrawl`** | Filings, IR, news, Yahoo key-statistics/analysis/options, Finviz, HKEX/China sources, screens, macro |
| **`bindrive`** | Save HTML reports / portal |

## Related research (not loaded automatically)

| Doc | Use |
|-----|-----|
| `docs/deep-research-find-undervalued-stocks.md` | Discovery funnel, Magic Formula, Piotroski, traps, value premium |
| `docs/deep-research-news-stock-price-prediction.md` | News→path, PEAD, under/overreaction, sentiment limits |
| `docs/deep-research-stock-analysis-methods.md` | Broader valuation / factor / EMH taxonomy |
