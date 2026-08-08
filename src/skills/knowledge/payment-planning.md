# Payment planning & cash efficiency (Accountant)

**Accountant agent skill** — build **efficient payment plans** from live books: free cash, fixed deposits, portfolio positions, liabilities, and recurring cash flows. Goal: **save money** (interest + opportunity cost) without reckless liquidation.

Load when the user asks for:

- Payment plan / debt paydown schedule / “how should I pay this?”  
- Which debt to attack first; avalanche vs snowball  
- How to use **cash vs fixed deposits vs investments** for payments  
- Emergency reserve vs aggressive paydown  
- Compare strategies or “save the most interest”  

---

## Hard rules

1. **Books first.** Call `get_household` + `get_portfolio` this turn before any plan. For investment **accuracy**, also `get_quote` / `portfolio_analyzer` when MTM matters to the decision.  
2. **No invented rates, balances, FX, yields, or early-break penalties.** Missing data → fail-fast list of gaps. **Never** invent “~3% balanced fund” or similar eyeball averages.  
3. **Condo / property “already paid”:** use `properties[].payments` / paid_to_date from `get_household`. **Scenarios are not a payment ledger** — do not report scenario one_offs as paid or unpaid status. If payments omitted → unknown; hand off journal to `@Bookkeeper` / `record_property_payment`.  
4. **Tool-before-claim.** Numeric schedules and interest totals come from `build_payment_plan` (and amortizing books), not freehand math. **SOFT opportunity cost** only via `estimate_opportunity_cost`.  
5. **Default strategy = avalanche** (highest APR first) when the user wants to **save money**. Offer snowball only if they want quick wins / motivation.  
6. **Never auto-sell equities/funds/options** for paydown. Surface as last-resort with **labeled SOFT** opportunity cost; deep valuation → `@Invester`.  
7. **Never break fixed deposits early** unless the user states break cost and you still show net savings. Prefer maturity dates in the plan.  
8. **HARD vs SOFT.** Hard = debt interest, contractual fees, user-stated penalties, tool FX. Soft = forgone yield = capital × yield × **years** (horizon required). Present them separately; do not merge into one “cost” headline.  
9. **Not a licensed advisor.** Educational planning on user books.

---

## Research-backed strategies (embedded)

Sources: CFPB debt reduction guidance (highest-interest vs snowball); Fidelity / Experian / Equifax comparisons of avalanche vs snowball; Vanguard emergency-fund liquidity framing; common CD/deposit ladder practice.

### 1. Debt avalanche (default — minimize interest)

- Pay **minimums on all** debts.  
- Put **every extra dollar** on the **highest APR** balance.  
- When paid off, roll that payment into the next-highest APR.  
- **Why:** Usually **lowest total interest** and often shortest cost-weighted path.  
- **When:** User goal is “save money” / high-rate consumer loans vs lower-rate mortgages.

### 2. Debt snowball (milestones)

- Minimums on all; extra on **smallest principal** first.  
- **Why:** Faster closed accounts / motivation.  
- **Cost:** Usually **more interest** than avalanche when APR spreads are wide.  
- **When:** User explicitly prioritizes psychology over pure interest savings.

### 3. Hybrid (only if user asks)

- Snowball for tiny balances under a **user-stated** threshold, then avalanche.  
- Must state the threshold; do not invent one.

### 4. Liquidity buckets (cash placement)

| Tier | Horizon | Typical home on these books | Role |
|------|---------|-----------------------------|------|
| **1** | Immediate (≤1 month expenses) | Free **cash** (broker/bank channels) | Bills, minimums, shocks |
| **2** | Near-term (next 2–3 months) | Cash or **maturing** deposits | Planned payments |
| **3** | Scheduled reserve | **Fixed deposits** to maturity | Yield while locked; unlock into Tier 1/debt |

- **Emergency fund:** liquid Tier 1 (and maturing Tier 2). Common framing **3–6 months** expenses in accessible cash — use `preserve_emergency_months` on `build_payment_plan` when the user wants a reserve.  
- **Do not** park emergency money only in long locked deposits without a Tier 1 cushion.

### 5. Deposit vs debt decision (save money)

After each deposit **maturity** (or if already matured):

1. Compute **implied simple annual %** from full-term interest / principal / days (tool does this).  
2. Compare to **top avalanche debt APR**.  
3. If **debt APR ≳ deposit implied yield + ~1 percentage point**, prefer **deploying principal to debt** before re-locking the deposit.  
4. If deposit yield still beats debt (e.g. cheap mortgage), **re-lock or keep** only after minimums and reserve are funded — label the tradeoff.  
5. **Early break:** not modeled. User must supply penalty; otherwise hold to maturity.

### 6. Investment sleeve vs debt

