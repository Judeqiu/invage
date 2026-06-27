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
import { resolveUserByTelegramUser } from '../state/index.js';

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

function getSavedPortfolio(telegramUserId: number): Record<string, Holding> | null {
  const state = resolveUserByTelegramUser(telegramUserId);
  if (!state) return null;
  return (state as unknown as { portfolio?: Record<string, Holding> }).portfolio ?? null;
}

export function createPortfolioAnalyzerTool(): AgentTool {
  return {
    name: 'portfolio_analyzer',
    label: 'PortfolioAnalyzer',
    description: `Analyze investment portfolio positions using the 3-axis framework. Three modes: (1) Pass telegram_user_id to analyze the user's saved portfolio, (2) Pass tickers + holdings JSON for ad-hoc analysis, (3) Pass only tickers for market data summary. The telegram_user_id is always from the message context — never ask the user for it.`,
    parameters: Type.Object({
      telegram_user_id: Type.Optional(Type.Number({ description: 'Telegram user ID from the message context. Loads saved portfolio and analyzes all positions. Use when the user wants to analyze their saved portfolio.' })),
      tickers: Type.Optional(Type.String({ description: 'Comma-separated ticker symbols. Required if telegram_user_id is not provided.' })),
      holdings: Type.Optional(Type.String({ description: 'JSON string mapping tickers to cost info. Only used when telegram_user_id is not provided.' })),
    }),
    async execute(_id, raw) {
      const params = raw as { telegram_user_id?: number; tickers?: string; holdings?: string };

      try {
        let holdings: Record<string, Holding> | null = null;
        let tickerList: string[] = [];

        // Mode 1: Load from saved portfolio
        if (params.telegram_user_id) {
          holdings = getSavedPortfolio(params.telegram_user_id);
          if (!holdings || Object.keys(holdings).length === 0) {
            return fail(`No portfolio saved for Telegram user ${params.telegram_user_id}. Use add_holding to build a portfolio first.`);
          }
          tickerList = Object.keys(holdings);
        }
        // Mode 2: Ad-hoc holdings JSON
        else if (params.holdings) {
          holdings = JSON.parse(params.holdings) as Record<string, Holding>;
          tickerList = Object.keys(holdings);
        }
        // Mode 3: Tickers only
        else if (params.tickers) {
          tickerList = params.tickers.split(',').map(t => t.trim().toUpperCase());
        } else {
          return fail('Provide either telegram_user_id (saved portfolio), tickers (market data), or holdings (ad-hoc analysis).');
        }

        // Fetch all market data in parallel
        const [prices, targets, metrics] = await Promise.all([
          fetchPrices(tickerList),
          fetchTargets(tickerList),
          fetchMetrics(tickerList),
        ]);

        // Run 3-axis analysis if holdings available
        if (holdings) {
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

        // Market data summary only
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
