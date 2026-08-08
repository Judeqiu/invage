---
layout: default
title: Data Model — Invester
---

**[Home](/invage/)** | **[Data Model](/invage/data-model.html)** | **[Playbook](/invage/playbook.html)**

# Data Model

How Invester stores and isolates data — from user identity to portfolio holdings to analysis results.

---

## Overview

```
data/
├── invites.yaml              # Invite codes (INV-XXXXXXXX)
├── admin_codes.yaml          # Admin onboard codes (ADM-XXXXXXXX)
├── admin_ids.yaml            # Dynamic admin Telegram IDs
└── users/
    ├── alice.yaml            # Alice's complete state
    ├── bob.yaml              # Bob's complete state
    └── ...
```

Each user gets a **single YAML file** at `data/users/<slug>.yaml`. This file is the source of truth for that user's identity, profile, portfolio, and activity log. Users cannot access each other's files.

---

## Layer 1: System Access

### Invite Codes

File: `data/invites.yaml`

```yaml
- code: INV-1045661D
  created_by: 0              # admin Telegram ID
  created_at: 2026-06-27
  comment: initial invite code
  # Set when redeemed:
  used_by: 123456789         # Telegram ID of redeemer
  used_at: 2026-06-28
  slug: alice                # user slug created
```

**Flow**: Admin issues code → Recipient sends code to bot → Q&A for display name + email → User state file created → Code marked used.

### Admin Codes

File: `data/admin_codes.yaml`

```yaml
- code: ADM-A1B2C3D4
  created_by: 0
  created_at: 2026-06-27
  used_by: 123456789
  used_at: 2026-06-28
  revoked: false             # can be revoked before use
  revoked_at: null
```

**Flow**: Admin issues code → Recipient sends code → Granted admin rights → Added to `admin_ids.yaml`.

### Admin IDs

File: `data/admin_ids.yaml`

```yaml
- 123456789
- 987654321
```

Dynamically maintained list of admin Telegram IDs. Updated when admin codes are redeemed.

---

## Layer 2: User Identity

File: `data/users/<slug>.yaml`

### User Block

```yaml
user:
  id: 550e8400-e29b-41d4-a716-446655440000   # UUID, immutable
  slug: alice                                  # kebab-case, used as filename
  created_at: 2026-06-27
  telegram_user_ids:                           # linked Telegram accounts
    - 123456789
  auth_token: 660e8400-e29b-41d4-a716-446655440001  # for portal/API access
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Immutable unique identifier |
| `slug` | string | Lowercase kebab-case, matches filename |
| `created_at` | YYYY-MM-DD | Registration date |
| `telegram_user_ids` | number[] | Linked Telegram accounts (0 or more) |
| `auth_token` | UUID | Token for external access |

### Profile Block

```yaml
profile:
  display_name: Alice Chen
  contact_email: alice@example.com
  # Domain extensions can add more fields here
```

### Investment Playbook Block

Optional top-level `playbook` on the same user file. Missing playbook (or missing fields) resolves to the **balanced market-standard default** at read time.

```yaml
playbook:
  strategy: growth                    # growth | income | capital_preservation
  philosophy: value_investing         # growth_investing | value_investing | dividend_investing
  allocation:
    max_position_pct: 10              # max single-name weight %
    cash_target_pct: 5
    max_sector_pct: 35
  buy_sell:
    buy_criteria: "..."               # free-text rules for BUY language
    sell_criteria: "..."
    ai_recommendation_style: balanced # conservative | balanced | aggressive
  rebalancing:
    mode: quarterly                   # monthly | quarterly | threshold
    threshold_pct: 5                  # drift pp when mode=threshold
  risk:
    profile: balanced                 # conservative | balanced | aggressive
    position_limit_pct: 10
    sector_exposure_pct: 35
  watchlists:
    markets: [US]              # also: HK, CN/China for multi-market discovery
    sectors: []
    themes: []
