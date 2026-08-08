# Bookkeeping (household books)

**Bookkeeper agent skill** — journal, reconcile, and read the books managed on the Invester host (one household ledger per user YAML). Complements Invester investment analysis; does **not** stock-pick or run market research.

Load when the user asks to:

- Record cash, deposits, holdings, property, mortgage/loans, income/expense lines  
- Reconcile cash vs trades, gaps in household books, portfolio cost vs free cash  
- Read net worth / books summary / “what’s on the books”  
- Set reporting currency, projection assumptions, or run projections to check the books  

---

## Hard rules

1. **No invented numbers.** Only tool/state values or the user’s explicit statement (then write via tools).  
2. **Fail-fast.** Missing `reporting_currency`, cash, FX, or assumptions → say what’s missing; never assume 0 or silent FX.  
3. **Tool-before-claim.** Summaries and reconciliations must use `get_household` / `get_portfolio` (and related tools) **this turn**.  
4. **Channel + currency isolation.** Free cash is one sleeve per **(channel, currency)** — e.g. `dbs/SGD` and `dbs/USD` coexist. Never overwrite SGD when setting USD on the same bank.  
5. **Cash ledger on trades.** Prefer `adjust_cash=true` (default) when cash is recorded so the books stay consistent; `adjust_cash=false` only for historical import/correction when the user says so.  
6. **Cash moves (HARD).** Same-currency bank/broker wire → `transfer_cash` only (never destination-only `set_cash`). Unlock FD → `mature_deposit` (then `transfer_cash` if wiring out). Screenshot full balance → `set_cash` absolute for that channel+currency.  
7. **Scenarios are overlays.** Projection scenarios do **not** mutate base books unless the user later posts real property/liability/cash changes. Scenarios are **not** proof of cash already paid.  
8. **Property purchase payments.** OTP / booking / S&P / PPS → `record_property_payment` so `properties[].payments` is durable. Prefer `cash_channel` to debit free cash in the same step. Cash-only `set_cash` without the payment ledger leaves “how much paid?” as UNKNOWN.  
9. **Scope.** Journal / reconcile / read only. Redirect valuation, undervalued screens, news→price, playbook setup, and themes to **@Invester**.  
10. **Still not a licensed accountant/advisor.** Educational bookkeeping on user-provided books.

---

## Books (data model)

| Block | Role |
|-------|------|
| `treasury.reporting_currency` | Household reporting currency |
| `cash` / `deposits` | Free cash (dry powder) and fixed deposits |
| `portfolio` | Investable sleeve (equity / fund / option) — cost basis on books |
| `properties[]` | Real estate marks + optional `payments[]` purchase ledger |
| `liabilities[]` | `mortgage` \| `loan` amortizing |
| `cash_flows[]` | Recurring income / expense lines |
| `projection_assumptions` | Returns, inflation, FX map |
| `scenarios[]` | Named projection overlays (not base journal) |

**Net worth (derived):** portfolio + free cash + deposit principal + property − liability principal (reporting ccy via explicit FX).

---

## Tools (Bookkeeper)

| Need | Tool |
|------|------|
| Full books + gaps | `get_household` |
| Holdings / cash / deposits read | `get_portfolio` |
| Reporting currency | `get_treasury` / `set_treasury` |
| Free cash absolute (screenshot) | `set_cash` / `clear_cash` (per channel+currency) |
| Free cash transfer (same ccy) | `transfer_cash` |
| Unlock FD → free cash | `mature_deposit` (then `transfer_cash` if moving to another channel) |
| Deposit journal | `add_deposit` / `update_deposit` / `remove_deposit` / `clear_deposits` |
| Holding journal | `add_holding` / `update_holding` / `remove_holding` / `clear_portfolio` |
| Property | `add_property` / `update_property` / `remove_property` |
| Purchase payments | `record_property_payment` (OTP/booking/PPS; optional `cash_channel`) |
| Mortgage / loan | `add_liability` / `update_liability` / `remove_liability` |
| Income / expense | `add_cash_flow` / `update_cash_flow` / `remove_cash_flow` / `list_cash_flows` |
| Assumptions | `get_projection_assumptions` / `set_projection_assumptions` |
| Scenarios / path check | `save_scenario` / `run_projection` / `compare_scenarios` / list/get/delete scenario |
| Audit snapshot | `save_snapshot` / list-read snapshot tools if available |

Always pass channel user id from context (`telegram_user_id` / `slack_user_id` / `user_slug`).

---

## Recipes

### Journal (record)

