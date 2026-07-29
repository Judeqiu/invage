# Family Treasury Accountant — Design

**Date:** 2026-07-29  
**Status:** Approved (design)  
**Scope:** Extend Invage (Invester) from pure portfolio analyst to support **household books** and a **deterministic financial projection model** for decisions such as house affordability and multi-year cash flow — without rebranding or replacing investment analysis.

---

## Problem

Invage today is strong at:

- Portfolio CRUD (equity / fund / option)
- Free cash + multi-broker `channel`
- Fixed deposits (principal in NAV, not dry powder)
- Investment playbook + 3-axis analysis + snapshots/dashboard

It cannot honestly answer:

- “What is our household net worth including home and mortgage?”
- “What is cash flow over the next 5 years?”
- “Can we afford to buy this house?”

Those questions need **liabilities**, **recurring income/expense schedules**, **non-market property**, **explicit projection assumptions**, and a **deterministic engine** — not LLM narrative alone.

---

## Goals

1. **Household ledger** on the existing single-user YAML (one books per Utarus user).
2. **Minimal decision core:** balance sheet (assets + liabilities) + recurring cash flows + projection/scenarios.
3. **Valid forward model:** every projected number traces to recorded state + explicit assumptions (no invented salary/FX/returns).
4. **Decision support:** base vs scenario (e.g. buy house), structured affordability verdict.
5. **Keep Invester identity:** treasury is additive capability; marketing/name stay investor-first.
6. **Fail-fast culture:** missing data is unknown, not zero; no silent FX or default return rates.

## Non-goals (v1)

- Full transaction ledger / PFM / bank sync  
- Tax optimization or estate planning  
- Monte Carlo / probability-of-ruin bands  
- Multi-person legal entities or ownership percentages  
- Generic non-market assets beyond **property** (cars, art, etc.)  
- Agent rebrand (“family treasury” as product name)  
- Silent multi-currency conversion  
- WebUI dashboard for treasury (phase 2; chat + tools first)

---

## Key decisions

| # | Topic | Choice | Rationale |
|---|--------|--------|-----------|
| 1 | Accounting unit | **One household ledger** | Matches “can we buy a house?”; people are labels on lines, not separate books |
| 2 | v1 scope | **Minimal decision core** | BS + recurring CF + projection; not full double-entry GL |
| 3 | Non-portfolio assets | **Property only** | Enough for house path; avoid asset catalog bloat |
| 4 | Projection method | **Deterministic schedule + named scenarios** | Auditable “accountant” model; no fake precision from MC |
| 5 | Currency | **One reporting currency + explicit FX rates** | Consistent with existing no-silent-FX policy; Asia multi-broker |
| 6 | Liabilities | **Mortgage + simple amortizing loans** | Real principal pay-down; covers house + common debt |
| 7 | Cash flows | **Recurring schedule lines** | Named income/expense streams; no per-tx history in v1 |
| 8 | Product identity | **Keep Invester; add treasury quietly** | Investor brand retained; skills expand |
| 9 | Scenarios | **On-demand runs + optional saved overlays** | Revisit decisions without forking the base books |

---

## Domain model

### Layers

```text
┌─────────────────────────────────────────────────────────┐
│  Household books (source of truth on user YAML)         │
│  • treasury.reporting_currency                          │
│  • assets: portfolio | cash | deposits | properties     │
│  • liabilities: mortgage | loan                         │
│  • cash_flows: recurring income/expense lines           │
│  • projection_assumptions                               │
│  • scenarios (optional saved overrides)                 │
│  • playbook (unchanged — investment methodology)        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Projection engine (pure function, deterministic)       │
│  books + assumptions + optional scenario → schedule     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Decision views (chat / later reports)                  │
│  net worth · N-year cash flow · house affordability     │
└─────────────────────────────────────────────────────────┘
```

### Glossary

| Term | Meaning |
|------|---------|
| **Household books** | Full financial state for the user: assets, liabilities, schedules, reporting currency, assumptions |
| **Portfolio sleeve** | Existing investable book (equities / funds / options) |
| **Property** | Non-market real-estate asset; manual mark; optional linked mortgage |
| **Liability** | Amortizing debt: `mortgage` (property-linked) or generic `loan` |
| **Cash-flow line** | Recurring income or expense (amount, currency, frequency, optional end) |
| **Assumptions** | Explicit projection inputs (portfolio return, inflation, FX, property growth) |
| **Scenario** | Named overlay of assumption overrides + dated events (does not mutate base books) |
| **Projection** | Deterministic multi-period schedule from books + assumptions [+ scenario] |