```

| Field | Role in agent guidance |
|-------|------------------------|
| `strategy` | Optimize for appreciation vs income vs drawdown control |
| `philosophy` | Tilt PE/PEG/FCF bars and which lenses count as “cheap” |
| `risk` / allocation caps | BUY bar, take-profit speed, sizing language |
| `buy_sell` | Hard criteria before BUY/SELL wording |
| `rebalancing` | When to flag rebalance / concentration drift |
| `watchlists` | Default discovery universe when no ticker is named (`US`, `HK`, `CN`/`China`, …) |

**Tools:** `get_playbook`, `update_playbook` (channel-bound like portfolio tools).

**Guided setup skill:** `playbook-setup` — patient one-question-at-a-time wizard (user-initiated only). Knowledge: `src/skills/knowledge/playbook-setup.md`.

**Analyzer:** `portfolio_analyzer` on a saved portfolio loads the user’s playbook and applies derived thresholds to 3-axis classification and value screen multiples.

### Log Block

```yaml
log:
  - ts: 2026-06-27
    action: created
  - ts: 2026-06-27
    action: telegram_linked
    telegram_user_id: 123456789
  - ts: 2026-06-28
    action: holding_added
    ticker: AAPL
    avg_price: 200
    units: 50
  - ts: 2026-06-28
    action: holding_updated
    ticker: AAPL
    avg_price: 210
    units: 60
```

Every mutation appends to `log[]`. The agent never manually logs — the framework handles it.

---

## Layer 3: Portfolio Holdings

Stored as a top-level `portfolio` key in the user state file. Keys are equity tickers, **fund codes/tickers**, or option position ids.

**Cash** is **not** a holding. It is a separate top-level `cash` block (see below) so strategy can use dry powder, cash weight vs `cash_target_pct`, and short-put assignment cover without inventing a fake ticker.

```yaml
user:
  id: ...
  slug: alice
  ...
profile:
  ...
log:
  - ...
portfolio:
  AAPL:
    instrument: equity          # optional; omit = equity
    avg_price: 200.00
    units: 50
    category: SL Technology S1
    channel: ibkr               # optional broker/custody source; omit when unassigned
  MSFT:
    avg_price: 300.00
    units: 30
    category: SL Technology S1
    # channel omitted = unassigned
  # ETF / open-end 基金
  SPY:
    instrument: fund
    avg_price: 480.00
    units: 20
    channel: ibkr
    fund:
      quote_source: yahoo          # live Yahoo on base key
  "110011":
    instrument: fund
    avg_price: 1.2345
    units: 10000
    channel: jude_futu
    fund:
      quote_source: manual         # required: no silent default
      mark: 1.3012                 # NAV per unit (required when manual)
      name: "易方达中证500联接A"   # optional
  # Short put: 1 contract (controls 100 sh), $265 total premium, strike $90, expiry 2026-08-07
  SPACEX-P-90-20260807-S:
    instrument: option
    avg_price: 265              # total premium $ per contract (NOT per share)
    units: 1                    # contracts
    category: Private / Secondary
    channel: moomoo             # optional broker/custody source
    option:
      right: put                # call | put
      side: short               # long | short
      strike: 90
      expiry: "2026-08-07"
      multiplier: 100           # shares controlled per contract (assignment size only)
      underlying: SPACEX        # public ticker or private name
      settlement: physical      # physical | cash — required
      mark: 265                 # current premium $ per contract for MTM
      # underlying_mark: 50     # optional scenario mark on the underlying

# optional — omit entirely when cash is unknown (never invent 0)
# Single channel (legacy-friendly object form):
cash:
  amount: 12500.00              # available / free cash ≥ 0
  currency: USD                 # required (e.g. USD, HKD) — no silent default
  updated_at: "2026-07-28"      # YYYY-MM-DD when last set via set_cash
  channel: ibkr                 # optional broker/custody source; omit when unassigned

# Multi-channel (array form — one entry per broker; set_cash upserts by channel):
# cash:
#   - amount: 12448.47
#     currency: USD
#     updated_at: "2026-07-29"
#     channel: jude_futu
#   - amount: 38758.91
#     currency: USD
#     updated_at: "2026-07-29"
#     channel: cmbyonglong

# optional — omit to use balanced defaults
playbook:
  strategy: growth
  philosophy: value_investing
  risk:
    profile: balanced
    position_limit_pct: 10
    sector_exposure_pct: 35