1. Resolve user from context; never ask for ids.  
2. `get_household` and/or `get_portfolio` before mutating when books may already exist.  
3. Write only what the user stated (cash amount, trade, salary line, mortgage, etc.).  
4. **Cash movement:**  
   - “Transferred X USD A→B” → `transfer_cash` (same currency).  
   - “Withdrew / matured FD” → `mature_deposit`; if then wired elsewhere → `transfer_cash`.  
   - “App shows cash = X” → `set_cash` absolute for that channel+currency.  
   - Never credit destination only for a transfer. Never invent FX.  
5. **Condo OTP / downpayment / booking:** `add_property` if missing, then `record_property_payment` with date/amount/label and `cash_channel` when the cash came from free cash.  
6. Confirm back with tool output (amounts, channel/currency slots, ids, paid_to_date).  

### Repair one-leg transfer / double-count

If free cash was inflated (e.g. destination `set_cash` without debiting source):

1. Prefer **absolute balances from bank/broker UI**: `set_cash` per `(channel, currency)` + `update_deposit(..., adjust_cash=false)` for true FD principal.  
2. **Do not** `mature_deposit` on top of an already-credited destination for the same physical move (double free cash).  
3. After fix, summarize every free-cash slot from tools.

### Reconcile broker screenshot → holdings (funds / unit trusts)

When the user pastes or screenshots real positions and books have placeholders or wrong lots:

1. **Read first.** `get_portfolio` this turn — list channel lots you will change.  
2. **Classify every line as fund vs equity** before any write. Bank unit trusts, MMF, robo, open-end 基金, product codes → `instrument=fund`. Never equity.  
3. **Always for funds:**
   - `instrument=fund`
   - `fund_quote_source=manual` (unless a true Yahoo-listed ETF ticker)
   - `fund_quote_source` is **required** — no default; omitting fails
   - `mark` = live NAV or **market value per unit** from the screenshot (if only totals are shown, use `units=1`, `avg_price=implied cost total`, `mark=market value total`)
   - `avg_price` = cost per unit (or total cost when `units=1`)
   - `channel` = broker (e.g. `ocbc`, `tiger`)
   - optional `fund_name` = full product label from the app
   - short stable `ticker` code without spaces (e.g. `EASTSPRING-ASB`); full name goes in `fund_name`
4. **Corrections / import (no cash movement):** `adjust_cash=false` on **every** remove/add/update. Default cash ledger will otherwise try to debit free cash and fail when dry powder is smaller than the lot.  
5. **Numbers:** pass **JSON numbers** (`19340.22`). Thousand-separator strings from screenshots are coerced, but never invent unit counts. Do not pass a separate `currency` field on `add_holding` (holdings have no currency slot — put SGD/USD in `fund_name` / category if needed).  
6. **Replace placeholders:** `remove_holding` each synthetic lot (`adjust_cash=false`), then `add_holding` each real fund (`adjust_cash=false`). Do **not** claim removals/adds succeeded until tool results say so.  
7. **Batch discipline:** prefer one fund at a time (or small batches). After the last write, `get_portfolio` again and report only tool-backed keys/values. If a tool returns an error, quote the error and stop inventing diagnoses (“parse error”) without the tool text.  
8. **Never** leave books half-fixed without telling the user which keys still wrong (e.g. removed 1 of 3 placeholders).

### Reconcile

1. `get_household` — list **gaps**.  
2. `get_portfolio` — cash by channel, holdings, deposits.  
3. Check consistency:  
   - Cash channels vs holding `channel`s  
   - Deposits not double-counted as free cash  
   - Property ↔ `mortgage_id` / liability `property_id` links  
   - Recurring cash_flows vs stated lifestyle (missing income/expense)  
   - Placeholder fund lots (1 unit @ total balance, code like OCBCUT) vs live product names from screenshots  
4. Propose **one** concrete fix at a time when ambiguous; when the user already gave live screenshot numbers, apply the fund recipe above and verify with tools.

### Read

1. `get_household` for books summary + gaps.  
2. Optional `run_projection` when they ask multi-year path / affordability (same family-treasury rules; no invented salary/returns).  
3. Present assets vs liabilities in reporting currency; label cost-basis vs live MTM (Bookkeeper has no live quote tool — say cost basis / manual mark or ask @Invester for MTM).

---

## What not to do

- Invent balances, rates, FX, or “typical” salaries  
- Silent multi-currency conversion  
- Run undervalued screens, news analysis, or playbook interviews  
- Mutate base books when the user only asked for a hypothetical scenario  
- Claim “all removals/adds succeeded” without matching tool results  
- Book funds without `instrument=fund` + `fund_quote_source`  
- Leave `adjust_cash=true` on pure screenshot corrections when cash would go negative

---

## Related

| Skill / agent | When |
|---------------|------|
| `family-treasury` | Multi-year projection / affordability detail on the same books |
| **@Invester** | Live prices, valuation, undervalued discovery, investment playbook, market research |
