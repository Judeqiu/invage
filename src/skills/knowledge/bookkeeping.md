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
4. **Never set absolute cash** — only journals: `post_opening_balance` (first open), `post_adjustment` (signed delta + memo), `transfer_cash`, `mature_deposit`, trade tools.  
5. Cash per **(channel, currency)**; wires → `transfer_cash`; FD unlock → `mature_deposit`.  
6. Reconcile: delta = statement − books; `post_adjustment` that delta with memo (document + date). **Channel walk:** `start_recon` → per sleeve `source_recon_channel` → `decide_recon_line` → `apply_recon_channel`. Completeness is `get_recon` next=done. Enabled Flex = fetch now (already-have), not skip. Never `set_cash`.  
7. Funds → `instrument=fund` + `fund_quote_source` (required).  
8. Scope: journal/reconcile/read only → valuation is **@WalletStreet**.  
9. **Brokers:** load skill **broker-integration**. IBKR is catalog `ibkr`. Quote `not_imported`. Never print the token.

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
| **@WalletStreet** | Live prices, valuation, undervalued |
| **@FinancialPlanner** | Payment plans / opportunity cost |
