# Fixed Deposits Design

**Date:** 2026-07-29  
**Status:** Approved (design)  
**Scope:** Record fixed deposits under broker channel; show on dashboard; principal in NAV, not free cash.

---

## Decisions

| Topic | Choice |
|-------|--------|
| NAV | Principal counts in total NAV; **not** free / deployable cash |
| Interest | Principal + **total interest amount** over the term (no rate field) |
| Multiplicity | Multiple deposits per channel; each has a stable `id` |
| Valuation (v1) | NAV uses **principal only**; interest is display metadata |
| Storage | Top-level `deposits` array on user YAML (sibling of `cash` / `portfolio`) |

---

## Data model

```yaml
# optional — omit when none
deposits:
  - id: fd-jude_futu-20260701      # unique across user
    channel: jude_futu             # optional; omit = unassigned → dashboard "default"
    amount: 50000                  # principal ≥ 0
    interest: 875                  # full-term interest ≥ 0
    currency: USD                  # required 3–4 letter; no silent default
    start_date: "2026-07-01"       # YYYY-MM-DD
    end_date: "2027-01-01"         # YYYY-MM-DD, must be ≥ start_date
    label: "6M bank TD"            # optional
    updated_at: "2026-07-29"       # YYYY-MM-DD last mutation
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Unique across all deposits for the user |
| `channel` | no | Same semantics as cash/holdings |
| `amount` | yes | Principal |
| `interest` | yes | Full-term interest $ (not annual rate) |
| `currency` | yes | Fail-fast if multi-currency sum needed |
| `start_date` / `end_date` | yes | Fail if end &lt; start |
| `label` | no | Free text |
| `updated_at` | yes | Set on write |

**NAV (v1):**

```
totalNav = positionsMTM + freeCash? + sum(deposit.amount)
```

Free-cash tools, cash weight vs playbook target (deployable sense), and short-put cover **ignore** deposits.

---

## Tools

Channel-bound like portfolio tools. Fail-fast, no silent defaults.

| Tool | Behavior |
|------|----------|
| `add_deposit` | Create one FD. If `id` omitted, auto-build unique `fd-{channel\|default}-{start_date}-{n}`. Requires amount, interest, currency, start_date, end_date. Optional channel, label. |
| `update_deposit` | Patch by `id` (amount, interest, currency, dates, channel, label). Missing/unknown `id` fails. |
| `remove_deposit` | Delete by `id`. |
| `get_portfolio` | Prints a **DEPOSITS** section (principal, interest, term, channel, days remaining). |
| `clear_deposits` | Remove all, or filter by `channel` when set (requires `confirm: true`). |

No separate `list_deposits` — `get_portfolio` is enough.

### Cash ledger (`adjust_cash`)

Same idea as holdings: locked principal leaves free cash.

| Action | Default cash impact (`adjust_cash` true) |
|--------|------------------------------------------|
| `add_deposit` | **−** principal on matching channel cash slot |
| `update_deposit` amount change | **±** delta on matching channel |
| `remove_deposit` | **+** principal back (interest **not** auto-credited in v1) |
| `adjust_cash=false` | Skip ledger (import / correction) |

Rules reused from cash:

- Cash unknown → no invent; note to `set_cash` first
- Wrong channel slot → fail fast (list recorded channels)
- Would go negative → fail fast
- Deposit currency must match cash slot currency when ledger runs

### Validation (fail fast)

- `amount` / `interest` finite, ≥ 0
- `end_date ≥ start_date`
- Duplicate `id` on add → fail
- Unknown `id` on update/remove → fail
- Channel normalize: empty/omit → unassigned (dashboard `default`)

### Agent guidance

In investment-analysis knowledge: FDs are **NAV assets, not dry powder**. Strategy sizing uses free cash only; deposit principal is locked until end date / remove.

---

## Dashboard

### Live model

Extend `LiveDashboardSlice` and `ChannelTotals`:

| Field | Meaning |
|-------|---------|
| `deposits: DepositRow[]` | FDs in the current slice |
| `depositsAmount` | Sum of principals in slice |
| `depositsCurrency` | When all share one currency; fail if mixed on NAV sum path |
| `depositCount` | Count |
| `totalValue` | `positionsValue + cashAmount? + depositsAmount` |

`DepositRow`:

```ts
{
  id: string;
  label?: string;
  channel: string;          // resolved; unassigned → "default"
  amount: number;           // principal (NAV)
  interest: number;         // full-term interest (display)
  currency: string;
  start_date: string;
  end_date: string;
  daysRemaining: number;    // max(0, end − today)
  matured: boolean;         // end_date < today
}
```

### Channel filter

- **All (merged):** every deposit; sum principals (same-currency only).
- **Single channel:** deposits for that channel (unassigned → `default`).
- Channel picker includes channels that only have deposits.

### WebUI

1. **Summary card** when any FD exists: principal total, count, interest at maturity total; matured badge when applicable.
2. **Allocation:** one aggregated **Fixed deposits** segment in v1 (per-row detail in table).
3. **Deposits table:** id/label · channel · principal · interest · start → end · days left.
4. **NAV line:** `positions MTM + cash + deposits`. Free-cash weight still uses free cash only.

### Snapshots / history (v1)

- Full FD detail on **live** dashboard only.
- Snapshot JSON history of deposits: deferred (known gap).
- HTML `save_report kind=dashboard` uses live model fields when present.

### Strategy metrics

```
totalNav = positions + freeCash? + depositsPrincipal
cashWeightPct = freeCash / totalNav   // deposits not free cash
deployable = freeCash only
```

---

## Errors

| Case | Behavior |
|------|----------|
| Missing amount / interest / currency / dates | Throw with field name |
| end &lt; start | Throw |
| Duplicate id on add | Throw |
| Unknown id on update/remove | Throw |
| `adjust_cash` true, no cash for channel | Fail with recorded channel list |
| Insufficient free cash | Fail with have/need amounts |
| Deposit currency ≠ cash currency on ledger | Fail (no silent FX) |
| Mixed currencies when summing NAV deposits | Fail (same rule as multi-cash) |

---

## Tests (minimum)

- portfolio-state: assert/normalize deposits; multi per channel; unique id
- tools: add → ledger debit; remove → credit principal; `adjust_cash=false` import
- dashboard-model: principal in totalValue; channel filter; free cash weight excludes deposits
- dashboard-webui smoke: deposits present in API payload shape

---

## Out of scope (v1)

- Interest accrual / pro-rata MTM into NAV
- Auto-maturity (roll to cash on end_date)
- Interest auto-credit on remove (only principal returns)
- Snapshot history of deposits
- FX conversion
- Closed enum of banks/products

---

## Implementation touchpoints

| Area | Files (expected) |
|------|------------------|
| State | `src/state/portfolio-state.ts` — types, get/set/normalize deposits |
| Tools | `src/tools/portfolio.ts` — add/update/remove/clear_deposit(s); extend get_portfolio |
| Dashboard model | `src/report/dashboard-model.ts` — NAV + DepositRow + channel totals |
| Dashboard data/API | `src/webapp/dashboard-data.ts` |
| WebUI | `webui/dashboard/app.js`, `index.html` |
| Docs | `docs/data-model.md`, `src/skills/knowledge/investment-analysis.md` |
| Tests | `tests/portfolio-state.test.ts`, dashboard tests, tool coverage |

---

## Docs updates after implement

1. `docs/data-model.md` — Layer 3c Fixed Deposits
2. `src/skills/knowledge/investment-analysis.md` — FD = NAV not dry powder + tool table