```

### Holding Shape (equity)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instrument` | `"equity"` | No | Omit or set `equity` (default) |
| `avg_price` | number | Yes | Average cost per share in USD |
| `units` | number | Yes | Number of shares owned |
| `category` | string | No | Fund category (e.g. "SL Technology S1") |
| `channel` | string | No | Broker / custody source (e.g. `moomoo`, `ibkr`, `webull`, `tiger`). **Omit or empty when unassigned** — no silent default |

### Holding Shape (fund — ETF / open-end 基金)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instrument` | `"fund"` | Yes | Must be `fund` |
| `avg_price` | number | Yes | Average cost per unit |
| `units` | number | Yes | Fund units / shares |
| `category` | string | No | e.g. Bond, Equity fund |
| `channel` | string | No | Broker / custody source |
| `fund.quote_source` | `yahoo` \| `manual` | Yes | **No silent default.** yahoo = live Yahoo on map base key; manual = stored NAV |
| `fund.mark` | number | If manual | Current NAV/price per unit ≥ 0 |
| `fund.name` | string | No | Product display name |
| `fund.expected_yield_pct` | number | No* | Annual yield % points (3.2 = 3.2% p.a.). *With basis+as_of only — never invent |
| `fund.yield_basis` | enum | With yield | `distribution` \| `total_return` \| `user_stated` |
| `fund.yield_as_of` | YYYY-MM-DD | With yield | When yield was captured |
| `fund.product_class` | enum | No | `income` \| `balanced` \| `equity` \| `mmf` \| `other` |

**Economics:** same as equity (cost = avg × units; value = mark × units). Cash ledger same as equity buys. Multi-channel keys: `SPY@ibkr`, `110011@jude_futu`. Street 3-axis analyzer buckets remain **equity-only** in v1; funds still count in NAV / dashboard / snapshot.

### Holding Shape (option)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instrument` | `"option"` | Yes | Must be `option` |
| `avg_price` | number | Yes | **Premium $ per contract** at trade (e.g. 265 = $265 total for one contract) |
| `units` | number | Yes | Number of **contracts** |
| `category` | string | No | e.g. `Private / Secondary` |
| `channel` | string | No | Broker / custody source (same semantics as equity). Omit when unassigned |
| `option.right` | `call` \| `put` | Yes | Option type |
| `option.side` | `long` \| `short` | Yes | Bought or written |
| `option.strike` | number | Yes | Strike per share |
| `option.expiry` | `YYYY-MM-DD` | Yes | Expiration |
| `option.multiplier` | number | Yes | Shares controlled per contract (**100** US) — **assignment only** |
| `option.underlying` | string | Yes | Public ticker or private name (`SPACEX`) |
| `option.settlement` | `physical` \| `cash` | Yes | No silent default |
| `option.mark` | number | Yes | Stored premium **$ per contract** for MTM (≥ 0); used when manual/auto-miss |
| `option.quote_source` | `manual` \| `yahoo` | No | `manual` = always mark; `yahoo` = require Yahoo chain; omit = auto |
| `option.underlying_mark` | number | No | Optional underlying price for scenarios |

**Multi-broker:** `channel` tags which broker holds the position or cash so a single user file can mix accounts (e.g. equities at IBKR, options at moomoo). Free-form string (not a closed enum).

**Same ticker, different channels:** portfolio map keys are composite when a channel is set:

| Channel | Map key | Notes |
|---------|---------|--------|
| Unassigned | `AAPL` | Legacy-friendly bare ticker |
| Assigned | `AAPL@moomoo` | Same equity at another broker is a separate lot |
| Option + channel | `SPACEX-P-90-20260807-S@ibkr` | Option base key + `@channel` |

`add_holding` with `channel` targets only the lot on that channel; a different channel creates a new lot (no forced merge). **Same ticker+channel already present:** `add_holding` **appends** units/contracts and **blends** weighted-average cost (pass this-trade size + fill price, not the full position total). To set absolute units/avg_price, use `update_holding`. Yahoo quotes still use the bare symbol (`AAPL`). Legacy rows that store channel on the holding under a bare key (`AAPL` + `channel: moomoo`) remain valid and match that channel on upsert.

