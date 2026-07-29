# Fund Holdings Design

**Date:** 2026-07-29  
**Status:** Approved  
**Scope:** Add mutual funds / ETFs as `instrument: fund` portfolio holdings (基金), distinct from free cash and equities.

---

## Decisions

| Topic | Choice |
|-------|--------|
| Meaning of “add funds” | Fund products (基金), not cash deposit |
| Types in v1 | Open-end mutual funds **and** listed ETFs under one `instrument: fund` |
| Pricing | Hybrid: `fund.quote_source` = `yahoo` \| `manual` (required, no silent default) |
| Portfolio key | User-provided code/ticker (same as equity); multi-channel → `CODE@channel` |
| Street 3-axis | Equities only; funds valued for NAV/dashboard/snapshot, not target buckets |
| Cash ledger | Same as equity (buy −cost, remove +cost) |

---

## Data model

```yaml
portfolio:
  SPY:
    instrument: fund
    avg_price: 480.00
    units: 20
    channel: ibkr
    fund:
      quote_source: yahoo

  "110011":
    instrument: fund
    avg_price: 1.2345
    units: 10000
    channel: jude_futu
    category: Bond
    fund:
      quote_source: manual
      mark: 1.3012
      name: "易方达中证500联接A"
```

| Field | Required | Notes |
|-------|----------|--------|
| `instrument` | yes | `"fund"` |
| `avg_price` / `units` | yes | Cost per unit × units |
| `fund.quote_source` | yes | `yahoo` \| `manual` |
| `fund.mark` | if manual | NAV/price ≥ 0 for MTM |
| `fund.name` | no | Display label |
| `channel` / `category` | no | Same multi-broker semantics |

**Fail-fast:** missing `quote_source`; `manual` without `mark`; `yahoo` without live Yahoo price (no silent fallback to mark).

**Economics:** same as equity — cost = avg × units; value = mark × units; P/L = value − cost.

---

## Tools

Extend `add_holding` / `update_holding` / `remove_holding` (no separate `add_fund`).

| Param | Fund use |
|-------|----------|
| `instrument=fund` | Required |
| `ticker` | Base key (`SPY`, `110011`) |
| `fund_quote_source` | `yahoo` \| `manual` |
| `mark` | Required when manual |
| `fund_name` | Optional |
| `channel`, `adjust_cash` | Same as equity |

---

## Pipeline

- Yahoo-priced keys: equities + funds with `quote_source: yahoo`
- Manual funds: use `fund.mark` in `valuePosition` (like options ignore Yahoo equity map)
- Analyzer target buckets: skip funds; still list in full valuation when requested via portfolio value
- Dashboard / snapshot: positions include funds; optional `fundCount`

---

## Non-goals (v1)

- Auto FX for CN fund NAV in CNY vs USD cash
- Dividend / distribution reinvestment ledger
- Separate capital-contribution book
