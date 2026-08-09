# Payment planning & cash efficiency (FinancialPlanner)

**FinancialPlanner package skill** — short index. Full durable playbook lives in **agent KB** (`data/kb/agents/financial-planner.yaml`).

Load when the user asks for payment plans, best paydown path, minimize interest, avalanche vs snowball, cash vs FD vs debt, emergency reserve, or forgone-yield tradeoffs.

## Agent KB first (utarus ≥ beta.9)

Before deep recipes, call:

- `search_kb` query like `optimize` / `opportunity cost` / `avalanche` / `funding waterfall` / `forgone yield`
- or `list_kb` scope=`agent` then `get_kb`

Seeded agent entries cover: hard rules, HARD vs SOFT costs, strategies, tools map, payment recipes.

## Hard rules (always)

1. Books first — `get_household` + `get_portfolio` this turn.  
2. **Never invent yields** (no “~3% balanced funds”).  
3. **Best plan = combination search** — call `optimize_payment_plan` (strategy × emergency × extra monthly). Do not recommend a single config from intuition.  
4. `build_payment_plan` only for one **pinned** config after optimize (or when user forbids search).  
5. SOFT cost only via `estimate_opportunity_cost` — **never mixed** into HARD ranking.  
6. Separate **HARD** (debt interest, stated fees) vs **SOFT** (forgone yield × years).  
7. Never auto-sell investments; never invent FD break penalties.  
8. Property paid_to_date from `properties[].payments` only (not scenarios).

## Optimize shape

```
optimize_payment_plan
  # default axes: strategies=avalanche+snowball, emergency=none/3/6, extra=books surplus
  strategies=[avalanche, snowball]          # optional override
  emergency_months_candidates=[0,3,6]       # optional; 0 = no reserve
  extra_monthly_candidates=[500,1000,...]   # optional; only amounts user can fund
  currency=... max_months=...
```

Objective: min HARD `total_interest` → then fastest `months_to_debt_free` → then lower `total_paid`.

Present: ranked table + recommended best + interest saved vs worst / #2.

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
| **@InvestmentAdvisor** | Securities thesis (not paydown) |