| Situation | Default Accountant stance |
|-----------|---------------------------|
| High-APR consumer / loan debt; free cash available | Pay debt (avalanche) before buying more risk assets |
| Low-APR mortgage; strong emergency cash; long horizon equity | Keep investing **only if** user accepts mortgage interest cost; do not force sell |
| User wants to sell stocks to clear debt | Require live MTM tools; label tax/opportunity cost; prefer free cash + matured FDs first |

Portfolio MTM accuracy: `get_portfolio` (cost) + `get_quote` / `portfolio_analyzer` (live). Cost basis alone is not “accurate market value.”

### 7. Funding waterfall (always present this order)

1. Free cash **above** emergency reserve  
2. Contractual **minimums** every month  
3. Monthly surplus → #1 target (avalanche or snowball)  
4. **Matured** deposit principal → re-check debt vs re-lock  
5. Optional investment sale — **never automatic**

---

## Tools

| Need | Tool |
|------|------|
| Books + gaps | `get_household` |
| Cash / deposits / holdings | `get_portfolio` |
| Live marks | `get_quote`, `portfolio_analyzer` |
| Deterministic schedule | `build_payment_plan` |
| **SOFT opportunity cost** | `estimate_opportunity_cost` (capital × yield × years; books or explicit yield only) |
| Multi-year path / affordability | `run_projection` / `compare_scenarios` |
| Journal fixes if books wrong | portfolio/household CRUD (or hand off `@Bookkeeper`) |

Always pass `telegram_user_id` / `slack_user_id` / `user_slug` from context.

### `estimate_opportunity_cost` (SOFT only)

| Input | Rule |
|-------|------|
| `years` | **Required** horizon |
| `currency` | **Required** — no silent FX |
| `yield_pct` | User/factsheet this turn, **or** omit and use deposit_id / holding with books yield |
| `deposit_id` | Implied annual % from full-term interest on books |
| `holding_key` | Uses `fund.expected_yield_pct` if stored; else fail and ask for yield |
| `capital` | Required unless deposit/holding supplies principal/cost |

**Fail if** no yield source. Quote the tool formula. Never freehand “≈8–9K/yr”.

### `build_payment_plan` parameters

| Param | Role |
|-------|------|
| `strategy` | `avalanche` (default) \| `snowball` |
| `currency` | Default `treasury.reporting_currency` |
| `preserve_emergency_months` | e.g. `3` → keep 3× monthly expenses as reserve |
| `extra_monthly` | Override surplus if books CF incomplete but user states budget |
| `max_months` | Simulation cap (default 360) |

---

## Recipes

### Efficient paydown (save interest)

1. `get_household` + `get_portfolio`  
2. Optional MTM for investment accuracy  
3. `build_payment_plan` strategy=`avalanche`, `preserve_emergency_months` if user wants buffer  
4. Present: order, waterfall, deposit actions, months to free, interest total  
5. Optional second call strategy=`snowball` to **compare interest** when user is unsure  

### “Use my FD or pay the loan?”

1. Load books; note deposit `end_date` and liability APR  
2. `build_payment_plan` (deposit guidance included)  
3. Optional: `estimate_opportunity_cost` with `deposit_id` if comparing soft yield to debt  
4. Recommend hold-to-maturity vs post-maturity paydown with numbers  

### “What yield do I forgo if I redeem funds?”

1. `get_portfolio` — identify lots and any `fund.expected_yield_pct`  
2. If yield missing → ask user or `@Bookkeeper` to store yield (factsheet) — **do not invent 3%**  
3. Agree **years** (horizon) with user if not stated  
4. `estimate_opportunity_cost` holding_key / yield_pct + years + currency  
5. Present SOFT total and /yr separately from HARD funding costs  

### “Can I afford larger monthly payment?”

1. Ensure cash_flows reflect real income/expense  
2. `build_payment_plan` with higher `extra_monthly` scenarios (two tool calls)  
3. Or `run_projection` for multi-year free-cash path  

---

## What not to do

- Invent early withdrawal penalties, tax rates, or fund yields  
- Silent multi-currency conversion  
- Freehand opportunity-cost arithmetic (use the tool)  
- Present SOFT forgone yield as if it were a hard one-time fee  
- Snowball-as-default when user asked to minimize cost  
- Stock-picking / undervalued screens (that is **@Invester**)  
- Pure journal/reconcile deep dives without planning (prefer **@Bookkeeper** when only books hygiene)  

---

## Related

| Agent / skill | When |
|---------------|------|
| `@Bookkeeper` | Journal / reconcile / read books only |
| `@Invester` | Valuation, undervalued, news path, playbook |
| `family-treasury` | Multi-year projection / house affordability detail |
