# Firecrawl — Web Search, Scrape & Financial Sources

Use the **`firecrawl` tool** (Utarus framework) for live web data. Requires `FIRECRAWL_API_KEY`. If the tool errors about a missing key, surface that to the user.

For **quotes, PE, analyst targets on holdings**, prefer `portfolio_analyzer` / market tools first (Yahoo Finance API). Use Firecrawl for news, filings, transcripts, IR pages, macro, and qualitative research.

## When to load

Load for: web search, earnings news, 10-K/10-Q, **HKEX / China A-share filings**, guidance, sector news, competitor landscape, macro (Fed, CPI, PBOC, HKMA), company IR, **options chains / IV pages**, multi-market screens, or any fact not already returned by portfolio/Yahoo tools.

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
| HK filings / announcements | HKEXnews, company announcements, annual & interim reports | `search` `"{Company OR stock code} announcement site:hkexnews.hk OR site:hkex.com.hk"` then `scrape` |
| China A-share filings | CNINFO, SSE, SZSE company announcements | `search` `"{code OR name} 公告 site:cninfo.com.cn OR site:sse.com.cn OR site:szse.cn"` then `scrape` primary notice |
| Company guidance / IR | Company investor relations (e.g. `investor.apple.com`) | `search` `"{Company} investor relations"` then `scrape` IR / earnings page |
| Official press | Company newsroom / press release | `search` + `scrape` |

### Tier 2 — Market data & consensus pages

| Need | Preferred sources | How to fetch |
|------|-------------------|--------------|
| Quote / overview | Yahoo Finance quote | **First** try `portfolio_analyzer` with **correct market suffix** (see multi-market). For narrative pages: `scrape` `https://finance.yahoo.com/quote/{TICKER}` |
| Analysis / stats | Yahoo Finance analysis, statistics | `scrape` `https://finance.yahoo.com/quote/{TICKER}/analysis` or `/key-statistics` |
| Options chain / IV | Yahoo Finance options | `scrape` `https://finance.yahoo.com/quote/{TICKER}/options` — report only visible strikes/expiry/premium/IV; **never invent Greeks** |
| Screener / multi-metric snapshot | Finviz quote (US-centric) | `scrape` `https://finviz.com/quote.ashx?t={TICKER}` — weak for pure HK/A-shares; prefer Yahoo for those |
| Index / market overview | Yahoo indices, CNBC, local exchange pages | `search` then `scrape`; indices via analyzer first (`^HSI`, `SPY`, `000300.SS`, …) |
| Market overview | Yahoo Finance markets, CNBC markets | `search` then `scrape` |

**Yahoo Finance URL patterns (scrape-friendly):**
- Quote: `https://finance.yahoo.com/quote/AAPL`
- HK: `https://finance.yahoo.com/quote/0700.HK`
- Shanghai: `https://finance.yahoo.com/quote/600519.SS`
- Shenzhen: `https://finance.yahoo.com/quote/000001.SZ`
- Analysis (targets / estimates): `https://finance.yahoo.com/quote/AAPL/analysis`
- Statistics: `https://finance.yahoo.com/quote/AAPL/key-statistics`
- Options: `https://finance.yahoo.com/quote/AAPL/options`
- News: `https://finance.yahoo.com/quote/AAPL/news`
- Profile: `https://finance.yahoo.com/quote/AAPL/profile`
- Holders: `https://finance.yahoo.com/quote/AAPL/holders`
- For BRK.B use Yahoo form `BRK-B` in paths when needed.
- Indices: `https://finance.yahoo.com/quote/%5EHSI` (Hang Seng), `https://finance.yahoo.com/quote/%5EGSPC` (S&P 500)

### Multi-market ticker suffixes (Yahoo)

| Market | Suffix / form | Example |
|--------|---------------|---------|
| US | plain or `BRK-B` | `AAPL` |
| Hong Kong | `.HK` (zero-pad codes) | `0700.HK`, `9988.HK` |
| Shanghai A | `.SS` | `600519.SS` |
| Shenzhen A | `.SZ` | `300750.SZ` |
| US index | `^…` | `^GSPC`, `^VIX` |
| HK index | `^HSI`, `^HSCE` | |

If the quote fails, re-search the correct listing — **do not invent** a venue.

### Tier 3 — News & research (cite carefully)

| Need | Sources | Notes |
|------|---------|--------|
| Breaking / wire | Reuters, Bloomberg (if open), WSJ, FT, CNBC, MarketWatch | Prefer Reuters/CNBC for accessibility |
| HK / China English wire | Reuters, SCMP (paywall risk), company IR | Prefer primary HKEX/CNINFO over blogs |
| Earnings previews | Seeking Alpha, Motley Fool, company IR | Flag opinion vs fact |
| Analyst notes (public) | Yahoo analysis tab, public recaps | Do not invent “Street target” without a source; HK/A-share targets often missing |
| Macro US | Federal Reserve (federalreserve.gov), BLS, BEA | Prefer official stats |
| Macro China / HK | PBOC, NBS, HKMA (when relevant), Reuters | Prefer official + wire; label policy uncertainty |

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

