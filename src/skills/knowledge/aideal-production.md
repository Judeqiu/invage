# Aideal production

**AIDeal package skill** — named Excelsis / Aideal Investment production: sleeve index vs sector ETF, weekly 5-section pack, Gmail-safe newsletter HTML.

Load by capability fit when the work is **this book’s production report**, not a generic public-market thesis.

## Tools

| Need | Tool |
|------|------|
| Sleeve catalog (id, bench, base date) | `list_aideal_sleeves` |
| Fund idx / bench idx / vs bench | `compute_sleeve_index` (`sleeve_id` + required `report_date`; lots or books `category`) |
| Weekly HTML pack | `save_aideal_newsletter` (pass **exact** `details.sleeves` from compute) |
| Live P/L / metrics for section tables | `get_portfolio` + `portfolio_analyzer` / `get_quote` |
| Generic 3-axis HTML | `save_report` — still not a substitute for sleeve index |

## Sleeve index (mandatory math)

```
sleeve NAV = Σ units × adj-close
fund_index = 100 × NAV(report) / NAV(base)
bench_index = 100 × bench(report) / bench(base)
vs_bench = fund_index − bench_index
```

- `report_date` is required (YYYY-MM-DD). Yahoo maps each date to the last session **on or before** it (weekends/holidays).
- Do **not** invent prices, units, or indices. Missing lot or close → fail and say so.
- Lots: `holding.category` must equal sleeve id (`financial`, `healthcare`, `aerospace`, `food-staples`, `utility`, `technology`). `overall` = union of those six. Or pass `lots` explicitly.
- Bookkeeper journals the lots. You do not write books.

## Five-section analysis (after indices)

Use analyzer/quote numbers this turn. Do not copy old newsletters.

1. **Laggards** — price below cost; worst P/L first. Action from **this chain’s** upside/metrics, not a word list.
2. **Overpriced / take-profit** — long P/L and price at/above median target when targets exist.
3. **Buy opportunities** — leftover dry powder / names with cheapness + trap pass (consult **InvestmentAdvisor** if you need a full thesis).
4. Sleeve scorecard — always include `compute_sleeve_index` `all` (or each sleeve) on the same `report_date`.
5. Gaps — missing category tags, missing Yahoo, missing targets.

Then `save_aideal_newsletter` with those rows. HTML is table/`bgcolor`/hex only — never `rgba()`.

## Out of scope

- Single-name research pack / undervalued screen → **@InvestmentAdvisor**
- Ledger writes → **@Bookkeeper**
- IBKR FYI mail parse / Supabase dashboard push — **not installed** this slice; say so, do not invent a sync
- Trade execution
