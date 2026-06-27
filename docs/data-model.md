---
layout: default
title: Data Model — Invester
---

**[Home](/invage/)** | **[Data Model](/invage/data-model.html)**

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

Stored as a top-level `portfolio` key in the user state file:

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
    avg_price: 200.00
    units: 50
    category: SL Technology S1
  MSFT:
    avg_price: 300.00
    units: 30
    category: SL Technology S1
  GOOGL:
    avg_price: 140.00
    units: 40
    category: SL Technology S1
```

### Holding Shape

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `avg_price` | number | Yes | Average cost per share in USD |
| `units` | number | Yes | Number of shares owned |
| `category` | string | No | Fund category (e.g. "SL Technology S1") |

### Portfolio Tools

| Tool | Auth | Description |
|------|------|-------------|
| `add_holding` | telegram_user_id | Add or update a position |
| `remove_holding` | telegram_user_id | Remove a position |
| `get_portfolio` | telegram_user_id | List all positions |
| `update_holding` | telegram_user_id | Update specific fields |
| `clear_portfolio` | telegram_user_id | Remove all positions (requires confirm) |

**Isolation**: Every tool resolves the user via `telegram_user_id` from the message context. The LLM never directly specifies which user file to access — the framework enforces it.

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