**Multi-channel + multi-currency free cash:** `set_cash` **upserts by (channel, currency)** — recording `dbs` USD does **not** overwrite `dbs` SGD or `jude_futu` USD. YAML stores a single object when one slot exists, or an array when two or more. Trades with `adjust_cash=true` debit/credit the free-cash slot matching the holding's channel (and currency when multi-ccy). Same-currency bank→broker moves use **`transfer_cash`** (double-entry). Unlocking a fixed deposit uses **`mature_deposit`** into the same channel+currency free-cash sleeve.

**Dashboard dimension:** Live WebUI and HTML dashboard reports always expose a channel dimension:

| View | Meaning |
|------|---------|
| **All (merged)** | Full portfolio across every channel (default view) |
| **Single channel** | Filter positions + cash to one broker tag |
| **`default`** | Synthetic tag for holdings/cash **without** a stored `channel` (legacy data, unassigned) |

Missing/empty `channel` is **not** rewritten in YAML; the dashboard maps it to `default` at read time only.

**Economics (options):**

- Total premium = `avg_price × units` (e.g. $265 × 1 = **$265**) — **never** × multiplier again
- Direction: long = +1, short = −1
- Cost (signed) = direction × avg_price × units  
- Value (signed MTM) = direction × mark × units  (open short liability = −mark; not strike loss)  
- P/L = value − cost  
- Short put contingent cash **if assigned** = `strike × multiplier × units` (e.g. $90 × 100 = **$9,000**) — separate from MTM  
- Short call contingent share delivery if assigned = `units × multiplier` shares  

**Position key:** if `ticker` is omitted on add, auto-built as  
`{UNDERLYING}-{P|C}-{STRIKE}-{YYYYMMDD}-{L|S}`  
e.g. `SPACEX-P-90-20260807-S`. When `channel` is set, the stored map key is `{base}@{channel}`.

**Pricing:**

| Instrument | Live source |
|------------|-------------|
| Equity | Yahoo `quote` → `regularMarketPrice` |
| Option (listed / auto) | Yahoo `options(underlying, { date: expiry })` → match strike + call/put → mark = mid-or-last **per share × multiplier** |
| Option (private / manual / auto miss) | Stored `option.mark` ($ per contract) |

Live Yahoo option marks are applied **in memory** for analysis/dashboard/snapshot valuation; they do not rewrite YAML unless you `update_holding` mark.

### Cash Balance (strategy dry powder)

Top-level `cash` on the same user file. **Missing `cash` means unknown** — do not treat as zero for weight or deployable capital.

Storage shape:

| Form | When |
|------|------|
| Object | One cash slot (legacy / single channel) |
| Array of objects | Two or more channel slots |

Each entry:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes (when block present) | Available cash ≥ 0 |
| `currency` | string | Yes | 3–4 letter code (`USD`, `HKD`, …). No silent default |
| `updated_at` | `YYYY-MM-DD` | Yes | Date last set |
| `channel` | string | No | Broker / custody source for this cash. Omit or empty when unassigned |

**Rules:** at most one entry per channel key (including one unassigned). NAV sums all slots only when they share the same currency (no silent FX). Dashboard **All (merged)** shows total cash; each channel view shows that channel's cash only.

**Semantics for strategy:**

| Concept | Formula / rule |
|---------|----------------|
| Positions MTM | Sum of equity + option mark-to-market |
| Total NAV | Positions MTM + cash (when cash recorded); else positions only |
| Cash weight % | `cash / NAV × 100` (null when cash unknown) |
| vs `playbook.allocation.cash_target_pct` | Drift in percentage points; flag rebalance when threshold mode |
| Short-put cover | cash amount vs sum of contingent cash obligations |
| Position sizing | Suggest buys as % of **Total NAV** when cash is known |

**Cash ledger (when `cash` is recorded):** holding mutations move cash automatically:

| Action | Cash impact |
|--------|-------------|
| `add_holding` equity / fund / long option (new or append) | **−** **this-trade** cost or premium only (`purchase.avg × purchase.units`; blended position keeps prior basis) |
| `add_holding` short option | **+** this-trade premium credit |
| `update_holding` units/avg_price (or side) | **±** cost/premium **delta** vs prior absolute holding |
| Mark-only option MTM update | no cash change |
| `remove_holding` | reverse open at **cost basis** (not live sale proceeds) — full lot only |
| `set_cash` | **no trade ledger** — writes absolute free-cash for one channel (other channels untouched) |
| `add_deposit` / `remove_deposit` | **−** / **+** principal on matching channel when `adjust_cash` |

