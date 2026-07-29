import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchPrices,
  fetchPriceSnapshots,
  formatPriceSnapshot,
  fetchTargets,
  fetchMetrics,
  runFullAnalysis,
  assessValue,
  rankValueCandidates,
  COMPANIES,
  equityQuoteSymbols,
  resolvePortfolioMarket,
} from '../market/index.js';
import type { OptionLiveMark, YahooPriceSnapshot } from '../market/index.js';
import {
  defaultValueThresholds,
  valueThresholdsFromPlaybook,
  type ValueThresholds,
} from '../market/value-assess.js';
import type { FinancialMetrics, Holding, ValueAssessment } from '../market/index.js';
import { thresholdsForPlaybook } from '../playbook/index.js';
import {
  cashStrategyMetrics,
  getCashes,
  getDeposits,
  getPlaybook,
  getPortfolio,
  totalDepositsPrincipal,
  type CashBalance,
} from '../state/portfolio-state.js';
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

function contingentCashFromOptions(
  rows: Awaited<ReturnType<typeof runFullAnalysis>>['fullAnalysis'],
): number {
  let sum = 0;
  for (const s of rows) {
    if ((s.contingentCashObligation ?? 0) > 0) {
      sum += s.contingentCashObligation!;
    }
  }
  return sum;
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

        let channelCashes: CashBalance[] = [];
        let cashTargetPct = 5;
        let depositsPrincipal = 0;
        let depositCount = 0;

        if (params.telegram_user_id != null || params.slack_user_id || params.user_slug) {
          const state = resolveInvestorFromChannel(params);
          holdings = getPortfolio(state);
          if (Object.keys(holdings).length === 0) {
            return fail('No portfolio saved. Use add_holding to build a portfolio first.');
          }
          tickerList = equityQuoteSymbols(holdings);
          const pb = getPlaybook(state);
          analysisTh = thresholdsForPlaybook(pb);
          valueTh = valueThresholdsFromPlaybook(analysisTh);
          channelCashes = getCashes(state);
          cashTargetPct = pb.allocation.cash_target_pct;
          const deposits = getDeposits(state);
          depositCount = deposits.length;
          const depTotal = totalDepositsPrincipal(deposits);
          depositsPrincipal = depTotal?.amount ?? 0;
          playbookNote =
            `Playbook: ${pb.strategy} / ${pb.philosophy} / risk=${pb.risk.profile} ` +
            `(buy≥${analysisTh.buyMinUpsidePct}% strong≥${analysisTh.strongBuyUpsidePct}% | ` +
            `max pos ${pb.risk.position_limit_pct}% sector ${pb.risk.sector_exposure_pct}% | ` +
            `cash target ${cashTargetPct}%)\n\n`;
        } else if (params.holdings) {
          holdings = JSON.parse(params.holdings) as Record<string, Holding>;
          tickerList = equityQuoteSymbols(holdings);
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

        let prices: Record<string, number> = {};
        let priceSnapshots: Record<string, YahooPriceSnapshot> = {};
        let targets: Awaited<ReturnType<typeof fetchTargets>> = {};
        let metrics: Record<string, FinancialMetrics> = {};
        let valuedHoldings = holdings;
        let optionMarks: Record<string, OptionLiveMark> = {};

        if (holdings) {
          const resolved = await resolvePortfolioMarket(holdings);
          valuedHoldings = resolved.portfolio;
          prices = resolved.equityPrices;
          optionMarks = resolved.optionMarks;
          if (tickerList.length > 0) {
            const [snaps, t, m] = await Promise.all([
              fetchPriceSnapshots(tickerList),
              fetchTargets(tickerList),
              fetchMetrics(tickerList),
            ]);
            priceSnapshots = snaps;
            // Prefer snapshot prices (explicit field selection) over bare quote map
            for (const [tk, snap] of Object.entries(snaps)) {
              prices[tk] = snap.price;
            }
            targets = t;
            metrics = m;
          }
        } else if (tickerList.length > 0) {
          const [snaps, t, m] = await Promise.all([
            fetchPriceSnapshots(tickerList),
            fetchTargets(tickerList),
            fetchMetrics(tickerList),
          ]);
          priceSnapshots = snaps;
          for (const [tk, snap] of Object.entries(snaps)) {
            prices[tk] = snap.price;
          }
          targets = t;
          metrics = m;
        }

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

        if (valuedHoldings) {
          const result = runFullAnalysis(valuedHoldings, prices, targets, analysisTh);
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
              const markMeta = optionMarks[s.ticker];
              const src =
                markMeta?.source === 'yahoo'
                  ? `yahoo${markMeta.contractSymbol ? ` ${markMeta.contractSymbol}` : ''}`
                  : `manual${markMeta?.note ? ` (${markMeta.note})` : ''}`;
              output += `  ${s.ticker}\n`;
              output += `    ${s.company}\n`;
              output += `    Premium: $${(s.premiumAbsolute ?? 0).toFixed(2)} (${o.side}) | Mark: $${s.price.toFixed(2)}/ct [${src}]\n`;
              output += `    MTM value: $${s.value.toFixed(2)} | P/L: ${s.pl >= 0 ? '+' : ''}$${s.pl.toFixed(2)} (${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(1)}%)\n`;
              if ((s.contingentCashObligation ?? 0) > 0) {
                output += `    Contingent cash if assigned (not current MTM): $${s.contingentCashObligation!.toFixed(2)}\n`;
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
            const tag =
              s.instrument === 'option' ? 'OPT' : s.instrument === 'fund' ? 'FND' : 'EQ ';
            output += `  [${tag}] ${s.ticker.padEnd(22)} ${s.company.padEnd(36)} ${s.plPct >= 0 ? '+' : ''}${s.plPct.toFixed(1)}% (mark $${s.price.toFixed(2)})\n`;
            if (s.instrument !== 'option') {
              const m = metrics[s.ticker];
              if (m) {
                output += formatMetricsBlock(m) + '\n';
              }
            }
          }

          const positionsValue = result.fullAnalysis.reduce((sum, s) => sum + s.value, 0);
          const cashMetrics = cashStrategyMetrics(
            channelCashes,
            positionsValue,
            cashTargetPct,
            depositsPrincipal,
          );
          output += '\n── CASH & NAV (strategy) ──\n';
          if (cashMetrics.cash == null) {
            output +=
              '  Free cash: not recorded. Use set_cash so dry powder, cash weight, and cash_target_pct drift are known.\n';
            output += `  Positions MTM: $${positionsValue.toFixed(2)}\n`;
            if (depositsPrincipal > 0) {
              output += `  Fixed deposits principal: $${depositsPrincipal.toFixed(2)} (${depositCount} term${depositCount === 1 ? '' : 's'}; not free cash)\n`;
              output += `  Total NAV (positions + deposits): $${cashMetrics.totalNav.toFixed(2)}\n`;
            } else {
              output += `  NAV (positions only): $${cashMetrics.totalNav.toFixed(2)}\n`;
            }
            output += `  Playbook cash target: ${cashTargetPct}%\n`;
          } else {
            const c = cashMetrics.cash;
            const drift = cashMetrics.cashVsTargetPp!;
            const driftLabel =
              Math.abs(drift) < 0.05
                ? 'on target'
                : drift > 0
                  ? `${drift.toFixed(1)} pp above target (more free cash / less invested)`
                  : `${Math.abs(drift).toFixed(1)} pp below target (more invested / less free cash)`;
            if (cashMetrics.cashes.length > 1) {
              output += '  Free cash by channel:\n';
              for (const row of cashMetrics.cashes) {
                const ch = row.channel ?? '(unassigned)';
                output += `    ${ch}: ${row.amount.toFixed(2)} ${row.currency} (updated ${row.updated_at})\n`;
              }
              output += `  Total free cash: ${c.amount.toFixed(2)} ${c.currency}\n`;
            } else {
              output += `  Free cash: ${c.amount.toFixed(2)} ${c.currency} (updated ${c.updated_at})`;
              if (c.channel) output += ` [${c.channel}]`;
              output += '\n';
            }
            output += `  Positions MTM: $${positionsValue.toFixed(2)}\n`;
            if (depositsPrincipal > 0) {
              output += `  Fixed deposits principal: $${depositsPrincipal.toFixed(2)} (${depositCount} term${depositCount === 1 ? '' : 's'}; locked, not dry powder)\n`;
            }
            output += `  Total NAV (positions + free cash + deposits): $${cashMetrics.totalNav.toFixed(2)}\n`;
            output += `  Free cash weight: ${cashMetrics.cashWeightPct!.toFixed(1)}% | target ${cashTargetPct}% → ${driftLabel}\n`;
            output +=
              '  Sizing: suggest new buys as % of Total NAV; fund from free cash only — never invent cash or spend deposits.\n';
            if (contingentCashFromOptions(result.fullAnalysis) > 0) {
              const oblig = contingentCashFromOptions(result.fullAnalysis);
              const cover = c.amount - oblig;
              output +=
                `  Short-put assignment cover: free cash ${c.amount.toFixed(2)} vs obligation $${oblig.toFixed(2)} → ` +
                (cover >= 0 ? `surplus ${cover.toFixed(2)}` : `shortfall ${Math.abs(cover).toFixed(2)}`) +
                '\n';
            }
          }

          return ok(output, {
            ...result,
            metrics,
            valueAssessments: safeAssessments,
            optionMarks,
            cash: cashMetrics.cash,
            cashes: cashMetrics.cashes,
            positionsValue,
            depositsPrincipal: cashMetrics.depositsPrincipal,
            depositCount,
            totalNav: cashMetrics.totalNav,
            cashWeightPct: cashMetrics.cashWeightPct,
            cashVsTargetPp: cashMetrics.cashVsTargetPp,
            cashTargetPct: cashMetrics.cashTargetPct,
          });
        }

        let output = `Market Data for ${tickerList.join(', ')}\n\n`;
        output +=
          'Price fields: use "Price" as current MTM — do NOT report prevClose as the live price.\n\n';
        for (const ticker of tickerList) {
          const price = prices[ticker];
          const snap = priceSnapshots[ticker];
          const t = targets[ticker] ?? {};
          const m = metrics[ticker];
          if (!m) {
            throw new Error(`portfolio_analyzer: metrics missing for ${ticker}`);
          }
          const a = assessValue(m, valueTh);
          const name = COMPANIES[ticker] ?? m.shortName ?? ticker;
          output += `${ticker} (${name})\n`;
          if (snap) {
            output += `  ${formatPriceSnapshot(snap)}\n`;
          }
          output += `  Price (use this): ${price != null ? '$' + price.toFixed(2) : 'N/A'}`;
          if (snap?.previousClose != null) {
            output += ` | prevClose: $${snap.previousClose.toFixed(2)} (NOT live)`;
          }
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
          priceSnapshots,
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