### Regional benchmark context (beyond SL funds)

| Universe | Primary benchmark | Notes |
|----------|-------------------|-------|
| US large-cap | SPY / `^GSPC` | Default US |
| US tech/growth | QQQ / `^NDX` | Growth names |
| Hong Kong | `^HSI` / `2800.HK` | Do not force SPY-only context |
| H-shares / China SOE–linked HK | `^HSCE` | When relevant |
| China A large | `000300.SS` (CSI 300) | Mood + relative; access limits for many retail |
| China US-listed / ADR basket | MCHI / FXI / KWEB | Policy + VIE risk language when evidenced |

---

## Recommended research playbooks

### A. “What’s going on with {TICKER}?” / “Is {TICKER} public / IPO / SpaceX?”

1. **First tool call:** `portfolio_analyzer` with `tickers={TICKER}` — establish whether a real quote exists.
2. If quote missing/error: Firecrawl search `"{TICKER}" OR "{Company}" IPO OR listing site:sec.gov OR site:reuters.com` — do **not** invent listing status.
3. `firecrawl` **search**: `"{TICKER} {Company} earnings OR guidance site:reuters.com OR site:cnbc.com OR site:sec.gov"` (limit 8).
4. `scrape` 1–2 best URLs (prefer IR, SEC, Reuters).
5. Reply **only** with verified bullets + **sources (title + URL)**. Label anything else as hypothesis.

### B. Earnings / guidance

1. Search: `"{TICKER} Q{n} {year} earnings"` and `"{Company} earnings release site:sec.gov OR investor"`.
2. Scrape company IR earnings release or 8-K.
3. Summarize: revenue, EPS, guidance, surprises — only numbers that appear in tool output.
4. For **price-path after earnings**, also load **investment-analysis Part D** (PEAD watch, surprise vs consensus, post-call preference).

### B2. News → stock trend / “how will this move the price?” (with investment-analysis Part D)

1. Load **`firecrawl`** + **`investment-analysis`** (Part D).
2. Search primary: `"{TICKER} {Company} {event keywords} site:reuters.com OR site:sec.gov OR investor"`.
3. Scrape **primary** source first (PR, 8-K, IR, Reuters) — not opinion blogs.
4. Optional: one secondary for consensus/context if present in article.
5. Run `portfolio_analyzer` on ticker (price, targets, value screen).
6. Produce Part D **news path verdict**: class, hardness, surprise, regime (UNDERREACT / OVERREACT / ALREADY_PRICED / UNKNOWN), horizon, action.
7. Cite URLs. Never invent consensus or claim next-tick certainty.
8. Prefer UNDERREACT/PEAD language only after hard earnings/event surprise with sourced facts.

### C. Fundamentals deep dive

1. Market tools for PE/PEG/ROE/P/B when available.
2. Scrape Yahoo `/key-statistics` and `/analysis`.
3. Optional: Finviz quote page for compact multi-metric view.
4. Compare to sector peers with a second search if user asks.

### C2. Undervalued / value metrics (supports investment-analysis Part C)

When the user wants **undervalued discovery**, EV/EBIT, FCF, ROIC, or peer cheapness beyond analyzer fields:

1. Prefer `portfolio_analyzer` first for PE/forward PE/PEG/P/B/ROE/targets.
2. `scrape` `https://finance.yahoo.com/quote/{TICKER}/key-statistics` for enterprise value, margins, cash flow fields when present.
3. `scrape` `https://finviz.com/quote.ashx?t={TICKER}` for compact multi-metric snapshot (valuation, profitability, debt).
4. Optional peers: search `"{TICKER} peers"` or scrape competitor quotes; compare same-sector multiples only.
5. For idea lists (not a full market API): search Finviz/Yahoo screen articles carefully, extract **tickers only**, then run `portfolio_analyzer` + investment-analysis trap gate — never paste an unfiltered screener as "undervalued."
6. Report only numbers that appear in tool output; if EV/EBIT or F-Score absent, say **unavailable** (do not invent).

### C3. HK / China equity research (supports investment-analysis Part F)

1. Normalize ticker (`0700.HK`, `600519.SS`, `000001.SZ`) — `portfolio_analyzer` first.
2. Filings: search HKEXnews (HK) or CNINFO/SSE/SZSE (A-shares); scrape **one** primary announcement or results notice.
3. Stats: Yahoo `/key-statistics` for that exact Yahoo symbol.
4. Dual-list / ADR: analyzer on **each** line; table venue/currency; AH gap only if both prices sourced.
5. Benchmark: quote `^HSI` / `000300.SS` / relevant ETF — not SPY alone.
6. Never invent Connect eligibility, ST status, or AH premium.

### C4. Options chain (supports investment-analysis Part G)

