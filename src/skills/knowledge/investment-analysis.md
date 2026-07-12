# Investment Analysis

**Invester agent skill** for evaluating stocks and portfolio positions. Combines:

1. **Portfolio 3-axis** — cost basis vs live price vs analyst targets (action on holdings)
2. **Stock evaluation workflow** — fundamentals, valuation, style filters, risks (analyze any ticker)

Load for portfolio analysis, stock evaluation, P/E·PEG·ROE, analyst targets, buy/sell/hold recommendations, DCF/multiples questions, moat/value/growth reads, or "what should I do with my stocks".

For news/filings/IR narrative, also load **`firecrawl`**. For saving reports, use **`bindrive`**.

---

## Hard rules

- Never invent prices, targets, PE, PEG, or ROE — tool data only; fail fast if missing.
- Never give buy/sell without showing underlying numbers (targets and/or metrics from tools).
- Always show **median and high** analyst targets when available.
- Flag any holding with **>30% unrealized loss** as high risk.
- Do not recommend averaging down without fundamentals (PE, ROE, quality) supporting it.
- Prefer a **valuation range** over a single magic price.
- Industry model first — do not force one multiple or DCF on every sector.
- Web facts need Firecrawl URLs; portfolio math needs portfolio/analyzer tools.

---

## Tools (which when)

| Need | Tool |
|------|------|
| Holdings, cost, units | `get_portfolio` |
| Live price, P/L, PE/PEG/ROE, analyst targets | `portfolio_analyzer` (Yahoo Finance) |
| News, earnings, filings, IR, "why it moved" | Load **`firecrawl`** → search/scrape |
| Macro (Fed, CPI) | Firecrawl → federalreserve.gov / Reuters / BLS |

### Minimum paths

**Portfolio:** `get_portfolio` → `portfolio_analyzer` (channel user) → 3-axis below.

**Single ticker:** `portfolio_analyzer` with `tickers=TICKER` → metrics + targets → stock workflow (and 3-axis vs cost if held).

**Deep dive:** above + Firecrawl (Yahoo key-statistics/analysis, `TICKER 10-K site:sec.gov`, company IR).

---

## Part A — Portfolio 3-axis framework

Every **held** position is classified through three lenses (from `portfolio_analyzer` + cost basis).

### 1. Laggards — Cost > Analyst High Target

Underwater with limited recovery path vs Street high.

| Loss vs cost | Action |
|--------------|--------|
| > 30% | **SELL** — Deep loss, weak recovery path |
| 15–30% | **HOLD** — Monitor for catalyst |
| < 15% | **REDUCE COST** — Average down only if fundamentals strong |

### 2. Overpriced — Current Price > Analyst Median Target

| Premium over median | Action |
|---------------------|--------|
| > 20% | **TAKE PROFIT** — Significant overvaluation vs Street |
| 10–20% | **TRAIL STOP** — Protect gains |
| < 10% | **HOLD** — Slight premium; momentum may continue |

### 3. Buy opportunities — Upside to Median > 15%

| Upside to median | Action |
|------------------|--------|
| > 30% | **STRONG BUY** — High conviction (still check fundamentals) |
| 20–30% | **BUY** — Moderate conviction |
| 15–20% | **WATCH** — Interesting; monitor |

### Portfolio recommendation checklist

Always provide for each position discussed:

1. Current price vs cost basis (P/L %)
2. Current price vs analyst targets (median, mean, high)
3. Key metrics (P/E, PEG, ROE) when available
4. Classification: Laggard / Overpriced / Opportunity / Normal
5. Specific recommendation + reasoning
6. When depth requested: Part B stock workflow on that ticker

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
| Banks / financials | P/B, ROE, tangible book | Unadjusted PE alone |
| Insurers | Book / embedded-value style | Generic DCF without context |
| REITs | P/AFFO, FFO | Standard PE |
| Consumer goods / staples | P/CF, EV/EBITDA, margins | Growth PE without cash |
| Pharma / energy / telecom | DCF + pipeline/reserves; EV multiples | Single-year PE only |
| Software / asset-light growth | FCF, growth+margin, EV/Sales if early | Book value |
| Utilities | PE, regulated ROE, dividend coverage | Aggressive growth DCF |
| Conglomerates | Sum-of-parts + EV/EBITDA | Single peer multiple |