### What does not change

- Utarus identity, channels, BinDrive, invites  
- Portfolio / cash / deposits tools and multi-`channel` semantics  
- Investment playbook + 3-axis analysis + existing skills for stock work  
- Agent public name: **Invester**

---

## Data model

All new fields are **optional top-level siblings** of `portfolio` / `cash` / `deposits` / `playbook` on `data/users/<slug>.yaml`.  
Missing block = empty / unknown. Tools **fail fast** when a decision requires a missing field.

### Treasury settings

```yaml
treasury:
  reporting_currency: SGD          # required once any treasury projection is used
  updated_at: "2026-07-29"         # YYYY-MM-DD
```

### Properties

```yaml
properties:
  - id: prop-home-prosperty
    label: "Prosperty 3BR"
    value: 1800000                 # manual mark ≥ 0
    currency: SGD                  # required; no silent default
    updated_at: "2026-07-29"
    mortgage_id: loan-mortgage-home  # optional; must exist in liabilities if set
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Unique across properties |
| `value` | yes | Manual mark; no live property API in v1 |
| `currency` | yes | 3–4 letter code |
| `label` | no | Display name |
| `mortgage_id` | no | Must reference a `kind: mortgage` liability |
| `updated_at` | yes | Last mutation |

### Liabilities

```yaml
liabilities:
  - id: loan-mortgage-home
    kind: mortgage                 # mortgage | loan
    principal: 1200000             # remaining principal ≥ 0
    annual_rate_pct: 3.2           # nominal annual percent
    currency: SGD
    start_date: "2026-01-01"
    term_months: 360
    payment_amount: 5200           # fixed installment per payment_frequency
    payment_frequency: monthly     # v1: monthly only (annual reserved / reject if not monthly)
    property_id: prop-home-prosperty  # required when kind=mortgage
    label: "Home mortgage"
    updated_at: "2026-07-29"
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Unique across liabilities |
| `kind` | yes | `mortgage` \| `loan` |
| `principal` | yes | Remaining principal |
| `annual_rate_pct` | yes | ≥ 0 |
| `currency` | yes | No silent default |
| `start_date` | yes | YYYY-MM-DD |
| `term_months` | yes | Integer ≥ 1 |
| `payment_amount` | yes* | *Or omit only when tool is asked to **compute** payment from principal/rate/term; stored after compute |
| `payment_frequency` | yes | v1: `monthly` only |
| `property_id` | if mortgage | Must exist in `properties` |
| `label` | no | Free text |

**Amortization rule (v1, fixed, documented in code + skill):**

- Monthly rate \( r = \text{annual_rate_pct} / 100 / 12 \)
- Level payment; each period: interest = principal × r; principal pay-down = payment − interest  
- If user supplies `payment_amount` that disagrees with the standard annuity payment for (principal, r, remaining term) beyond a small absolute/relative tolerance → **fail** and report the computed payment (no silent rewrite)

### Cash-flow lines

```yaml
cash_flows:
  - id: cf-salary-jude
    kind: income                   # income | expense
    amount: 12000
    currency: SGD
    frequency: monthly             # monthly | annual
    start_date: "2026-01-01"
    end_date: null                 # null / omit = open-ended
    label: "Salary — Jude"
    category: employment           # free-text tag
    updated_at: "2026-07-29"
  - id: cf-school
    kind: expense
    amount: 2000
    currency: SGD
    frequency: monthly
    start_date: "2026-01-01"
    label: "School fees"
    category: family
    updated_at: "2026-07-29"
```

| Field | Required | Notes |
|-------|----------|--------|
| `id` | yes | Unique across cash_flows |
| `kind` | yes | `income` \| `expense` |
| `amount` | yes | ≥ 0 |
| `currency` | yes | No silent default |
| `frequency` | yes | `monthly` \| `annual` (annual hits anniversary month of start_date) |
| `start_date` | yes | Inclusive |
| `end_date` | no | Inclusive last active month if set; must be ≥ start |
| `label` | no | Display / person label |
| `category` | no | Grouping tag |
| `updated_at` | yes | Last mutation |

**No per-transaction history in v1.** One-off cash moves use scenario events or existing cash tools (`set_cash` / ledger via holdings).

### Projection assumptions

```yaml
projection_assumptions:
  portfolio_return_annual_pct: 5.0
  inflation_annual_pct: 2.0
  property_appreciation_annual_pct: 0    # optional; omit = treat as 0 only if key present? → see fail-fast
  fx:                                    # units of reporting currency per 1 unit of foreign
    USD: 1.35                            # if reporting_currency=SGD: 1 USD = 1.35 SGD
    HKD: 0.17
  updated_at: "2026-07-29"
```

