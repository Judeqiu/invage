# Investment Analysis

This skill provides the 3-axis investment analysis framework used to evaluate portfolio positions. It covers financial metrics interpretation, position classification, and actionable recommendations.

## When to load

Load when the user asks about portfolio analysis, stock evaluation, investment recommendations, P/E ratios, analyst targets, buy/sell decisions, portfolio performance, or "what should I do with my stocks". Also load when discussing financial metrics like PEG, ROE, forward P/E, or price-to-book ratios.

## What you need to know

### 3-Axis Analysis Framework

Every position is evaluated through three analytical lenses:

**1. Laggards — Cost Price > Analyst High Target**
Positions where the investor's average cost exceeds the highest analyst price target. These are underwater with limited recovery path.
- Loss > 30%: SELL — Deep loss, no recovery path
- Loss 15-30%: HOLD — Monitor for catalyst
- Loss < 15%: REDUCE COST — Average down if fundamentals strong

**2. Overpriced — Current Price > Analyst Median Target**
Positions trading above the median analyst target. May be overvalued.
- Premium > 20% over median: TAKE PROFIT — Significant overvaluation
- Premium 10-20%: TRAIL STOP — Protect gains
- Premium < 10%: HOLD — Slight premium, momentum may continue

**3. Buy Opportunities — Upside to Median > 15%**
Positions where current price is well below the median analyst target.
- Upside > 30%: STRONG BUY — High conviction
- Upside 20-30%: BUY — Moderate conviction
- Upside 15-20%: WATCH — Interesting, monitor

### Financial Metrics Guide

| Metric | Good | Attractive | Expensive |
|--------|------|------------|-----------|
| P/E (trailing) | < 20 | < 25 | > 30 |
| PEG ratio | < 1.0 | < 1.5 | > 2.0 |
| Forward P/E | < 18 | < 22 | > 28 |
| P/B ratio | < 2 | < 3 | > 5 |
| ROE | > 20% | > 15% | < 10% |

### Sector Benchmarks

| Fund | Benchmark ETF | What it tracks |
|------|--------------|----------------|
| Financial | SPY | S&P 500 |
| Healthcare | IYH | US Healthcare |
| Aerospace | ITA | US Aerospace & Defense |
| Food Staples | VDC | Consumer Staples |
| Utility | XLU | US Utilities |
| Technology | QQQ | NASDAQ-100 |

### Recommendation Classification

When analyzing a position, always provide:
1. Current price vs cost basis (P/L %)
2. Current price vs analyst targets (median, mean, high)
3. Key financial metrics (P/E, PEG, ROE)
4. Classification (Laggard / Overpriced / Opportunity / Normal)
5. Specific recommendation with reasoning

## Hard rules

- Never give buy/sell recommendations without showing the underlying analyst consensus data.
- Always display both the median and high analyst targets when available.
- Flag any position with >30% unrealized loss as high risk.
- Do not recommend averaging down without checking that fundamentals (P/E, ROE) support it.
- When data is unavailable for a ticker, say so explicitly — never estimate or guess.
