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
import { getPortfolio } from '../state/portfolio-state.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}

function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

function formatAnalysisSection(
  title: string,
  icon: string,
  positions: Awaited<ReturnType<typeof runFullAnalysis>>['laggards'],
): string {
  if (positions.length === 0) return `${icon} ${title}\nNo positions found.\n`;
  const lines = [`${icon} ${title} (${positions.length})`, ''];
  for (const s of positions) {
    lines.push(
      `  ${s.ticker.padEnd(6)} | ${s.company.padEnd(28)} | P/L: ${(s.plPct >= 0 ? '+' : '') + s.plPct.toFixed(1)}% | Cost: $${s.avgCost.toFixed(2)} | Price: $${s.price.toFixed(2)}`,
    );
    if (s.targetMedian != null) {
      lines.push(
        `         ↳ Median Target: $${s.targetMedian.toFixed(2)} | Upside: ${s.upsideToMedian != null ? (s.upsideToMedian >= 0 ? '+' : '') + s.upsideToMedian.toFixed(1) + '%' : 'N/A'}`,
      );
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
    description: `Analyze investment portfolio positions using the 3-axis framework. Modes: (1) telegram_user_id or slack_user_id for saved portfolio, (2) tickers + holdings JSON ad-hoc, (3) tickers only for market data. Channel IDs always from message context.`,
    parameters: Type.Object({
      ...channelIdParams,
      tickers: Type.Optional(
        Type.String({
          description: 'Comma-separated ticker symbols. Used when no channel id is provided.',
        }),
      ),
      holdings: Type.Optional(
        Type.String({
          description: 'JSON string mapping tickers to cost info. Ad-hoc analysis only.',
        }),
      ),
    }),
    async execute(_id, raw) {
      const params = raw as ChannelIds & { tickers?: string; holdings?: string };

      try {
        let holdings: Record<string, Holding> | null = null;
        let tickerList: string[] = [];

        if (params.telegram_user_id != null || params.slack_user_id) {
          const state = resolveInvestorFromChannel(params);
          holdings = getPortfolio(state);
          if (Object.keys(holdings).length === 0) {
            return fail('No portfolio saved. Use add_holding to build a portfolio first.');
          }
          tickerList = Object.keys(holdings);
        } else if (params.holdings) {
          holdings = JSON.parse(params.holdings) as Record<string, Holding>;
          tickerList = Object.keys(holdings);
        } else if (params.tickers) {
          tickerList = params.tickers.split(',').map((t) => t.trim().toUpperCase());
        } else {
          return fail(
            'Provide telegram_user_id or slack_user_id (saved portfolio), tickers (market data), or holdings (ad-hoc).',
          );
        }

        const [prices, targets, metrics] = await Promise.all([
          fetchPrices(tickerList),
          fetchTargets(tickerList),
          fetchMetrics(tickerList),
        ]);

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
            const upside = (((t.targetMedianPrice - price) / price) * 100).toFixed(1);
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