**Fail-fast for projection runs:**

| Required for run | If missing |
|------------------|------------|
| `treasury.reporting_currency` | Fail |
| `portfolio_return_annual_pct` | Fail (no default invent) |
| `inflation_annual_pct` | Fail |
| `fx[CCY]` for every non-reporting currency appearing in books/scenario | Fail naming the missing pair |
| Property marks / liability principals used in BS | Fail if property exists without value/currency |

`property_appreciation_annual_pct`: if omitted, engine uses **0** only when the key is explicitly allowed as optional in schema — **prefer require the full assumptions object once `set_projection_assumptions` has been used**; first-time users must set all required numeric fields via tool (no silent 5% return).

### Saved scenarios (overlays)

```yaml
scenarios:
  - id: sc-buy-house-2028
    label: "Buy house 2028"
    updated_at: "2026-07-29"
    assumption_overrides:
      portfolio_return_annual_pct: 4.0
    events:
      - type: buy_property
        date: "2028-06-01"
        property_value: 2000000
        currency: SGD
        down_payment: 500000
        label: "New home"
        mortgage:
          annual_rate_pct: 3.5
          term_months: 360
          # payment_amount optional → engine computes annuity payment
      - type: add_expense
        date: "2028-06-01"
        amount: 800
        currency: SGD
        frequency: monthly
        label: "Property tax/maint"
      - type: one_off
        date: "2028-06-01"
        amount: -50000             # signed in event currency; − = cash out
        currency: SGD
        label: "Stamp duty / fees"
```

**Scenario event types (v1):**

| `type` | Effect on projection path |
|--------|---------------------------|
| `buy_property` | Add property mark; reduce free cash by down_payment (+ one_off fees if separate); open mortgage liability for (value − down_payment) unless full cash buy |
| `add_expense` / `add_income` | Inject recurring line from `date` forward |
| `one_off` | Single cash delta in that month |
| `set_assumption` | Prefer `assumption_overrides` map instead |

Scenarios **never** write through to base `properties` / `liabilities` / `cash_flows` unless the user later applies a separate “commit scenario” action (**out of v1** — v1 is compare-only).

### Derived net worth (not stored)

```text
NAV = portfolio_MTM + free_cash + deposit_principal + property_values
      − liability_remaining_principal
```

All components converted to `reporting_currency` via explicit `fx` when needed. Same currency rule as cash NAV today: refuse mixed sums without rates.

**Dry powder** remains **free cash only** (deposits locked; property illiquid). Short-put cover logic unchanged.

---

## Projection engine

### Signature

```text
project(books, assumptions, scenario?, horizon_months, as_of) → ProjectionResult
```

| Input | Role |
|-------|------|
| `books` | Live state: portfolio (priced at run), cash, deposits, properties, liabilities, cash_flows, treasury |
| `assumptions` | Returns, inflation, FX, property growth (+ scenario overrides merged) |
| `scenario` | Optional overlay events + overrides |
| `horizon_months` | Integer ≥ 1 (e.g. 60 for 5y) |
| `as_of` | Anchor date `YYYY-MM-DD` (default: current UTC date) |

### Monthly loop

For each month \( t = 0 .. horizon_months-1 \):

1. **FX convert** any total that mixes currencies — missing rate → abort entire run with clear error.  
2. **Scheduled cash flows** active in month \( t \) (respect start/end; annual on anniversary month).  
3. **Service liabilities** — debit installment from free cash; interest vs principal split; reduce principal. If free cash &lt; payment → record `liquidity_shortfall` for that month (**do not** invent credit line).  
4. **Deposit maturity** — on `end_date`, release **principal** into free cash. Interest: **not** auto-credited in v1 (consistent with deposit product); optional scenario `one_off` if user wants interest.  
5. **Portfolio growth** — apply monthly rate derived from `portfolio_return_annual_pct` to start-of-month portfolio MTM (simple compounding; no rebalancing / contribution routing complexity in v1 unless cash surplus policy added later).  
6. **Property appreciation** — apply monthly rate from `property_appreciation_annual_pct` to each property mark.  
7. **Scenario events** dated in month \( t \).  
8. **Emit row:** free cash, portfolio, deposits, property, debt principal, net worth, net CF, flags.

