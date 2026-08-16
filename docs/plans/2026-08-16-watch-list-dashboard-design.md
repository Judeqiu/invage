# Watch List Dashboard — Design

**Date:** 2026-08-16  
**Status:** Validated design (implementation follows this doc)  
**Scope:** Persist named watch products on the Investment Playbook and show them on a separate WebUI page in the same nav as the financial dashboard.

---

## Problem

Users want to track financial products they care about without treating them as holdings. Playbook `watchlists` today is only a **discovery universe** (`markets` / `sectors` / `themes`). Holdings require cost, units, and can post to the books ledger. There is no interest list and no WebUI surface for it.

The financial dashboard already lives in the Utarus shell via `DomainExtension.webUi`. The watch list must appear as a **sibling nav item**, not a section on that page.

---

## Decisions

| Topic | Choice |
|-------|--------|
| Product | **C** — universe chips on top, named-product table underneath |
| Storage | Extend `playbook.watchlists` with `products[]` (not a top-level YAML key, not fake holdings) |
| Quotes (v1) | Yahoo-quotable `equity` / `fund` symbols only. No silent `quote_source`, no invented mark |
| Writes | Chat tools only. Dashboard is read-only |
| Mutations | Dedicated `add_watch_product` / `remove_watch_product`. Do **not** replace the product array via `update_playbook` |
| Identity | Quote symbol, unique after case-normalize |
| Ledger | Never. Watched names are not lots, have no units/cost, do not affect NAV |
| Nav | **Watch List** next to **Dashboard** (`order: 11`) |
| Quote miss | Per-row `quoteError`; page still 200. Never invent `0` |

**Rejected**

| Approach | Why |
|----------|-----|
| Top-level `watch_list` on user YAML | Second “watch” concept; playbook already owns watchlists |
| Zero-unit holdings | Contaminates NAV, books, and the financial dashboard |

---

## Out of scope (v1)

- Alerts / scheduled checks
- Auto-screen of names that fit markets / sectors / themes
- Dashboard add/remove UI
- Manual-NAV funds and options contracts
- Cache, retry-with-fallback, “use last close if live fails”

---

## Data model

Keep existing universe fields. Add `products`. Missing `products` resolves to `[]` (same pattern as empty `sectors` / `themes`).

```yaml
playbook:
  watchlists:
    markets: [US, HK]
    sectors: [Technology]
    themes: [AI]
    products:
      - symbol: AAPL
        instrument: equity          # equity | fund
        added_at: "2026-08-16"      # YYYY-MM-DD
        note: "waiting for pullback"  # optional
      - symbol: 2800.HK
        instrument: equity
        added_at: "2026-08-16"
```

| Field | Required | Notes |
|-------|----------|--------|
| `symbol` | yes | Quote symbol. Normalize on write (trim, case-normalize). Empty → throw |
| `instrument` | yes | `equity` or `fund`. Unknown → throw |
| `added_at` | yes | `YYYY-MM-DD`, set on add |
| `note` | no | Free text. Omit when empty |

**Invariants**

- `watchlists` must remain a mapping (existing fail-fast)
- `products` if present must be an array
- Duplicate symbol after normalize → throw
- Duplicate on `add_watch_product` → throw (no silent upsert)
- Remove of a symbol not on the list → throw

`Watchlists` / `PlaybookPatch` / `DEFAULT_PLAYBOOK` / `resolvePlaybook` / `applyPlaybookPatch` / `formatPlaybookSummary` all grow this field. `update_playbook` continues to patch **only** `markets` / `sectors` / `themes`.

---

## Tools

Channel-bound like other playbook tools. Fail-fast, no silent defaults.

| Tool | Behavior |
|------|----------|
| `get_playbook` | Already returns `watchlists`. After this change it includes `products` |
| `update_playbook` | Unchanged product semantics. Still patches universe lists only |
| `add_watch_product` | Append one product. Requires `symbol`, `instrument`. Optional `note`. Sets `added_at` today. Duplicate → throw |
| `remove_watch_product` | Remove by `symbol` (normalized). Missing → throw |

Host (WalletStreet) owns the write tools. `@InvestmentAdvisor` already has `get_playbook` (read). Do not give the advisor mutate tools.

