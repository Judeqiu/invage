# Firecrawl — Web Search & Scrape

Use the **`firecrawl` tool** (built into the Utarus framework) for live web data. Requires `FIRECRAWL_API_KEY` on the server — if the tool errors about a missing key, surface that to the user.

## When to load

Load when the user wants web search, news, company research, product pages, filings, competitor pricing, or any fact that is not already in their portfolio / Yahoo tools.

## How to call the tool

Tool name: **`firecrawl`**

| action | Required args | Use for |
|--------|----------------|---------|
| `search` | `query` (optional `limit`, default 10) | Discover pages / news by keywords |
| `scrape` | `url` | Clean markdown of a known page |
| `docs-search` | `question` | Firecrawl product docs only |
| `ask` | `question` (+ optional `jobId`) | Diagnose a failed Firecrawl job |

### Examples

**Search:**
```
firecrawl({ action: "search", query: "Apple Q2 2026 earnings consensus", limit: 5 })
```

**Scrape:**
```
firecrawl({ action: "scrape", url: "https://finance.yahoo.com/quote/AAPL" })
```

## Investment workflow

1. Prefer **search** when the user asks “what’s happening with X” or needs sources.
2. **scrape** top URLs for depth (earnings notes, SEC pages, product pages).
3. Cite titles/URLs from tool output; **never invent** prices or quotes not returned by tools.
4. Portfolio math still uses `portfolio_analyzer` / Yahoo — Firecrawl is for narrative and research, not cost basis.

## Rules

- Call the tool — do not claim you “browsed” without a tool result.
- Keep replies scannable: bullets, source links, short takeaways.
- Off-scope (tax, trade execution): decline; Firecrawl does not change scope.