**Inflation:** v1 uses `inflation_annual_pct` for **reporting real vs nominal optional summary** and/or growing expenses only if a later flag `inflate_expenses: true` is set on assumptions — **default v1: do not silently inflate cash-flow lines**; inflation is recorded and shown in summary context so the user can set higher expense lines or overrides. (Prevents double-counting surprise.) Document this in the skill.

### ProjectionResult (tool output shape)

```typescript
{
  asOf: string;
  horizonMonths: number;
  reportingCurrency: string;
  scenarioId: string | null;
  months: Array<{
    month: string;              // YYYY-MM
    freeCash: number;
    portfolio: number;
    deposits: number;
    property: number;
    debt: number;
    netWorth: number;
    netCashFlow: number;
    flags: string[];            // e.g. liquidity_shortfall
  }>;
  summary: {
    endNetWorth: number;
    minFreeCash: number;
    minFreeCashMonth: string;
    shortfallMonths: number;
    totalIncome: number;
    totalExpense: number;
  };
  assumptionsUsed: Record<string, unknown>;
}
```

### Decision recipes

| User ask | Recipe |
|----------|--------|
| Net worth now | Price portfolio → household BS in reporting ccy → assets / liabilities table |
| Cash flow in 5 years | `run_projection` horizon=60, no scenario → annual rollups + min cash + shortfalls |
| Can we buy house X? | Save or inline scenario (`buy_property` + fees + post-buy expense) → `compare_scenarios` base vs house → affordability block |
| Stress | Second scenario or overrides (lower return, higher mortgage rate) |

### Affordability verdict

```text
Affordability: AFFORDABLE | TIGHT | NOT_AFFORDABLE | UNKNOWN
  Peak cash need: …
  Min projected free cash: … (month)
  Post-purchase monthly net CF: …   # first full month after purchase event
  Shortfall months: n
  Gaps: …
```

**v1 thresholds** (constants in engine module; document in skill; not silent user defaults for missing data):

| Verdict | Rule |
|---------|------|
| `UNKNOWN` | Missing books/assumptions/FX required for the run |
| `NOT_AFFORDABLE` | Any `liquidity_shortfall` month in horizon, **or** free cash would go negative at purchase event |
| `TIGHT` | No shortfall, but post-purchase monthly net CF &lt; configured buffer **or** min free cash &lt; buffer (buffer from assumptions key `cash_buffer` if set; if buffer not set, use only shortfall/negative rules and label TIGHT when post-buy net CF ≤ 0) |
| `AFFORDABLE` | No shortfall; post-buy net CF &gt; 0 (and ≥ buffer if set) |

LLM **must not** emit AFFORDABLE without tool `ProjectionResult` / compare output in-turn.

---

## Tools

Channel-bound like existing portfolio tools (`telegram_user_id` / `slack_user_id` / web session). Fail-fast; no silent defaults.

| Tool | Behavior |
|------|----------|
| `get_treasury` / `set_treasury` | Read/write `reporting_currency`; surface configuration gaps |
| `get_household` | Unified BS + cash-flow summary + assumption/FX gaps (prefer over overloading `get_portfolio`) |
| `add_property` / `update_property` / `remove_property` | Property CRUD |
| `add_liability` / `update_liability` / `remove_liability` | Liability CRUD; mortgage requires `property_id`; optional compute payment |
| `add_cash_flow` / `update_cash_flow` / `remove_cash_flow` / `list_cash_flows` | Recurring lines |
| `get_projection_assumptions` / `set_projection_assumptions` | Returns, inflation, FX map, property growth, optional cash_buffer |
| `save_scenario` / `get_scenario` / `list_scenarios` / `delete_scenario` | Overlay storage |
| `run_projection` | `horizon_months`, optional `scenario_id` or inline scenario JSON, optional `as_of` |
| `compare_scenarios` | Base vs 1..N scenario ids (or inline); includes affordability when a `buy_property` event present |

**Unchanged:** `add_holding`, cash, deposits, playbook, `portfolio_analyzer`, snapshots, reports (analysis/dashboard kinds).

### Optional later

- `save_report` `kind=treasury` — HTML cash-flow / BS  
- WebUI household cards  
- `treasury-setup` skill wizard (user-initiated only)

---

## Agent surface

### Purpose (`INVAGE_PURPOSE`)

Keep Invester framing. Add a concise block:

- Can maintain **household books** (property, liabilities, recurring cash flows) when the user provides them  
- Can run **deterministic projections** for multi-year cash flow and large decisions (e.g. house)  
- Still not a licensed advisor; numbers only from tools/state  
- Do not invent income, rates, or FX  

