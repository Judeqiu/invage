import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchPriceSnapshots,
  formatPriceSnapshot,
} from '../market/fetch-prices.js';
import { equityQuoteSymbol, isOptionHolding } from '../market/position-value.js';
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
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

/**
 * Dedicated live quote tool — use for "current price" questions.
 * Always fetches Yahoo this call; never returns previousClose as "live".
 */
export function createQuoteTool(): AgentTool {
  return {
    name: 'get_quote',
    label: 'Get Quote',
    description:
      'Fetch LIVE stock/ETF prices from Yahoo Finance for one or more tickers. ' +
      'REQUIRED for any "current price", "live price", "what is X trading at", or P/L vs market questions. ' +
      'Call this every time in the same turn — NEVER reuse a price from earlier in the chat, dashboard HTML, or snapshots. ' +
      'Returns current Price (use this), prevClose (NOT live), pre/post when available, marketState. ' +
      'Optional channel id: if provided and ticker is held, also reports cost basis P/L vs LIVE price only.',
    parameters: Type.Object({
      ...channelIdParams,
      tickers: Type.String({
        description: 'Comma-separated tickers, e.g. "IBM" or "IBM,AAPL,MSFT".',
      }),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & { tickers: string };
      try {
        const tickerList = p.tickers
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean);
        if (tickerList.length === 0) {
          return fail('tickers is empty. Pass at least one symbol, e.g. IBM.');
        }

        const snaps = await fetchPriceSnapshots(tickerList);
        const missing = tickerList.filter((t) => !snaps[t]);
        if (missing.length > 0) {
          return fail(
            `No Yahoo quote for: ${missing.join(', ')}. ` +
              `Got: ${Object.keys(snaps).join(', ') || 'none'}. Do not invent prices.`,
          );
        }

        let portfolio: ReturnType<typeof getPortfolio> | null = null;
        try {
          if (p.telegram_user_id != null || p.slack_user_id || p.user_slug) {
            const state = resolveInvestorFromChannel(p);
            portfolio = getPortfolio(state);
          }
        } catch {
          // Quote still works without portfolio
          portfolio = null;
        }

        const lines: string[] = [
          'LIVE QUOTES (Yahoo Finance — this tool call only)',
          'RULE: Report "Price (LIVE)" as the current price. prevClose is NOT the live price.',
          '',
        ];

        const details: Record<
          string,
          {
            live: number;
            prevClose: number | null;
            priceField: string;
            marketState: string | null;
            asOf: string | null;
            post?: number | null;
            pre?: number | null;
            holdingPl?: { cost: number; units: number; avg: number; pl: number; plPct: number };
          }
        > = {};

        for (const t of tickerList) {
          const s = snaps[t];
          lines.push(formatPriceSnapshot(s));
          lines.push(
            `  → Price (LIVE): $${s.price.toFixed(2)}  [${s.priceField}]` +
              (s.marketState ? `  marketState=${s.marketState}` : '') +
              (s.asOf ? `  asOf=${s.asOf}` : ''),
          );
          if (s.previousClose != null) {
            lines.push(
              `  → prevClose: $${s.previousClose.toFixed(2)}  (prior session — NOT live; do not use for "current price")`,
            );
          }
          if (s.postMarketPrice != null && s.priceField !== 'postMarketPrice') {
            lines.push(`  → postMarket: $${s.postMarketPrice.toFixed(2)}`);
          }
          if (s.preMarketPrice != null && s.priceField !== 'preMarketPrice') {
            lines.push(`  → preMarket: $${s.preMarketPrice.toFixed(2)}`);
          }

          let holdingPl:
            | {
                cost: number;
                units: number;
                avg: number;
                pl: number;
                plPct: number;
                lots?: Array<{ key: string; channel?: string; units: number; avg: number; pl: number }>;
              }
            | undefined;
          if (portfolio) {
            const lots = Object.entries(portfolio).filter(
              ([k, h]) => !isOptionHolding(h) && equityQuoteSymbol(k) === t,
            );
            if (lots.length > 0) {
              let totalUnits = 0;
              let totalCost = 0;
              const lotDetails: Array<{
                key: string;
                channel?: string;
                units: number;
                avg: number;
                pl: number;
              }> = [];
              for (const [key, h] of lots) {
                const cost = h.avg_price * h.units;
                const value = s.price * h.units;
                const pl = value - cost;
                totalUnits += h.units;
                totalCost += cost;
                lotDetails.push({
                  key,
                  channel: h.channel,
                  units: h.units,
                  avg: h.avg_price,
                  pl,
                });
                const ch =
                  h.channel != null && h.channel.length > 0 ? ` [${h.channel}]` : '';
                lines.push(
                  `  → Your holding${ch}: ${h.units} sh @ $${h.avg_price.toFixed(2)} cost` +
                    ` | MTM $${value.toFixed(2)} | P/L ${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}` +
                    ` vs LIVE $${s.price.toFixed(2)}` +
                    (lots.length > 1 ? ` (${key})` : ''),
                );
              }
              const totalValue = s.price * totalUnits;
              const pl = totalValue - totalCost;
              const plPct = totalCost > 0 ? (pl / totalCost) * 100 : 0;
              const avg = totalUnits > 0 ? totalCost / totalUnits : 0;
              holdingPl = {
                cost: totalCost,
                units: totalUnits,
                avg,
                pl,
                plPct,
                ...(lots.length > 1 ? { lots: lotDetails } : {}),
              };
              if (lots.length > 1) {
                lines.push(
                  `  → Combined ${t}: ${totalUnits} sh wavg @ $${avg.toFixed(2)}` +
                    ` | MTM $${totalValue.toFixed(2)} | P/L ${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}` +
                    ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%)`,
                );
              }
            }
          }
          lines.push('');

          details[t] = {
            live: s.price,
            prevClose: s.previousClose,
            priceField: s.priceField,
            marketState: s.marketState,
            asOf: s.asOf,
            post: s.postMarketPrice,
            pre: s.preMarketPrice,
            holdingPl,
          };
        }

        return ok(lines.join('\n'), { quotes: details, snapshots: snaps });
      } catch (e) {
        return failFrom(e);
      }
    },
  };
}
