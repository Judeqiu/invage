import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchPrices,
  fetchTargets,
  fetchMetrics,
  runFullAnalysis,
  COMPANIES,
} from '../market/index.js';
import type { Holding } from '../market/index.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}

function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

function formatAnalysisSection(title: string, icon: string, positions: Awaited<ReturnType<typeof runFullAnalysis>>['laggards']): string {
  if (positions.length === 0) return `${icon} ${title}\nNo positions found.\n`;
  const lines = [`${icon} ${title} (${positions.length})`, ''];
  for (const s of positions) {
    lines.push(`  ${s.ticker.padEnd(6)} | ${s.company.padEnd(28)} | P/L: ${(s.plPct >= 0 ? '+' : '') + s.plPct.toFixed(1)}% | Cost: $${s.avgCost.toFixed(2)} | Price: $${s.price.toFixed(2)}`);
    if (s.targetMedian != null) {
      lines.push(`         ↳ Median Target: $${s.targetMedian.toFixed(2)} | Upside: ${s.upsideToMedian != null ? (s.upsideToMedian >= 0 ? '+' : '') + s.upsideToMedian.toFixed(1) + '%' : 'N/A'}`);
    }
    if (s.recommendation) {
      lines.push(`         ↳ ${s.recommendation}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function createPortfolioAnalyzerTool(): AgentTool {
  return {
    name: 'portfolio_analyzer',
    label: 'PortfolioAnalyzer',
    description: `Analyze investment portfolio positions using the 3-axis framework. Accepts ticker symbols, fetches current prices and analyst targets from Yahoo Finance, then classifies positions as: (1) Laggards — cost above highest analyst target, (2) Overpriced — current price above median analyst target, (3) Buy Opportunities — >15% upside to median target. Returns ranked analysis with recommendations. Use when the user asks about portfolio performance, stock analysis, buy/sell decisions, or investment opportunities.`,
    parameters: Type.Object({
      tickers: Type.String({ description: 'Comma-separated ticker symbols to analyze (e.g. "AAPL,MSFT,GOOGL")' }),
      holdings: Type.Optional(Type.String({ description: 'JSON string mapping tickers to cost info: {"AAPL": {"avg_price": 150, "units": 100, "category": "SL Technology S1"}. If omitted, only fetches market data without position analysis.' })),
    }),
    async execute(_id, raw) {
      const params = raw as Record<string, unknown>;
      const tickers = params.tickers as string;
      const holdingsJson = params.holdings as string | undefined;

      try {
        const tickerList = tickers.split(',').map(t => t.trim().toUpperCase());

        // Fetch all market data in parallel
        const [prices, targets, metrics] = await Promise.all([
          fetchPrices(tickerList),
          fetchTargets(tickerList),
          fetchMetrics(tickerList),
        ]);

        // If holdings provided, run full 3-axis analysis
        if (holdingsJson) {
          const holdings: Record<string, Holding> = JSON.parse(holdingsJson);
          const result = runFullAnalysis(holdings, prices, targets);

          let output = `Portfolio Analysis — ${result.fullAnalysis.length} positions\n\n`;
          output += formatAnalysisSection('LAGGARDS — Cost > Analyst High Target', '🔴', result.laggards);
          output += formatAnalysisSection('OVERPRICED — Price Above Median Target', '🟡', result.overpriced);
          output += formatAnalysisSection('BUY OPPORTUNITIES — >15% Upside to Median', '🟢', result.buyOpportunities);

          output += '── FULL PORTFOLIO (by P/L) ──\n';
          const sorted = [...result.fullAnalysis].sort((a, b) => b.plPct - a.plPct);
          for (const s of sorted) {
            output += `  ${s.ticker.padEnd(6)} ${s.company.padEnd(28)} ${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(1)}% ($${s.price.toFixed(2)})\n`;
          }

          return ok(output, result);
        }

        // No holdings — return market data summary
        let output = `Market Data for ${tickerList.join(', ')}\n\n`;
        for (const ticker of tickerList) {
          const price = prices[ticker];
          const t = targets[ticker] ?? {};
          const m = metrics[ticker] ?? {};
          const name = COMPANIES[ticker] ?? ticker;
          output += `${ticker} (${name})\n`;
          output += `  Price: ${price != null ? '$' + price.toFixed(2) : 'N/A'}`;
          output += ` | Median Target: ${t.targetMedianPrice != null ? '$' + t.targetMedianPrice.toFixed(2) : 'N/A'}`;
          if (price && t.targetMedianPrice) {
            const upside = ((t.targetMedianPrice - price) / price * 100).toFixed(1);
            output += ` (upside: ${upside}%)`;
          }
          output += `\n  P/E: ${m.trailingPE?.toFixed(1) ?? 'N/A'} | PEG: ${m.pegRatio?.toFixed(2) ?? 'N/A'} | ROE: ${m.returnOnEquity != null ? (m.returnOnEquity * 100).toFixed(1) + '%' : 'N/A'}\n\n`;
        }

        return ok(output, { prices, targets, metrics });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(`Portfolio analysis failed: ${message}`);
      }
    },
  };
}
