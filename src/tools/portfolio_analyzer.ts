import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchPrices,
  fetchTargets,
  fetchMetrics,
  runFullAnalysis,
  assessValue,
  rankValueCandidates,
  COMPANIES,
  equityKeys,
} from '../market/index.js';
import {
  defaultValueThresholds,
  valueThresholdsFromPlaybook,
  type ValueThresholds,
} from '../market/value-assess.js';
import type { FinancialMetrics, Holding, ValueAssessment } from '../market/index.js';
import { thresholdsForPlaybook } from '../playbook/index.js';
import { getPlaybook, getPortfolio } from '../state/portfolio-state.js';
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

function pct(decimal: number | null | undefined, digits = 1): string {
  if (decimal == null) return 'N/A';
  return `${(decimal * 100).toFixed(digits)}%`;
}

function num(n: number | null | undefined, digits = 1): string {
  if (n == null) return 'N/A';
  return n.toFixed(digits);
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

function formatMetricsBlock(m: FinancialMetrics): string {
  const lines = [
    `  P/E: ${num(m.trailingPE)} | Fwd P/E: ${num(m.forwardPE)} | PEG: ${num(m.pegRatio, 2)} | P/B: ${num(m.priceToBook, 2)}`,
    `  ROE: ${pct(m.returnOnEquity)} | ROA: ${pct(m.returnOnAssets)} | Op margin: ${pct(m.operatingMargins)}`,
    `  FCF yield: ${pct(m.fcfYield)} | Earn yield: ${pct(m.earningsYield)} | EV/EBITDA: ${num(m.enterpriseToEbitda)}`,
    `  D/E: ${num(m.debtToEquity, 1)} | Rev growth: ${pct(m.revenueGrowth)} | Sector: ${m.sector}`,
  ];
  if (m.fetchError) {
    lines.push(`  ⚠ metrics fetch error: ${m.fetchError}`);
  }
  return lines.join('\n');
}

function formatValueSection(assessments: ValueAssessment[]): string {
  if (assessments.length === 0) return '';
  const ranked = rankValueCandidates(assessments);
  const lines = [
    '── VALUE SCREEN (cheap ∩ quality ∩ trap) ──',
    '  Ranked for undervalued candidates. Trap HIGH/ELEVATED → do not buy on cheapness alone.',
    '',
  ];
  for (const a of ranked) {
    lines.push(
      `  ${a.ticker.padEnd(6)} cheapness=${a.cheapness.padEnd(7)} quality=${a.quality.padEnd(7)} trap=${a.trapRisk}`,
    );
    const top = a.signals.slice(0, 3);
    for (const s of top) {
      lines.push(`         · ${s}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function createPortfolioAnalyzerTool(): AgentTool {
  return {
    name: 'portfolio_analyzer',
    label: 'PortfolioAnalyzer',
    description: `Analyze investment portfolio positions using the 3-axis framework and value screen (cheapness, quality, trap risk). Modes: (1) telegram_user_id or slack_user_id for saved portfolio, (2) tickers + holdings JSON ad-hoc, (3) tickers only for market data + value assessment. Channel IDs always from message context.`,
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
        let valueTh: ValueThresholds = defaultValueThresholds();
        let analysisTh = undefined as ReturnType<typeof thresholdsForPlaybook> | undefined;
        let playbookNote = '';

        if (params.telegram_user_id != null || params.slack_user_id) {
          const state = resolveInvestorFromChannel(params);
          holdings = getPortfolio(state);
          if (Object.keys(holdings).length === 0) {
            return fail('No portfolio saved. Use add_holding to build a portfolio first.');
          }
          tickerList = equityKeys(holdings);
          const pb = getPlaybook(state);
          analysisTh = thresholdsForPlaybook(pb);
          valueTh = valueThresholdsFromPlaybook(analysisTh);
          playbookNote =
            `Playbook: ${pb.strategy} / ${pb.philosophy} / risk=${pb.risk.profile} ` +
            `(buy≥${analysisTh.buyMinUpsidePct}% strong≥${analysisTh.strongBuyUpsidePct}% | ` +
            `max pos ${pb.risk.position_limit_pct}% sector ${pb.risk.sector_exposure_pct}%)\n\n`;
        } else if (params.holdings) {
          holdings = JSON.parse(params.holdings) as Record<string, Holding>;
          tickerList = equityKeys(holdings);
        } else if (params.tickers) {
          tickerList = params.tickers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
          if (tickerList.length === 0) {
            return fail('tickers string is empty after parse.');
          }
        } else {
          return fail(
            'Provide telegram_user_id or slack_user_id (saved portfolio), tickers (market data), or holdings (ad-hoc).',
          );
        }

        // Options use stored marks — only fetch Yahoo data for equity tickers.
        const [prices, targets, metrics] =
          tickerList.length > 0
            ? await Promise.all([
                fetchPrices(tickerList),
                fetchTargets(tickerList),
                fetchMetrics(tickerList),
              ])
            : [{}, {}, {} as Record<string, FinancialMetrics>];

        const safeAssessments =
          tickerList.length > 0
            ? tickerList.map((t) => {
                const m = metrics[t];
                if (!m) {
                  throw new Error(`portfolio_analyzer: metrics missing for ${t} after fetchMetrics`);
                }
                return assessValue(m, valueTh);
              })
            : [];

        if (holdings) {
          const result = runFullAnalysis(holdings, prices, targets, analysisTh);
          const optionRows = result.fullAnalysis.filter((s) => s.instrument === 'option');
          const equityRows = result.fullAnalysis.filter((s) => s.instrument !== 'option');

          const buyLabel = analysisTh
            ? `BUY OPPORTUNITIES — ≥${analysisTh.buyMinUpsidePct}% Upside to Median`
            : 'BUY OPPORTUNITIES — ≥15% Upside to Median';
          let output = `Portfolio Analysis — ${result.fullAnalysis.length} positions`;
          output += ` (${equityRows.length} equity, ${optionRows.length} option)\n\n`;
          output += playbookNote;
          output += formatAnalysisSection('LAGGARDS — Cost > Analyst High Target', '🔴', result.laggards);
          output += formatAnalysisSection('OVERPRICED — Price Above Median Target', '🟡', result.overpriced);
          output += formatAnalysisSection(buyLabel, '🟢', result.buyOpportunities);

          if (optionRows.length > 0) {
            output += '── OPTIONS ──\n';
            let contingentCash = 0;
            let premiumCollected = 0;
            let premiumPaid = 0;
            for (const s of optionRows) {
              const o = s.option;
              if (!o) continue;
              output += `  ${s.ticker}\n`;
              output += `    ${s.company}\n`;
              output += `    Premium abs: $${(s.premiumAbsolute ?? 0).toFixed(2)} (${o.side}) | Mark: $${s.price.toFixed(2)}/sh\n`;
              output += `    MTM value: $${s.value.toFixed(2)} | P/L: ${s.pl >= 0 ? '+' : ''}$${s.pl.toFixed(2)} (${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(1)}%)\n`;
              if ((s.contingentCashObligation ?? 0) > 0) {
                output += `    Contingent cash obligation: $${s.contingentCashObligation!.toFixed(2)}\n`;
                contingentCash += s.contingentCashObligation!;
              }
              if ((s.contingentShareObligation ?? 0) > 0) {
                output += `    Contingent share delivery: ${s.contingentShareObligation} ${o.underlying}\n`;
              }
              if (o.side === 'short') premiumCollected += s.premiumAbsolute ?? 0;
              else premiumPaid += s.premiumAbsolute ?? 0;
              output += '\n';
            }
            if (premiumCollected > 0) {
              output += `  Premium collected (shorts): $${premiumCollected.toFixed(2)}\n`;
            }
            if (premiumPaid > 0) {
              output += `  Premium paid (longs): $${premiumPaid.toFixed(2)}\n`;
            }
            if (contingentCash > 0) {
              output += `  Total contingent cash obligation: $${contingentCash.toFixed(2)}\n`;
            }
            output += '\n';
          }

          output += formatValueSection(safeAssessments);

          output += '── FULL PORTFOLIO (by P/L) ──\n';
          const sorted = [...result.fullAnalysis].sort((a, b) => b.plPct - a.plPct);
          for (const s of sorted) {
            const tag = s.instrument === 'option' ? 'OPT' : 'EQ ';
            output += `  [${tag}] ${s.ticker.padEnd(22)} ${s.company.padEnd(36)} ${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(1)}% (mark $${s.price.toFixed(2)})\n`;
            if (s.instrument !== 'option') {
              const m = metrics[s.ticker];
              if (m) {
                output += formatMetricsBlock(m) + '\n';
              }
            }
          }

          return ok(output, { ...result, metrics, valueAssessments: safeAssessments });
        }

        let output = `Market Data for ${tickerList.join(', ')}\n\n`;
        for (const ticker of tickerList) {
          const price = prices[ticker];
          const t = targets[ticker] ?? {};
          const m = metrics[ticker];
          if (!m) {
            throw new Error(`portfolio_analyzer: metrics missing for ${ticker}`);
          }
          const a = assessValue(m, valueTh);
          const name = COMPANIES[ticker] ?? m.shortName ?? ticker;
          output += `${ticker} (${name})\n`;
          output += `  Price: ${price != null ? '$' + price.toFixed(2) : 'N/A'}`;
          output += ` | Median Target: ${t.targetMedianPrice != null ? '$' + t.targetMedianPrice.toFixed(2) : 'N/A'}`;
          if (price && t.targetMedianPrice) {
            const upside = (((t.targetMedianPrice - price) / price) * 100).toFixed(1);
            output += ` (upside: ${upside}%)`;
          }
          output += `\n${formatMetricsBlock(m)}\n`;
          output += `  Value: cheapness=${a.cheapness} | quality=${a.quality} | trapRisk=${a.trapRisk}\n`;
          for (const s of a.signals.slice(0, 4)) {
            output += `    · ${s}\n`;
          }
          output += '\n';
        }

        output += formatValueSection(safeAssessments);

        return ok(output, {
          prices,
          targets,
          metrics,
          valueAssessments: safeAssessments,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(`Portfolio analysis failed: ${message}`);
      }
    },
  };
}