- Fails fast if cash would go **negative** (insufficient dry powder).
- Cash unknown → no ledger write (message notes to `set_cash`).
- `adjust_cash=false` on `add_holding` / `update_holding` / `remove_holding` skips the ledger (historical import / correction only).
- Import order: either add holdings with `adjust_cash=false` then `set_cash` to free cash, **or** `set_cash` first then add new buys (auto-deduct).

Multi-currency conversion is **not** automatic: record cash in the currency the user thinks of as deployable; agent states the currency. FX conversion only if tools provide a rate.

`clear_portfolio` does **not** clear cash. Use `clear_cash` (confirm) to remove the cash record.

### Fixed Deposits (locked principal)

Top-level `deposits` array on the same user file. **Missing `deposits` means none.** Fixed deposits are **not free cash**: principal counts in **NAV** but is **not deployable** dry powder until maturity / `remove_deposit`.

```yaml
deposits:
  - id: fd-jude_futu-20260701
    channel: jude_futu             # optional; omit = unassigned → dashboard "default"
    amount: 50000                  # principal ≥ 0
    interest: 875                  # full-term interest amount ≥ 0 (not annual rate)
    currency: USD                  # required; no silent default
    start_date: "2026-07-01"       # YYYY-MM-DD
    end_date: "2027-01-01"         # ≥ start_date
    label: "6M bank TD"            # optional
    updated_at: "2026-07-29"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique across all deposits for the user |
| `amount` | number | Yes | Principal ≥ 0 (in NAV) |
| `interest` | number | Yes | Full-term interest $ ≥ 0 (display only in v1 — not accrued into NAV) |
| `currency` | string | Yes | 3–4 letter code. No silent default |
| `start_date` / `end_date` | `YYYY-MM-DD` | Yes | Fail if end &lt; start |
| `updated_at` | `YYYY-MM-DD` | Yes | Last mutation |
| `channel` | string | No | Broker / custody source. Omit when unassigned |
| `label` | string | No | Product name / note |

**Rules:** multiple deposits per channel allowed; unique `id`. NAV sums principals only when same currency (no silent FX). Dashboard shows FD card + table; channel filter applies.

**NAV (v1):**

| Concept | Formula / rule |
|---------|----------------|
| Total NAV | Positions MTM + free cash (if recorded) + **sum(deposit principal)** |
| Free cash / dry powder | `cash` only — **excludes** deposits |
| Cash weight % | free cash / Total NAV (deposits in denominator, not numerator) |
| Short-put cover | free cash only |
| Interest in NAV | **Not** included in v1 (metadata / maturity display only) |

**Cash ledger** (`adjust_cash`, default true when cash is recorded):

| Action | Cash impact |
|--------|-------------|
| `add_deposit` | **−** principal on matching channel |
| `update_deposit` amount change | **±** principal delta |
| `remove_deposit` | **+** principal (interest **not** auto-credited) |
| `adjust_cash=false` | Skip ledger (import / correction) |
| `clear_deposits` | No cash ledger (bulk clear only) |

### Portfolio Tools

| Tool | Auth | Description |
|------|------|-------------|
| `add_holding` | channel id | Record a **buy/open** (this-trade units + fill); **appends + blends cost** on same ticker+channel; equity / **fund** / option; optional `channel`; cash ledger for this-trade only (`adjust_cash=false` to skip). Absolute totals → `update_holding` |
| `remove_holding` | channel id | Remove position; credits cash at cost basis when recorded |
| `get_portfolio` | channel id | List positions + cash + **fixed deposits** section |
| `update_holding` | channel id | Update fields including option `mark` and optional `channel`; cost changes adjust cash |
| `clear_portfolio` | channel id | Remove all positions (requires confirm); cash kept |
| `set_cash` | channel id | Upsert cash amount + currency (required); optional `channel` (broker). **Does not overwrite other channels** |
| `clear_cash` | channel id | Remove all cash, or one channel when `channel` is set (requires confirm) |
| `add_deposit` | channel id | Record fixed deposit (principal, interest, currency, start/end, optional channel/label/id); deducts cash when recorded |
| `update_deposit` | channel id | Patch deposit by `id`; amount changes adjust cash |
| `remove_deposit` | channel id | Remove by `id`; credits principal to cash when recorded |
| `clear_deposits` | channel id | Remove all deposits, or one channel when `channel` is set (requires confirm); no cash ledger |

**Isolation**: Every tool resolves the user via channel id from the message context. The LLM never directly specifies which user file to access — the framework enforces it.

---

## Layer 3c: Household Treasury (optional)

Optional top-level blocks for **family books** and deterministic projections. Missing blocks mean empty/unknown — never invent zeros for affordability.

See design: [plans/2026-07-29-family-treasury-accountant-design.md](./plans/2026-07-29-family-treasury-accountant-design.md).

```yaml
treasury:
  reporting_currency: SGD
  updated_at: "2026-07-29"