### New skill: `family-treasury` (knowledge)

Load for: net worth with home/mortgage, budget-like recurring flows, 5y cash flow, affordability, scenario compare. Contents:

- Data shapes and fail-fast rules  
- Recipe order: gaps → set assumptions/FX → run/compare  
- Affordability template  
- Interaction with portfolio sleeve and deposits (locked principal)  
- Explicit non-goals  

### Existing skills

`investment-analysis`, `playbook-setup`, `firecrawl`, `bindrive` — unchanged in role. Portfolio work does not require treasury setup.

### `enrichMessage`

When any treasury-related block exists, append a short **Household context**:

- Reporting currency  
- Net worth if fully computable (else “incomplete”)  
- Gaps: no cash_flows, missing assumptions, missing FX for held currencies  

Never invent zeros for missing cash or income. Keep existing investor portfolio/playbook context.

### Guidance / slash

Optional `/guidance` section on household projection — after tools ship.

---

## Architecture placement

| Module | Responsibility |
|--------|----------------|
| `src/state/household-state.ts` (or extend portfolio-state) | Types + get/set for new YAML blocks |
| `src/treasury/amortize.ts` | Payment compute + month step |
| `src/treasury/project.ts` | Pure `project()` engine |
| `src/treasury/affordability.ts` | Verdict rules |
| `src/tools/household.ts` | CRUD tools |
| `src/tools/projection.ts` | `run_projection`, `compare_scenarios` |
| `src/skills/knowledge/family-treasury.md` | Agent skill |
| `docs/data-model.md` | Document new layers |

No utarus framework changes required for v1 (domain-only).

---

## Testing strategy

| Layer | Tests |
|-------|--------|
| Amortization | Known mortgage schedule vs hand-computed fixtures |
| FX | Mixed currency fails without rate; converts with rate |
| Cash flows | Monthly + annual anniversary; end_date cutoff |
| Shortfall | Payment &gt; cash sets flag; cash never silently goes negative without flag |
| Scenario buy_property | Down payment reduces cash; debt opens; property appears |
| Compare | Base vs scenario summary deltas |
| Tools | Channel isolation; fail on missing id / inconsistent payment |

---

## PR plan

| PR | Title | Deliverable | Depends |
|----|--------|-------------|---------|
| **1** | Household data model + state helpers | Types, YAML R/W, unit tests, `docs/data-model.md` section | — |
| **2** | Household CRUD tools | property, liability, cash_flow, treasury, assumptions tools + tests | 1 |
| **3** | Projection engine | `project()` + amortize + affordability pure modules + fixtures | 1 |
| **4** | Projection tools | `run_projection`, `compare_scenarios`, scenario CRUD | 2, 3 |
| **5** | Agent surface | purpose, `family-treasury` skill, enrichMessage, guidance blurb | 4 |
| **6** | (Optional) Reports / WebUI | `save_report` kind=treasury; dashboard cards | 5 |

Each PR independently reviewable; engine (3) can land before tools wire-up if tests are pure.

---

## Open questions (resolved defaults; revisit if needed)

| # | Question | Design default |
|---|----------|----------------|
| 1 | Extend `get_portfolio` vs new `get_household`? | **`get_household`** — keep portfolio tool investable-focused |
| 2 | Deposit interest at maturity in projections? | **Principal only** (align deposits v1); use scenario one_off for interest |
| 3 | Inflate expenses automatically? | **No** by default; inflation assumption for transparency / later flag |
| 4 | Surplus cash auto-invest into portfolio sleeve? | **No** in v1 — cash stays cash unless scenario/event moves it |
| 5 | Commit scenario → base books? | **Out of v1** |
| 6 | Agent display name | Stay **Invester** |

---

## Success criteria

1. User can record property + mortgage + salary/expense lines + assumptions/FX.  
2. `run_projection` for 60 months returns a full monthly series with no invented inputs.  
3. House scenario compare yields `AFFORDABLE | TIGHT | NOT_AFFORDABLE | UNKNOWN` with peak cash need and shortfall months.  
4. Missing FX or assumptions fails with a clear error, not a plausible-looking number.  
5. Existing portfolio analysis and playbook behavior remain unchanged when treasury is unused.

---

## Related docs

- [Data model](../data-model.md) — portfolio, cash, deposits (to be extended)  
- [Architecture](../architecture.md) — DomainExtension layering  
- [Fixed deposits design](./2026-07-29-fixed-deposits-design.md)  
- [Fund holdings design](./2026-07-29-fund-holdings-design.md)  
