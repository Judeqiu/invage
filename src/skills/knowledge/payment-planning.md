# Payment planning & cash efficiency (Accountant)

**Accountant package skill** — short index. Full durable playbook lives in **agent KB** (`data/kb/agents/accountant.yaml`).

Load when the user asks for payment plans, avalanche vs snowball, cash vs FD vs debt, emergency reserve, or forgone-yield tradeoffs.

## Agent KB first (utarus ≥ beta.9)

Before deep recipes, call:

- `search_kb` query like `opportunity cost` / `avalanche` / `funding waterfall` / `forgone yield`
- or `list_kb` scope=`agent` then `get_kb`

Seeded agent entries cover: hard rules, HARD vs SOFT costs, strategies, tools map, payment recipes.

## Hard rules (always)

1. Books first — `get_household` + `get_portfolio` this turn.  
2. **Never invent yields** (no “~3% balanced funds”).  
3. Schedules from `build_payment_plan`; SOFT cost only via `estimate_opportunity_cost`.  
4. Default **avalanche**; snowball only if user wants quick wins.  
5. Separate **HARD** (debt interest, stated fees) vs **SOFT** (forgone yield × years).  
6. Never auto-sell investments; never invent FD break penalties.  
7. Property paid_to_date from `properties[].payments` only (not scenarios).

## Minimum opportunity-cost shape

```
estimate_opportunity_cost
  years=<horizon> currency=<SGD|USD>
  yield_pct=<user/factsheet>   # OR holding_key with fund.expected_yield_pct OR deposit_id
  capital=<amount>             # optional if deposit/holding supplies it
```

Fail if no yield source — ask user or `@Bookkeeper` to store yield on the fund.

## Related

| Resource | When |
|----------|------|
| Agent KB (`search_kb`) | Full strategies / recipes for this persona |
| `family-treasury` skill | Multi-year path / affordability |
| **@Bookkeeper** | Journal / import / yield field writes |
| **@Invester** | Valuation / undervalued |