properties:
  - id: prop-home
    label: "Home"
    value: 1800000
    currency: SGD
    updated_at: "2026-07-29"
    mortgage_id: loan-mortgage-home
    # Optional purchase-payment ledger (OTP / booking / S&P / PPS). Omit = paid unknown (not zero).
    payments:
      - date: "2026-08-03"
        amount: 109100
        label: "OTP option lock ~5%"

liabilities:
  - id: loan-mortgage-home
    kind: mortgage                 # mortgage | loan
    principal: 1200000
    annual_rate_pct: 3.2
    currency: SGD
    start_date: "2026-01-01"
    term_months: 360
    payment_amount: 5200
    payment_frequency: monthly
    property_id: prop-home
    updated_at: "2026-07-29"

cash_flows:
  - id: cf-salary
    kind: income                   # income | expense
    amount: 12000
    currency: SGD
    frequency: monthly             # monthly | annual
    start_date: "2026-01-01"
    label: "Salary"
    updated_at: "2026-07-29"

projection_assumptions:
  portfolio_return_annual_pct: 5.0
  inflation_annual_pct: 2.0
  property_appreciation_annual_pct: 0
  fx:
    USD: 1.35                      # units of reporting ccy per 1 USD
  cash_buffer: 10000
  updated_at: "2026-07-29"

scenarios:
  - id: sc-buy-house
    label: "Buy house 2028"
    updated_at: "2026-07-29"
    events:
      - type: buy_property
        date: "2028-06-01"
        property_value: 2000000
        currency: SGD
        down_payment: 500000
        mortgage:
          annual_rate_pct: 3.5
          term_months: 360
```

| Tool | Role |
|------|------|
| `get_household` / `get_treasury` / `set_treasury` | Unified books + reporting currency |
| `add_property` / `update_property` / `remove_property` | Real estate marks (manual; never auto-written from comps) |
| `record_property_payment` | Append OTP/booking/PPS payment to `properties[].payments` (optional free-cash debit via `cash_channel`) |
| `add_liability` / `update_liability` / `remove_liability` | Amortizing mortgage/loan |
| `add_cash_flow` / `list_cash_flows` / … | Recurring income/expense (rent lives here when stored — not on PropertyAsset) |
| `set_projection_assumptions` | Returns, inflation, FX (required for projection) |
| `save_scenario` / `run_projection` / `compare_scenarios` | Overlays + monthly engine |
| `property_intel` | HDB resale (data.gov.sg collection 189) + private sold comps (URA `PMI_Resi_Transaction` when `URA_ACCESS_KEY` set) |
| `ura_carpark` | URA car park availability + rates/details |

**Property marks:** `assertProperty` keeps only known fields (`id`, `value`, `currency`, `updated_at`, optional `label`, `mortgage_id`, optional `payments[]`) — unknown keys are stripped on write, not silently defaulted. **paid_to_date** is derived as the sum of `payments` when present; omit `payments` = paid amount **unknown** (do not invent 0). Scenarios remain projection overlays and are **not** the purchase-payment ledger.

**SG real-estate portfolio skill:** `sg-real-estate-portfolio` (comps, duties, yield/LTV recipes). Dual-load with `family-treasury` for second-property / SG buy with policy cost. Design: [plans/2026-08-01-real-estate-portfolio-intelligence-design.md](./plans/2026-08-01-real-estate-portfolio-intelligence-design.md).

**Env:** `DATA_GOV_SG_API_KEY` (recommended for HDB rate limits); optional `HDB_RESALE_RESOURCE_ID` (override 2017+ slice); `URA_ACCESS_KEY` (required for private sold + car parks); optional `URA_BASE_URL` (default `https://eservice.ura.gov.sg`).

