# Firecrawl — Web Search, Scrape & Financial Sources

Use the **`firecrawl` tool** (Utarus framework) for live web data. Requires `FIRECRAWL_API_KEY`. If the tool errors about a missing key, surface that to the user.

For **quotes, PE, analyst targets on holdings**, prefer `portfolio_analyzer` / market tools first (Yahoo Finance API). Use Firecrawl for news, filings, transcripts, IR pages, macro, and qualitative research.

## When to load

Load for: web search, earnings news, 10-K/10-Q, guidance, sector news, competitor landscape, macro (Fed, CPI), company IR, or any fact not already returned by portfolio/Yahoo tools.

## Tool API

Tool name: **`firecrawl`**

| action | Required | Use |
|--------|----------|-----|
| `search` | `query` (optional `limit`, default 10) | Discover pages |
| `scrape` | `url` | Clean markdown from a known URL |
| `docs-search` | `question` | Firecrawl product docs only |
| `ask` | `question` (+ optional `jobId`) | Diagnose failed Firecrawl jobs |

---

## Financial information sources (prefer these)

When researching equities, **bias search queries and scrapes toward high-signal finance sources**. Build queries with ticker + company + site/domain hints.

### Tier 1 — Primary / official

| Need | Preferred sources | How to fetch |
|------|-------------------|--------------|
| SEC filings (US) | SEC EDGAR company filings, 10-K / 10-Q / 8-K | `search` query: `"{TICKER} 10-K site:sec.gov"` then `scrape` the filing or index URL |
| Company guidance / IR | Company investor relations (e.g. `investor.apple.com`) | `search` `"{Company} investor relations"` then `scrape` IR / earnings page |
| Official press | Company newsroom / press release | `search` + `scrape` |

### Tier 2 — Market data & consensus pages

| Need | Preferred sources | How to fetch |
|------|-------------------|--------------|
| Quote / overview | Yahoo Finance quote | **First** try `portfolio_analyzer` with tickers. For narrative pages: `scrape` `https://finance.yahoo.com/quote/{TICKER}` |
| Analysis / stats | Yahoo Finance analysis, statistics | `scrape` `https://finance.yahoo.com/quote/{TICKER}/analysis` or `/key-statistics` |
| Screener / multi-metric snapshot | Finviz quote | `scrape` `https://finviz.com/quote.ashx?t={TICKER}` |
| Market overview | Yahoo Finance markets, CNBC markets | `search` then `scrape` |

**Yahoo Finance URL patterns (scrape-friendly):**
- Quote: `https://finance.yahoo.com/quote/AAPL`
- Analysis (targets / estimates): `https://finance.yahoo.com/quote/AAPL/analysis`
- Statistics: `https://finance.yahoo.com/quote/AAPL/key-statistics`
- News: `https://finance.yahoo.com/quote/AAPL/news`
- Profile: `https://finance.yahoo.com/quote/AAPL/profile`
- Holders: `https://finance.yahoo.com/quote/AAPL/holders`
- For BRK.B use Yahoo form `BRK-B` in paths when needed.

### Tier 3 — News & research (cite carefully)

| Need | Sources | Notes |
|------|---------|--------|
| Breaking / wire | Reuters, Bloomberg (if open), WSJ, FT, CNBC, MarketWatch | Prefer Reuters/CNBC for accessibility |
| Earnings previews | Seeking Alpha, Motley Fool, company IR | Flag opinion vs fact |
| Analyst notes (public) | Yahoo analysis tab, public recaps | Do not invent “Street target” without a source |
| Macro | Federal Reserve (federalreserve.gov), BLS, BEA | Prefer official stats |

### Sector / fund context (this product’s SL funds)

When discussing categories, map to benchmarks and sector news:

| Category | Benchmark | Research angle |
|----------|-----------|----------------|
| SL Technology S1 | QQQ | mega-cap tech, semis, software |
| SL Healthcare S1 | IYH | pharma, biotech, managed care |
| SL Aerospace S1 | ITA | defense primes, commercial aero |
| SL Food Staples S1 | VDC | staples, retail food |
| SL Utility S1 | XLU | regulated utilities, power |
| SL Financial S1 | SPY / financials | banks, Berkshire-style, broad market |

---

## Recommended research playbooks

### A. “What’s going on with {TICKER}?”

1. `portfolio_analyzer` if in portfolio (price + targets + PE).
2. `firecrawl` **search**: `"{TICKER} {Company} earnings OR guidance site:reuters.com OR site:cnbc.com OR site:sec.gov"` (limit 8).
3. `scrape` 1–2 best URLs (prefer IR, SEC, Reuters).
4. Reply: bullets + **sources (title + URL)** + impact on the position if held.

### B. Earnings / guidance

1. Search: `"{TICKER} Q{n} {year} earnings"` and `"{Company} earnings release site:sec.gov OR investor"`.
2. Scrape company IR earnings release or 8-K.
3. Summarize: revenue, EPS, guidance, surprises — only numbers that appear in tool output.

### C. Fundamentals deep dive

1. Market tools for PE/PEG/ROE when available.
2. Scrape Yahoo `/key-statistics` and `/analysis`.
3. Optional: Finviz quote page for compact multi-metric view.
4. Compare to sector peers with a second search if user asks.

### D. Macro / rates impact on portfolio

1. Search Fed / CPI / rates headlines.
2. Scrape official or high-quality news summary.
3. Map qualitatively to utilities, financials, growth tech — no fabricated beta math.

### E. Competitive set

1. Search `"{Company} vs competitors {year}"` or peer tickers.
2. Scrape 1 comparison or IR competitive discussion if available.

---

## Query construction tips

- Always include **ticker** and **company name** when known.
- Prefer: `site:sec.gov`, `site:reuters.com`, `investor.`, `earnings`, `10-Q`, `guidance`.
- Avoid pure blog spam: if results look low quality, re-search with `site:` filters.
- Use **scrape on direct URLs** once search returns a good link (more reliable than search snippets alone).

## Good search query examples

```
AAPL Apple Q2 2026 earnings results site:reuters.com OR site:cnbc.com
MSFT Microsoft 10-Q site:sec.gov
NEE NextEra guidance investor relations
LLY Eli Lilly tirzepatide revenue OR guidance
"federal reserve" rate decision site:federalreserve.gov OR site:reuters.com
```

## Good scrape URL examples

```
https://finance.yahoo.com/quote/AAPL/analysis
https://finance.yahoo.com/quote/MSFT/key-statistics
https://finviz.com/quote.ashx?t=NVDA
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL&type=10-K&count=5
```
(Adjust CIK/ticker as needed; if a URL 404s, search again.)

---

## Data source priority (do not invent)

| Data type | Preferred tool / source |
|-----------|-------------------------|
| Live quote, PE, targets for holdings | `portfolio_analyzer` / market fetch (Yahoo API) |
| News, narrative, “why moved” | Firecrawl search + scrape |
| Filings, risk factors | SEC / IR via Firecrawl |
| Cost basis, units, P/L | `get_portfolio` only |

**Never invent prices, EPS, guidance, or “Street targets.”** If scrape/search fails, say so and retry with another source.

## Rules

1. Call tools — never claim you browsed without results.
2. Cite **title + URL** for web claims.
3. Keep Slack/Telegram replies scannable (bullets, short sections).
4. Portfolio mutations still use portfolio tools; Firecrawl is research only.
5. Off-scope: licensed advice, tax, trade execution.
