---
layout: default
title: Invester — AI Investment Portfolio Analyzer
---

**[Home](/invage/)** | **[Data Model](/invage/data-model.html)** | **[Playbook](/invage/playbook.html)**

# Invester

**AI-powered investment portfolio analysis assistant built on the Utarus framework.**

Invester helps you analyze investment portfolios using a 3-axis framework: Laggards, Overpriced, and Buy Opportunities. It fetches real-time market data from Yahoo Finance and provides actionable recommendations.

---

## Quick Start

### Prerequisites

- Node.js 18+
- DeepSeek API key ([get one here](https://platform.deepseek.com → API Keys))

### Setup

```bash
git clone https://github.com/Judeqiu/invage.git
cd invage
npm install
cp .env.example .env
# Edit .env with your DEEPSEEK_API_KEY
npm run dev
```

### First Run

Once the agent starts, type `/help` to see available commands.

---

## Portfolio Management

Invester maintains your portfolio in a persistent user state file. Once holdings are saved, you can analyze your portfolio at any time without re-entering positions.

### Available Tools

| Tool | Description |
|------|-------------|
| `add_holding` | Add or update a stock position (ticker, avg price, shares, category) |
| `remove_holding` | Remove a position from portfolio |
| `get_portfolio` | View all saved positions with cost basis |
| `update_holding` | Update specific fields (price, shares, or category) |
| `clear_portfolio` | Remove all positions (requires confirmation) |
| `portfolio_analyzer` | Run 3-axis analysis on saved portfolio or ad-hoc positions |

### Building Your Portfolio

Chat with the agent to add positions:

> **You:** Add AAPL to my portfolio — 50 shares at $200 average cost, under Technology fund
> 
> **Agent:** Added AAPL: 50 shares @ $200.00 (cost: $10,000.00) [SL Technology S1]

> **You:** Also add MSFT — 30 shares at $300
>
> **Agent:** Added MSFT: 30 shares @ $300.00 (cost: $9,000.00)

### Viewing Your Portfolio

> **You:** Show my portfolio
>
> **Agent:**
> ```
> Portfolio — 2 positions:
>
>   AAPL     | 50 shares @ $200.00 | Cost: $10000.00 | SL Technology S1
>   MSFT     | 30 shares @ $300.00 | Cost: $9000.00 | SL Technology S1
>
> Total cost basis: $19,000.00
> ```

### Updating Positions

> **You:** I bought 10 more AAPL shares, update my average to $210
>
> **Agent:** Updated AAPL: 60 shares @ $210.00 (cost: $12,600.00) [SL Technology S1]

### Analyzing Your Portfolio

> **You:** Analyze my portfolio
>
> **Agent:** *(loads saved holdings, fetches real-time data, runs 3-axis analysis)*
> ```
> Portfolio Analysis — 2 positions
>
> 🟢 BUY OPPORTUNITIES — >15% Upside to Median (1)
>
>   MSFT   | Microsoft Corp               | P/L: +24.3% | Cost: $300.00 | Price: $372.97
>          ↳ Median Target: $555.00 | Upside: +48.8%
>          ↳ STRONG BUY — High conviction, >30% upside
>
> ── FULL PORTFOLIO (by P/L) ──
>   AAPL   Apple Inc                    +41.9% ($283.78)
>   MSFT   Microsoft Corp               +24.3% ($372.97)
> ```

### Ad-Hoc Analysis (No Saved Portfolio)

You can also analyze positions without saving them:

> **You:** Check AAPL and GOOGL prices
>
> **Agent:** *(fetches market data without portfolio context)*
> ```
> Market Data for AAPL, GOOGL
>
> AAPL (Apple Inc)
>   Price: $283.78 | Median Target: $315.00 (upside: 11.0%)
>   P/E: 34.4 | PEG: 2.37 | ROE: 141.5%
>
> GOOGL (Alphabet Inc)
>   Price: $337.39 | Median Target: $430.00 (upside: 27.4%)
>   P/E: 25.7 | PEG: 1.36 | ROE: 38.9%
> ```

---

## How It Works

### 3-Axis Analysis Framework

Every portfolio position is evaluated through three analytical lenses:

#### 🔴 Laggards — Cost > Analyst High Target

Positions where your average cost exceeds the highest analyst price target. These are underwater with limited recovery path.

| Loss | Recommendation |
|------|---------------|
| > 30% | **SELL** — Deep loss, no recovery path |
| 15–30% | **HOLD** — Monitor for catalyst |
| < 15% | **REDUCE COST** — Average down if fundamentals strong |

#### 🟡 Overpriced — Price Above Median Target

Positions trading above the median analyst target. May be overvalued.

| Premium | Recommendation |
|---------|---------------|
| > 20% | **TAKE PROFIT** — Significant overvaluation |
| 10–20% | **TRAIL STOP** — Protect gains |
| < 10% | **HOLD** — Slight premium, momentum may continue |

#### 🟢 Buy Opportunities — >15% Upside to Median

Positions where current price is well below the median analyst target.

| Upside | Recommendation |
|--------|---------------|
| > 30% | **STRONG BUY** — High conviction |
| 20–30% | **BUY** — Moderate conviction |
| 15–20% | **WATCH** — Interesting, monitor |

---

## Financial Metrics

| Metric | Good | Attractive | Expensive |
|--------|------|------------|-----------|
| P/E (trailing) | < 20 | < 25 | > 30 |
| PEG ratio | < 1.0 | < 1.5 | > 2.0 |
| Forward P/E | < 18 | < 22 | > 28 |
| P/B ratio | < 2 | < 3 | > 5 |
| ROE | > 20% | > 15% | < 10% |

---

## Sector Benchmarks

| Fund | Benchmark ETF | What it tracks |
|------|--------------|----------------|
| Financial | SPY | S&P 500 |
| Healthcare | IYH | US Healthcare |
| Aerospace | ITA | US Aerospace & Defense |
| Food Staples | VDC | Consumer Staples |
| Utility | XLU | US Utilities |
| Technology | QQQ | NASDAQ-100 |

---

## Investment Playbook

Per-user methodology (strategy, philosophy, risk, allocation, buy/sell rules, rebalancing, watchlists). Unconfigured users get balanced defaults. Guided wizard: *“Help me set up my playbook”*.

Full documentation: **[Playbook](playbook.html)**

| Tool / skill | Role |
|--------------|------|
| `get_playbook` / `update_playbook` | Read or change settings |
| `playbook-setup` skill | Patient one-question wizard (user-initiated) |
| `portfolio_analyzer` | Applies playbook-derived thresholds on saved portfolios |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                Utarus Agent (TypeScript)               │
│                                                       │
│  ┌──────────────┐    ┌───────────────────┐           │
│  │  DeepSeek LLM │    │  Telegram / Slack │           │
│  └──────┬───────┘    └────────┬──────────┘           │
│         │                     │                       │
│         ▼                     ▼                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │                   Tools Layer                    │ │
│  │  portfolio · playbook · analyzer · reports       │ │
│  │            │                       │             │ │
│  │            ▼                       ▼             │ │
│  │  ┌──────────────────────────────────────────┐   │ │
│  │  │  User State (data/users/<slug>.yaml)      │   │ │
│  │  │  ├── portfolio: { AAPL: {...}, ... }      │   │ │
│  │  │  └── playbook:  { strategy, risk, ... }   │   │ │
│  │  └──────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────┘ │
│                         │                             │
│                         ▼                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │              src/market/ + src/playbook/         │ │
│  │  Prices · Targets · Metrics · 3-Axis Analyzer    │ │
│  │  (thresholds tilted by user playbook)            │ │
│  └─────────────────────────────────────────────────┘ │
│                         │                             │
│                         ▼                             │
│                  Yahoo Finance API                     │
└──────────────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| `src/market/` | Market data fetching and analysis engine |
| `src/market/fetch-prices.ts` | Real-time stock prices via yahoo-finance2 |
| `src/market/fetch-targets.ts` | Analyst price targets (low/median/mean/high) |
| `src/market/fetch-metrics.ts` | Financial metrics (P/E, PEG, ROE, P/B) |
| `src/market/analyzer.ts` | 3-axis analysis engine (playbook-aware thresholds) |
| `src/playbook/` | Types, defaults, resolve, guidance, threshold tilt |
| `src/tools/portfolio.ts` | Portfolio CRUD tools (add/remove/update/get/clear) |
| `src/tools/playbook.ts` | `get_playbook` / `update_playbook` |
| `src/tools/portfolio_analyzer.ts` | Analysis tool — reads saved portfolio or ad-hoc |
| `src/skills/knowledge/investment-analysis.md` | Skill document with investment knowledge |
| `src/skills/knowledge/playbook-setup.md` | Patient playbook configuration wizard |

---

## Configuration

### Environment Variables

```env
DEEPSEEK_API_KEY=sk-...        # Required — DeepSeek API key
UTARUS_AGENT_NAME=...          # Agent display name
UTARUS_AGENT_PURPOSE=...       # Agent purpose description
TELEGRAM_BOT_TOKEN=...         # Optional — Telegram bot
TELEGRAM_ADMIN_IDS=...         # Optional — Telegram admin IDs
UTARUS_DATA_ROOT=./data        # Data storage path
```

### Supported Tickers

The agent supports all US-listed stocks available on Yahoo Finance. Pre-configured company names for 84 tickers across 6 sectors.

---

## Project Links

- **Source Code**: [github.com/Judeqiu/invage](https://github.com/Judeqiu/invage)
- **Built on**: [Utarus Framework](https://github.com/Judeqiu/utarus)
- **Data Source**: [Yahoo Finance](https://finance.yahoo.com)

---

*This is not financial advice. Always do your own research before making investment decisions.*