Log: `watch_product_added` / `watch_product_removed` with the symbol (same `log[]` pattern as `playbook_updated`).

---

## WebUI

Same plugin: `createInvageWebUi()`. Same session auth. Same static dir.

| | Dashboard (today) | Watch List (new) |
|---|-------------------|------------------|
| Nav | Dashboard · `/dashboard` · `layout-dashboard` · order 10 | Watch List · `/watchlist` · `star` · order 11 |
| Page | `webui/dashboard/` | `webui/watchlist/` |
| Route | iframe → `/domain-assets/invage/dashboard/index.html` | iframe → `/domain-assets/invage/watchlist/index.html` |
| API | `GET /api/domain/invage/dashboard` | `GET /api/domain/invage/watchlist` |

Add the GET handler on the **existing** dashboard API router (`createDashboardApiRouter`). No second `apiRouters` mount.

### Payload

`loadWatchlistForSlug(slug)`:

```ts
{
  slug: string
  displayName: string
  generatedAt: string
  watchlists: {
    markets: string[]
    sectors: string[]
    themes: string[]
  }
  products: Array<{
    symbol: string
    instrument: 'equity' | 'fund'
    added_at: string
    note?: string
    price: number | null
    change: number | null
    changePct: number | null
    currency: string | null
    quoteError?: string
  }>
}
```

- Missing user YAML → throw (API maps to 400)
- Empty `products` is a valid 200, not an error
- Yahoo miss or client-down: that row (or every row) has `quoteError` and null last/change. HTTP 200. Never invent `0`

Price source: existing `fetchPrices` (same client as the financial dashboard). If the Yahoo payload already includes day change, pass it through; if not, last only and leave change null (do not invent).

### Page

Reuse dashboard visual tokens (slate header, white cards, Inter).

1. Header: “Watch List” + generated-at + Refresh
2. Universe: three chip rows — Markets, Sectors, Themes. Empty sector/theme → muted “none set”
3. Table: Symbol · Last · Change · % · Note · Added. Sort by symbol
4. Empty products: “No named products yet. In chat: add AAPL to my watch list.”
5. Footer: Yahoo Finance · Educational only — not licensed financial advice

No add/remove controls on the page in v1.

---

## Errors

| Case | Behavior |
|------|----------|
| No session | 401, same as Dashboard |
| User YAML missing / admin target invalid | 400 with loader message |
| Corrupt `watchlists` / bad `products` shape | throw at resolve/persist |
| Duplicate or missing symbol on write | throw; tool returns the error verbatim |
| One symbol unpriced | row `quoteError`; other rows still price |
| Whole Yahoo client down | all priced columns unavailable; chips still render; HTTP 200 |

No cache. No retry-with-fallback. No “use last close if live fails” unless Yahoo itself returned that close.

---

## Tests

| Area | Assert |
|------|--------|
| `resolvePlaybook` / `applyPlaybookPatch` | Missing `products` → `[]`; explicit products round-trip; reject duplicates and bad shapes |
| `add_watch_product` / `remove_watch_product` | Add; reject duplicate; remove; reject missing |
| `loadWatchlistForSlug` | Chips from playbook; rows + live price override; missing quote → `quoteError`, no invented price |
| `createInvageWebUi` | Nav `/watchlist`, iframe src, static `webui/watchlist/index.html` + `app.js` exist |

Update playbook / data-model / webui-chat docs so `watchlists.products` is not confused with the discovery universe.

---

## Implementation order

1. Playbook types + resolve/patch + unit tests  
2. `add_watch_product` / `remove_watch_product` + tool tests; wire onto host toolset  
3. `loadWatchlistForSlug` + GET `/watchlist` + loader tests  
4. `webui/watchlist/` page + nav/route registration + `createInvageWebUi` assertion  
5. Docs: `docs/data-model.md`, `docs/playbook.md`, `docs/webui-chat-design.md`

---

## Docs to update after ship

- `docs/data-model.md` — `playbook.watchlists.products`
- `docs/playbook.md` — named products vs discovery universe
- `docs/webui-chat-design.md` — second nav tab
- `src/skills/knowledge/playbook-setup.md` — mention products are added via watch tools, not the 7-step universe question