**NAV (household):** portfolio MTM (or cost basis) + free cash + deposit principal + property − liability principal, all in `reporting_currency` via explicit FX. Fail-fast if FX missing.

---

## Layer 3b: Portfolio Snapshots (BinDrive)

Dated point-in-time valuations live under each user's BinDrive folder (not in the user YAML):

```
data/drive/<slug>/
├── snapshots.json              # index: ["snapshot-2026-07-01.json", ...]
├── snapshot-2026-07-01.json
├── dashboard-2026-07-17.html   # optional generated dashboard report
└── report-2026-07-17.html      # optional 3-axis analysis report
```

### Snapshot JSON

```json
{
  "date": "2026-07-01",
  "totalValue": 62500.0,
  "totalCost": 42000.0,
  "totalPL": 8000.0,
  "totalPLPct": 19.05,
  "positionsValue": 50000.0,
  "cashAmount": 12500.0,
  "cashCurrency": "USD",
  "positions": [
    {
      "ticker": "AAPL",
      "avgCost": 200,
      "units": 50,
      "price": 210,
      "cost": 10000,
      "value": 10500,
      "pl": 500,
      "plPct": 5.0
    }
  ]
}
```

| Tool / report | Role |
|---------------|------|
| `save_snapshot` | Fetch live prices, write one snapshot file + index entry |
| `list_snapshots` | List saved snapshots |
| `save_report` `kind=dashboard` | HTML dashboard: live value, P/L vs cost, history from snapshots |
| `save_report` `kind=analysis` | 3-axis analysis HTML (default) |
| `send_report` `kind=analysis|dashboard` | Email the same HTML via gws Gmail |

Corrupt or missing snapshot files listed in the index fail fast (no silent skip).

---

## Layer 4: Market Data (Runtime)

Market data is fetched live from Yahoo Finance. It is **not persisted** — fetched fresh each time.

### MarketQuote

```typescript
{
  ticker: string;      // "AAPL"
  price: number;       // 283.78
  currency: string;    // "USD"
  shortName: string;   // "Apple Inc"
}
```

### AnalystTarget

```typescript
{
  ticker: string;               // "AAPL"
  targetLowPrice: number|null;  // 215
  targetMedianPrice: number|null; // 315
  targetMeanPrice: number|null;   // 315.09
  targetHighPrice: number|null;   // 400
}
```

### FinancialMetrics

```typescript
{
  ticker: string;            // "AAPL"
  trailingPE: number|null;   // 34.36
  pegRatio: number|null;     // 2.37
  forwardPE: number|null;    // 29.53
  priceToBook: number|null;  // 39.09
  returnOnEquity: number|null; // 1.41 (141%)
  shortName: string;         // "Apple Inc"
  sector: string;            // "Technology"
}
```

---

## Layer 5: Analysis Results (Runtime)

The 3-axis analyzer combines holdings + market data into analysis results. Also **not persisted**.

### PositionAnalysis

```typescript
{
  ticker: string;           // "AAPL"
  company: string;          // "Apple Inc"
  category: string;         // "SL Technology S1"
  price: number;            // 283.78 (current)
  avgCost: number;          // 200.00 (user's cost)
  units: number;            // 50
  cost: number;             // 10000 (avgCost × units)
  value: number;            // 14189 (price × units)
  pl: number;               // 4189 (value - cost)
  plPct: number;            // 41.9%
  targetLow: number|null;   // 215
  targetMedian: number|null; // 315
  targetMean: number|null;  // 315.09
  targetHigh: number|null;  // 400
  upsideToMedian: number|null; // 11.0%
  upsideToMean: number|null;   // 11.1%
  costVsHigh: number|null;     // -100.0%
  currentVsCost: number|null;  // 41.9%
  recommendation?: string;  // "WATCH — Interesting, 15-20% upside"
}
```

