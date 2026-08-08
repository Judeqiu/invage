# Bookkeeping (household books)

**Bookkeeper package skill** — short index. Full durable playbook lives in **agent KB** (`data/kb/agents/bookkeeper.yaml`).

Load when the user asks to journal, reconcile, or read books (cash, deposits, holdings, property, gaps).

## Agent KB first (utarus ≥ beta.9)

Before deep recipes, call:

- `search_kb` query like `fund reconcile` / `cash transfer` / `hard rules` (omit scope → private + **this agent** + shared)
- or `list_kb` with `scope=agent` then `get_kb` for full body

Seeded agent entries cover: hard rules, tools map, cash/deposit recipes, fund screenshot reconcile, reconcile/read.

## Hard rules (always)

1. No invented numbers — tools/state or user statement only.  
2. Fail-fast — never silent 0 cash or FX.  
3. Tool-before-claim — `get_household` / `get_portfolio` this turn.  
4. Cash per **(channel, currency)**; wires → `transfer_cash`; FD unlock → `mature_deposit`.  
5. Import/screenshot corrections → `adjust_cash=false`.  
6. Funds → `instrument=fund` + `fund_quote_source` (required).  
7. Scope: journal/reconcile/read only → valuation is **@Invester**.

## Minimum fund correction shape

```
add_holding ticker=CODE instrument=fund fund_quote_source=manual
  mark=<NAV> avg_price=<cost> units=1 channel=<broker>
  adjust_cash=false fund_name="… (SGD|USD)"
```

Optional yield (all three or omit): `expected_yield_pct` + `yield_basis` + `yield_as_of`.

## Related

| Resource | When |
|----------|------|
| Agent KB (`search_kb`) | Full recipes / playbook for this persona |
| `family-treasury` skill | Multi-year projection detail |
| **@Invester** | Live prices, valuation, undervalued |
| **@Accountant** | Payment plans / opportunity cost |
