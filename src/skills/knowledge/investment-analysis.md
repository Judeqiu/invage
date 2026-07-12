# Investment Analysis

**Invester agent skill** for evaluating stocks and portfolio positions. Combines:

1. **Portfolio 3-axis** — cost basis vs live price vs analyst targets (action on holdings)
2. **Stock evaluation workflow** — fundamentals, valuation, style filters, risks (analyze any ticker)
3. **Undervalued discovery funnel** — find candidates that are *cheap ∩ quality/health ∩ not a trap* (idea generation)

Load for portfolio analysis, stock evaluation, **finding undervalued stocks**, screens, value traps, P/E·PEG·ROE·P/B, analyst targets, buy/sell/hold, DCF/multiples, moat/value/growth, or "what should I do with my stocks".

For news/filings/IR/key-statistics/Finviz screens, also load **`firecrawl`**. For saving reports, use **`bindrive`**.

Background research (human reference): `docs/deep-research-find-undervalued-stocks.md`, `docs/deep-research-stock-analysis-methods.md`.

---

## Hard rules

- Never invent prices, targets, PE, PEG, ROE, P/B, FCF, EV/EBIT, or F-Scores — tool/scrape data only; **fail fast** if missing (state the gap).
- Never give buy/sell without showing underlying numbers (targets and/or metrics from tools).
- Always show **median and high** analyst targets when available.
- Flag any holding with **>30% unrealized loss** as high risk.
- Do not recommend averaging down without fundamentals (PE, ROE, quality) supporting it.
- Prefer a **valuation range** over a single magic price.
- Industry model first — do not force one multiple or DCF on every sector.
- **Price drop ≠ undervalued.** Cheapness needs a yardstick (earnings, cash flow, assets, peers) and a quality/trap check.
- Do not call a stock a "buy" on Street upside alone — run the undervalued / trap gates when the user wants undervaluation or accumulation.
- Web facts need Firecrawl URLs; portfolio math needs portfolio/analyzer tools.

---

## Tools (which when)

| Need | Tool |
|------|------|
| Holdings, cost, units | `get_portfolio` |
| Live price, P/L, PE/PEG/ROE/P/B, analyst targets | `portfolio_analyzer` (Yahoo Finance) |
| EV/EBIT, FCF, enterprise value, detailed stats | Load **`firecrawl`** → Yahoo `/key-statistics`, Finviz quote |
| News, earnings, filings, IR, "why it moved" | Load **`firecrawl`** → search/scrape |
| Multi-name screens / idea lists | Firecrawl Finviz/Yahoo screeners or peer scrapes — then `portfolio_analyzer` on short list |
| Macro (Fed, CPI) | Firecrawl → federalreserve.gov / Reuters / BLS |

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

- Prefer **user holdings** or user-provided tickers first (agent has no full-market screener API).
- For broader ideas: load **`firecrawl`** — Finviz/Yahoo-style lists, sector peers of holdings, or user-named screens. Then run `portfolio_analyzer` on the resulting tickers only.
- Apply liquidity common sense: if scrape shows tiny market cap / illiquid microcap, flag capacity risk; do not size as a core position without warning.
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

#### Recipe 3 — External idea list → filtered short list

1. User list **or** Firecrawl screen/peer scrape → tickers only.  
2. `portfolio_analyzer` on full short list (fail fast per ticker errors).  
3. Drop: missing price; clear expensive on PE+forward PE+PEG without asset case; ROE disaster without turnaround evidence.  
4. Keep ~5–15; deep-dive top names.  
5. Never present raw unfiltered screener spam as "undervalued stocks."

#### Recipe 4 — Magic Formula–style check (when stats scraped)

1. Exclude financials/utilities for this recipe.  
2. From scrape: earnings yield ≈ EBIT/EV (or closest EV multiple inverse), ROC/ROIC if present.  
3. Prefer names that are **both** high yield **and** high ROC vs their list.  
4. Still run C3 trap gate and C4 thesis — ranks are not a substitute for business risk.

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
| Incomplete data | Watch — no size-up; list gaps |

---

## What not to do

- Fake DCF with invented growth/WACC
- Treat analyst median as ground truth alone
- Apply PE bands as hard law for banks, biotech, hyper-growth software
- Call a stock undervalued **only** because price fell or PE is "low" in absolute terms
- Skip trap gate when recommending buy/average-down on "value"
- Dump unfiltered screener results as recommendations
- Claim guaranteed outperformance — analysis is for risk, process, and ranges
- Skip stating uncertainty or data gaps
- Invent EV/EBIT, F-Score, or FCF when not in tool/scrape output

---

## Related skills

| Skill | Role |
|-------|------|
| **`firecrawl`** | Filings, IR, news, Yahoo key-statistics/analysis, Finviz, screens, macro |
| **`bindrive`** | Save HTML reports / portal |

## Related research (not loaded automatically)

| Doc | Use |
|-----|-----|
| `docs/deep-research-find-undervalued-stocks.md` | Discovery funnel, Magic Formula, Piotroski, traps, value premium |
| `docs/deep-research-stock-analysis-methods.md` | Broader valuation / factor / EMH taxonomy |