1. Analyze underlying with `portfolio_analyzer` first.
2. `scrape` `https://finance.yahoo.com/quote/{TICKER}/options` (US liquid names most reliable).
3. Extract only visible: expiry list, strike, bid/ask or last, IV if shown, volume/OI if shown.
4. If page empty / geo-blocked / no chain for HK-A name → **options chain not verified** — do not invent.
5. Pair with investment-analysis Part G verdict template.

### D. Macro / rates impact on portfolio

1. Search Fed / CPI / rates headlines.
2. Scrape official or high-quality news summary.
3. Map qualitatively to utilities, financials, growth tech — no fabricated beta math.

### D2. Market themes / “how will X affect the stock market?” (IN SCOPE)

Examples: AI impact on markets, energy transition, regulation, geopolitics, bubbles, sector futures.

1. **Do not refuse** — thematic market questions are core Invester research, not off-topic.
2. `firecrawl` **search** 2–3 queries, e.g.:
   - `"AI impact stock market" OR "artificial intelligence equities" site:reuters.com OR site:cnbc.com`
   - `"AI capital expenditure semiconductors cloud" 2025 OR 2026`
   - Sector-specific follow-ups as needed
3. `scrape` 2–4 best URLs (prefer Reuters, CNBC, Fed/official, major IR/earnings themes).
4. Reply structure (bullets):
   - Thesis / what markets may already price
   - Transmission channels (earnings, multiples, capex, labor, regulation)
   - Illustrative winners / losers (sectors or example tickers — not automatic buy calls)
   - Risks, timeline, falsifiers
   - Optional: link to user's portfolio exposure if they have holdings
5. Always **cite source URLs**. Never invent market data. Offer follow-ups: portfolio AI exposure, value-screen a short list, deep-dive a ticker.

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
0700 Tencent interim results site:hkexnews.hk OR investor
9988.HK Alibaba announcement site:hkexnews.hk
600519 贵州茅台 年报 OR 公告 site:cninfo.com.cn
CSI 300 OR 沪深300 valuation OR constituents
AAPL options implied volatility earnings
```

## Good scrape URL examples

```
https://finance.yahoo.com/quote/AAPL/analysis
https://finance.yahoo.com/quote/MSFT/key-statistics
https://finance.yahoo.com/quote/AAPL/options
https://finance.yahoo.com/quote/0700.HK
https://finance.yahoo.com/quote/0700.HK/key-statistics
https://finance.yahoo.com/quote/600519.SS
https://finance.yahoo.com/quote/%5EHSI
https://finviz.com/quote.ashx?t=NVDA
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL&type=10-K&count=5
```
(Adjust CIK/ticker as needed; if a URL 404s, search again.)

---

## Data source priority (do not invent)

| Data type | Preferred tool / source |
|-----------|-------------------------|
| Live quote, PE, P/B, ROE, targets for holdings | `portfolio_analyzer` / market fetch (Yahoo API) — correct **suffix** for HK/China |
| Index levels / regional benchmarks | `portfolio_analyzer` on ETF/index tickers; Firecrawl if needed |
| Ticker exists / public listing check | `portfolio_analyzer` first; then Yahoo/SEC/HKEX/CNINFO via Firecrawl |
| IPO / S-1 / private vs public | SEC EDGAR + Reuters/company IR via Firecrawl — **never invent** |
| EV, FCF, detailed key stats, Finviz multi-metric | Firecrawl scrape Yahoo key-statistics / Finviz quote |
| Options premium / IV / chain | Firecrawl Yahoo `/options` — never invent Greeks |
| News, narrative, “why moved” | Firecrawl search + scrape |
| Filings, risk factors | SEC (US) / HKEXnews (HK) / CNINFO·SSE·SZSE (A) / IR via Firecrawl |
| Cost basis, units, P/L | `get_portfolio` only |

**Never invent** prices, EPS, guidance, Street targets, IPO prices, listing dates, “reserved tickers,” grey-market quotes, AH premiums, options Greeks/IV, or company public/private status. If scrape/search fails or quote fails, say **not verified** and stop — do not fill with a plausible story.

## Fact-check gate (before final reply)

For each factual sentence about the world:

1. Which tool result supports it?
2. Can you point to a URL or analyzer field?
3. If no → remove or relabel as "unverified / not in tools."

**Anti-pattern (forbidden):** Writing a long explanation of SPCX/IPO/roadshow/open-close **before** or **without** quote + news/SEC verification. That destroyed user trust.

## Rules

1. Call tools **before** user-visible claims — never claim you browsed without results.
2. Cite **title + URL** for web claims; for quotes say the price came from live market data.
3. Keep Slack/Telegram replies scannable (bullets, short sections).
4. Portfolio mutations still use portfolio tools; Firecrawl is research only.
5. Off-scope: licensed advice, tax, trade execution — **not** market themes, macro, or “how will X affect stocks?” (those are in scope; use playbook D2).
6. User correction → re-fetch tools, then answer. Never invent a more detailed wrong story.
