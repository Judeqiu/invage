# Family Treasury & Projections

**Invester skill** for household books and **deterministic** multi-year projections (cash flow, net worth path, house affordability). Complements portfolio tools — does not replace investment-analysis.

Load when the user asks about:

- Family / household net worth including home and mortgage  
- Recurring salary, rent, school fees, living expenses  
- Cash flow over N years (e.g. 5 years)  
- “Can we afford to buy a house?” / down payment / mortgage scenarios  
- Projection assumptions (returns, inflation, FX)

---

## Hard rules

1. **No invented numbers.** Salary, expense, property value, mortgage rate, FX, portfolio return — only from tools/state or the user’s explicit statement (then write via tools).  
2. **Fail-fast.** Missing `reporting_currency`, assumptions, cash, or FX → say what’s missing; do not assume 0 cash or 5% returns.  
3. **Tool-before-claim.** Affordability verdict and projected paths must come from `run_projection` / `compare_scenarios` in this turn.  
4. **Scenarios are overlays.** `save_scenario` / inline events do **not** change base books unless the user later adds property/liability for real.  
5. **Deposits stay locked** until maturity (principal only at maturity in projections).  
6. **Do not auto-inflate** expense lines; inflation assumption is transparency only in v1.  
7. **Still Invester** — not a licensed advisor; educational/planning framing.  
8. **SG stamp duties / comps / yield** — when stamp duty or comps affect affordability cash need, also load `sg-real-estate-portfolio` and verify duties this turn before inventing `one_off` amounts. Do not invent ABSD/BSD/SSD from memory.

---

## Data model (user YAML)

| Block | Role |
|-------|------|
| `treasury.reporting_currency` | Household reporting ccy |
| `properties[]` | Real estate manual marks |
| `liabilities[]` | `mortgage` \| `loan` amortizing |
| `cash_flows[]` | Recurring income/expense |
| `projection_assumptions` | Returns, inflation, FX map, optional cash_buffer |
| `scenarios[]` | Named event overlays |
| Existing | `portfolio`, `cash`, `deposits`, `playbook` |

**Net worth (derived):**  
portfolio + free cash + deposit principal + property − liability principal  
(all in reporting currency via explicit FX).

---

## Tools

| Need | Tool |
|------|------|
| Full household summary + gaps | `get_household` |
| Reporting currency | `get_treasury` / `set_treasury` |
| Property | `add_property` / `update_property` / `remove_property` |
| Mortgage / loan | `add_liability` / `update_liability` / `remove_liability` |
| Income / expense lines | `add_cash_flow` / `update_cash_flow` / `remove_cash_flow` / `list_cash_flows` |
| Projection inputs | `get_projection_assumptions` / `set_projection_assumptions` |
| Scenarios | `save_scenario` / `get_scenario` / `list_scenarios` / `delete_scenario` |
| Run path | `run_projection` (`horizon_months`, optional `scenario_id` / `events`, optional `portfolio_value`) |
| Base vs house | `compare_scenarios` |

Always pass channel user id from context (`telegram_user_id` / `slack_user_id` / `user_slug`).

**FX:** `projection_assumptions.fx.USD = 1.35` means 1 USD = 1.35 units of reporting currency.

**Portfolio value:** pass `portfolio_value` in reporting ccy when you have live MTM (e.g. from analyzer); else tool uses **cost basis** and labels it.

---

## Recipes

### Setup (first time)

1. `set_treasury` reporting_currency  
2. `set_cash` if missing  
3. `add_cash_flow` for major income/expenses  
4. `add_property` + `add_liability` kind=mortgage if home owned  
5. `set_projection_assumptions` (return %, inflation %, fx as needed)  
6. `get_household` to confirm gaps  

Ask **one** clarification only when the decision cannot proceed (e.g. house price missing). Do not run a long interview for pure portfolio research.

### Net worth now

1. `get_household`  
2. Optional: `portfolio_analyzer` / live marks → `run_projection` not required  
3. Present assets vs liabilities in reporting ccy; list gaps  

### Cash flow in 5 years

1. Ensure treasury + assumptions + cash + cash_flows  
2. `run_projection` horizon_months=60 (optional portfolio_value)  
3. Report end NW, min free cash month, shortfall months, year-end snapshots  

### Can we buy house X?

1. Collect (from user or tools): price, currency, down payment, purchase date, mortgage rate/term, extra post-buy expense if any  
2. `save_scenario` or inline `events`:
   - `buy_property` + optional `mortgage`  
   - `one_off` for stamp duty/fees  
   - `add_expense` for maintenance/tax  
3. `compare_scenarios` base vs scenario  
4. Report **Affordability: AFFORDABLE | TIGHT | NOT_AFFORDABLE | UNKNOWN** with peak cash need, min cash, shortfall months  
5. Never say AFFORDABLE without tool output  

---

## Affordability meanings

| Verdict | Meaning |
|---------|---------|
| AFFORDABLE | No liquidity shortfall; post-buy monthly net CF &gt; 0 (and ≥ cash_buffer if set) |
| TIGHT | No shortfall but thin surplus / below buffer |
| NOT_AFFORDABLE | Shortfall month(s) or cash goes negative at purchase |
| UNKNOWN | Missing books/assumptions/FX |

---

## What not to do

- Invent salary or “typical” mortgage rates  
- Silent FX conversion  
- Treat fixed deposits as free cash  
- Mutate base books when only running a scenario  
- Replace investment-analysis for stock valuation  

---

## Related

| Skill | When |
|-------|------|
| `sg-real-estate-portfolio` | SG stamp duties, HDB comps, yield/LTV/mark quality, second-property ABSD, physical vs REIT allocation — **load together** with this skill for SG buy / second property with policy cost |
| `investment-analysis` | Stocks, portfolio 3-axis, undervalued, news path, REIT securities |
| `playbook-setup` | Investment methodology wizard |
| `bindrive` | Saving HTML reports |
