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

Stored as a top-level `portfolio` key in the user state file. Keys are equity tickers **or** option position ids.

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
  MSFT:
    avg_price: 300.00
    units: 30
    category: SL Technology S1
  # Short put: 1 contract × 100 shares, $265 premium/share, strike $90, expiry 2026-08-07
  SPACEX-P-90-20260807-S:
    instrument: option
    avg_price: 265              # premium per share of underlying
    units: 1                    # contracts
    category: Private / Secondary
    option:
      right: put                # call | put
      side: short               # long | short
      strike: 90
      expiry: "2026-08-07"
      multiplier: 100           # shares per contract (US equity standard)
      underlying: SPACEX        # public ticker or private name
      settlement: physical      # physical | cash — required
      mark: 265                 # current premium/share for MTM
      # underlying_mark: 50     # optional scenario mark on the underlying

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

### Holding Shape (option)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instrument` | `"option"` | Yes | Must be `option` |
| `avg_price` | number | Yes | **Premium per share** at trade (not total premium) |
| `units` | number | Yes | Number of **contracts** |
| `category` | string | No | e.g. `Private / Secondary` |
| `option.right` | `call` \| `put` | Yes | Option type |
| `option.side` | `long` \| `short` | Yes | Bought or written |
| `option.strike` | number | Yes | Strike per share |
| `option.expiry` | `YYYY-MM-DD` | Yes | Expiration |
| `option.multiplier` | number | Yes | Shares per contract (**100** for standard US equity options) |
| `option.underlying` | string | Yes | Public ticker or private name (`SPACEX`) |
| `option.settlement` | `physical` \| `cash` | Yes | No silent default |
| `option.mark` | number | Yes | Current premium/share for MTM (≥ 0) |
| `option.underlying_mark` | number | No | Optional underlying price for scenarios |

**Economics (options):**

- Total premium = `avg_price × units × multiplier` (e.g. $265 × 1 × 100 = **$26,500**)
- Direction: long = +1, short = −1
- Cost (signed) = direction × premium total  
- Value (signed MTM) = direction × `mark` × units × multiplier  
- P/L = value − cost  
- Short put contingent cash obligation = `strike × units × multiplier` (e.g. $90 × 100 = **$9,000**)  
- Short call contingent share delivery = `units × multiplier` shares of underlying  

**Position key:** if `ticker` is omitted on add, auto-built as  
`{UNDERLYING}-{P|C}-{STRIKE}-{YYYYMMDD}-{L|S}`  
e.g. `SPACEX-P-90-20260807-S`.

**Pricing:** equities use Yahoo Finance live quotes. Options **never** fetch Yahoo under the contract key; valuation uses stored `mark` (works for private underlyings).

### Portfolio Tools

| Tool | Auth | Description |
|------|------|-------------|
| `add_holding` | channel id | Add or update equity **or** option (`instrument=option` + contract fields) |
| `remove_holding` | channel id | Remove a position by portfolio key |
| `get_portfolio` | channel id | List all positions (premium / obligation for options) |
| `update_holding` | channel id | Update fields including option `mark` for MTM |
| `clear_portfolio` | channel id | Remove all positions (requires confirm) |

**Isolation**: Every tool resolves the user via channel id from the message context. The LLM never directly specifies which user file to access — the framework enforces it.

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
  "totalValue": 50000.0,
  "totalCost": 42000.0,
  "totalPL": 8000.0,
  "totalPLPct": 19.05,
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