### 2. Financial-statement snapshot

| Statement | Look for |
|-----------|----------|
| Income | Revenue trend, margins, earnings quality |
| Balance sheet | Net debt, liquidity, goodwill, leverage |
| Cash flow | OCF vs net income; FCF; capex; buybacks/dividends |

**Quality flags:** OCF << net income; rising leverage without ROIC; dilution/serial M&A; concentration risk.

If only Yahoo metrics: report PE/PEG/ROE and say "No full statement scrape this run."

### 3. Absolute valuation (when data supports)

| Model | Use when | Skip when |
|-------|----------|-----------|
| DDM / Gordon | Stable dividend & payout | Non-payer / irregular |
| DCF (2-stage) | Mature, positive, somewhat predictable FCF | Pre-profit / chaotic FCF without scenarios |
| Asset / SOTP / liquidation | Asset-heavy, conglomerate, distress | Pure intangible compounder |

**DCF discipline:** base/bull/bear range only; terminal value often dominates — fragile; prefer reverse DCF if forecasts weak; never invent cash-flow forecasts. If you cannot build a DCF from data, say so and use multiples.

### 4. Relative valuation (multiples)

| Metric | Attractive (screen) | Caution | Expensive (screen) |
|--------|---------------------|---------|---------------------|
| Trailing P/E | < 20 | 20–30 | > 30 |
| Forward P/E | < 18 | 18–28 | > 28 |
| PEG | < 1.0 | 1.0–1.5 | > 2.0 |
| P/B | < 2 | 2–5 | > 5 (context!) |
| ROE | > 20% | 10–20% | < 10% |

Screens, not law. High-growth / high-ROE / banks differ. Negative earnings → P/S, EV/Sales, or P/CF. Always show price vs median (and high) targets when available.

### 5. Style filters

**Value:** margin of safety vs intrinsic/peer value; watch value traps (falling ROIC, disruption).

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

## Output templates

### Portfolio position (3-axis)

```text
{TICKER} — {Company}
  Cost $… | Price $… | P/L …%
  Median target $… (upside …%) | High $…
  PE … | PEG … | ROE …
  Class: Laggard | Overpriced | Opportunity | Normal
  Action: … — reason with numbers
```

### Single-stock / deep analysis

```markdown
## {TICKER} — Analysis

### Snapshot
- Price: $… | Median target: $… (upside …%) | High: $…
- PE: … | PEG: … | ROE: …
- If held: Cost $… | P/L …% | 3-axis class: …
- Data gaps: …

### Business
- … | Industry lens: …

### Fundamentals
- … | Quality flags: …

### Valuation
- Absolute: … (or "not built — reason")
- Relative: …
- Range: base … / bull … / bear …

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

---

## Recommendation language

| Situation | Prefer |
|-----------|--------|
| Strong upside to median + solid fundamentals | Accumulate / strong interest (with risks) |
| Fair value, quality | Hold / core |
| Price ≫ median + stretched multiples | Trim / take profit / wait |
| Broken thesis; deep loss; cost > high, no catalyst | Sell; do not average down |
| Incomplete data | Watch — no size-up |

---

## What not to do

- Fake DCF with invented growth/WACC
- Treat analyst median as ground truth alone
- Apply PE bands as hard law for banks, biotech, hyper-growth software
- Claim guaranteed outperformance — analysis is for risk, process, and ranges
- Skip stating uncertainty or data gaps

---

## Related skills

| Skill | Role |
|-------|------|
| **`firecrawl`** | Filings, IR, news, Yahoo pages, macro |
| **`bindrive`** | Save HTML reports / portal |

Background research (human reference, not required at runtime): `docs/deep-research-stock-analysis-methods.md`.
