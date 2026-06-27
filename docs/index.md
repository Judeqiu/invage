---
layout: default
title: Invester — AI Investment Portfolio Analyzer
---

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

## Architecture

```
┌─────────────────────────────────────────────┐
│           Utarus Agent (TypeScript)          │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │  DeepSeek LLM │    │  Telegram Bot     │  │
│  └──────┬───────┘    └────────┬──────────┘  │
│         │                     │              │
│         ▼                     ▼              │
│  ┌──────────────────────────────────────┐   │
│  │         portfolio_analyzer tool       │   │
│  └──────────────────┬───────────────────┘   │
│                     │                        │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │  Prices  │ │  Targets │ │  Metrics │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│         │           │           │            │
│         └───────────┼───────────┘            │
│                     ▼                        │
│           ┌──────────────┐                   │
│           │   Analyzer   │                   │
│           │  (3-Axis)    │                   │
│           └──────────────┘                   │
│                     │                        │
│                     ▼                        │
│              Yahoo Finance API                │
└─────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| `src/market/` | Market data fetching and analysis engine |
| `src/market/fetch-prices.ts` | Real-time stock prices via yahoo-finance2 |
| `src/market/fetch-targets.ts` | Analyst price targets (low/median/mean/high) |
| `src/market/fetch-metrics.ts` | Financial metrics (P/E, PEG, ROE, P/B) |
| `src/market/analyzer.ts` | 3-axis analysis engine |
| `src/tools/portfolio_analyzer.ts` | Utarus tool that exposes analysis to the LLM |
| `src/skills/knowledge/investment-analysis.md` | Skill document with investment knowledge |

---

## Usage Examples

### Check a Stock

Ask the agent:
> "What's the current price and analyst target for AAPL?"

The agent will fetch real-time data and show price, targets, and key metrics.

### Analyze a Portfolio

Provide holdings data:
> "Analyze my portfolio: AAPL at $200 avg cost (50 shares), MSFT at $300 (30 shares), GOOGL at $140 (40 shares)"

The agent runs the 3-axis analysis and classifies each position.

### Get Buy Recommendations

> "Which of my positions have the most upside?"

The agent identifies Buy Opportunities (>15% upside to median target).

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