### AnalysisResult

```typescript
{
  laggards: PositionAnalysis[];        // cost > target_high
  overpriced: PositionAnalysis[];      // price > target_median
  buyOpportunities: PositionAnalysis[]; // upside > 15%
  fullAnalysis: PositionAnalysis[];    // all positions
}
```

---

## Layer 6: Configuration

### Company Names

84 pre-configured tickers with human-readable names:

| Sector | Tickers |
|--------|---------|
| Technology | QQQ, TSLA, MSFT, AAPL, META, GOOGL |
| Utilities | NEE, SO, CEG, DUK, VST, AEP, SRE, D, EXC, PEG, XEL, ED, EIX, PPL, WEC, CMS, AES, NRG, AVA |
| Healthcare | LLY, JNJ, ABBV, UNH, ABT, MRK, TMO, ISRG, AMGN, BSX, GILD, PFE, SYK, DHR, MDT, VRTX, BMY, CI |
| Aerospace | GE, BA, RTX, LMT, NOC, GD, HON, LHX, AXON, HWM, PH, TDG, ETN, ESLT, HEI, LDOS, BWXT, CW |
| Food Staples | COST, WMT, PG, KO, PEP, MDLZ, CL, MNST, KR, TGT, KDP, KMB, KVUE, SYY, GIS, ADM, DG, HSY, CHD |
| Financial | BRK-B |

### Benchmarks

| Fund | Benchmark ETF |
|------|--------------|
| SL Financial S1 | SPY |
| SL Healthcare S1 | IYH |
| SL Aerospace S1 | ITA |
| SL Food Staples S1 | VDC |
| SL Utility S1 | XLU |
| SL Technology S1 | QQQ |

### Analysis Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `buyMinUpsidePct` | 15 | Minimum upside to classify as Buy Opportunity |
| `strongBuyUpsidePct` | 30 | Upside for STRONG BUY classification |
| `pegAttractive` | 1.5 | PEG ratio below this is attractive |
| `peAttractive` | 25 | P/E below this is reasonable |
| `roeGood` | 0.15 | ROE above 15% is good |

---

## Complete User State Example

```yaml
# data/users/alice.yaml

user:
  id: 550e8400-e29b-41d4-a716-446655440000
  slug: alice
  created_at: 2026-06-27
  telegram_user_ids:
    - 123456789
  auth_token: 660e8400-e29b-41d4-a716-446655440001

profile:
  display_name: Alice Chen
  contact_email: alice@example.com

log:
  - ts: 2026-06-27
    action: created
  - ts: 2026-06-27
    action: telegram_linked
    telegram_user_id: 123456789
  - ts: 2026-06-28
    action: holding_added
    ticker: AAPL
    avg_price: 200
    units: 50
    category: SL Technology S1
  - ts: 2026-06-28
    action: holding_added
    ticker: MSFT
    avg_price: 300
    units: 30
    category: SL Technology S1

portfolio:
  AAPL:
    avg_price: 200
    units: 50
    category: SL Technology S1
  MSFT:
    avg_price: 300
    units: 30
    category: SL Technology S1
```

---

## Data Flow

```
                    ┌─────────────────┐
                    │   Telegram Msg   │
                    │  (user ID: 123)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  resolveUser()   │
                    │  123 → alice     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │  get_portfolio│ │add_holding│ │  analyzer    │
     │  (read YAML)  │ │(write YAML)│ │(read YAML)   │
     └──────┬───────┘ └─────┬────┘ └──────┬───────┘
            │               │              │
            ▼               ▼              ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │  alice.yaml   │ │alice.yaml│ │ Yahoo Finance │
     │  (portfolio)  │ │(updated) │ │ (live data)   │
     └──────────────┘ └──────────┘ └──────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │  3-Axis       │
                                   │  Analysis     │
                                   └──────────────┘
```

---

*Source: [github.com/Judeqiu/invage](https://github.com/Judeqiu/invage)*
