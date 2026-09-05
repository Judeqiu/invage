import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  buildContractInsight,
  findContract,
  formatContractInsight,
  formatMoney,
  loadOptionsChain,
  nearestStrikes,
  putCallOpenInterestRatio,
  atmImpliedVol,
  type ContractInsight,
} from '../market/options-insight.js';
import { pickPerSharePremium as pickPrem } from '../market/fetch-option-marks.js';
import { isOptionHolding } from '../market/position-value.js';
import { getPortfolio } from '../state/portfolio-state.js';
import {
  channelIdParams,
  resolveInvestorFromChannel,
  type ChannelIds,
} from './channel.js';
import { coerceToolNumber } from './coerce-tool-numbers.js';
import type { OptionRight, OptionSide } from '../market/types.js';

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}
function failFrom(error: unknown): AgentToolResult<null> {
  return fail(error instanceof Error ? error.message : String(error));
}

function asRight(raw: unknown): OptionRight {
  if (raw === 'call' || raw === 'put') return raw;
  throw new Error('right must be "call" or "put" when strike is set.');
}

function asSide(raw: unknown): OptionSide {
  if (raw === undefined || raw === null || raw === '') return 'long';
  if (raw === 'long' || raw === 'short') return raw;
  throw new Error('side must be "long" or "short".');
}

function formatExpirySnapshot(chain: Awaited<ReturnType<typeof loadOptionsChain>>): string {
  const atmCallIv = atmImpliedVol(chain.calls, chain.spot);
  const atmPutIv = atmImpliedVol(chain.puts, chain.spot);
  const pcr = putCallOpenInterestRatio(chain.calls, chain.puts);
  const callNear = nearestStrikes(chain.calls, chain.spot, 5);
  const putNear = nearestStrikes(chain.puts, chain.spot, 5);
  const row = (r: (typeof callNear)[0]) => {
    let prem = 'n/a';
    try {
      prem = String(pickPrem(r));
    } catch {
      prem = 'unavailable';
    }
    const iv =
      r.impliedVolatility != null && r.impliedVolatility > 0
        ? `${(r.impliedVolatility * 100).toFixed(1)}%`
        : 'n/a';
    return `  K=${r.strike} prem/sh=${prem} IV=${iv} OI=${r.openInterest ?? 'n/a'} vol=${r.volume ?? 'n/a'}`;
  };
  return [
    `${chain.underlying} options expiry ${chain.expiry}`,
    `Spot: ${formatMoney(chain.spot, chain.currency)}`,
    `ATM IV calls: ${atmCallIv != null ? `${(atmCallIv * 100).toFixed(1)}%` : 'unavailable'} | puts: ${atmPutIv != null ? `${(atmPutIv * 100).toFixed(1)}%` : 'unavailable'}`,
    `Put/call OI ratio: ${pcr ?? 'unavailable'}`,
    `Expirations (Yahoo): ${chain.expirationDates.slice(0, 12).join(', ')}${chain.expirationDates.length > 12 ? '…' : ''}`,
    'Nearest calls:',
    ...callNear.map(row),
    'Nearest puts:',
    ...putNear.map(row),
    'Greeks not in Yahoo chain payload — unavailable, not invented.',
  ].join('\n');
}

/**
 * Listed options chain insight. Required for call/put structure, premium, IV/OI
 * when Yahoo provides them. Never invent Greeks.
 */
export function createOptionsInsightTool(): AgentTool {
  return {
    name: 'options_insight',
    label: 'Options Insight',
    description:
      'Live listed options insight from Yahoo Finance chain: moneyness, intrinsic/extrinsic, ' +
      'breakeven, max loss/gain, IV vs ATM when sourced, open interest, volume, bid/ask. ' +
      'REQUIRED for call/put / chain / covered-call / protective-put / short-premium questions. ' +
      'Pass underlying. With expiry+strike+right → one contract. Expiry only → ATM cluster. ' +
      'Neither → nearest expiry snapshot. Do not invent IV or Greeks. Optional books overlay.',
    parameters: Type.Object({
      ...channelIdParams,
      underlying: Type.String({
        description: 'Yahoo underlying ticker, e.g. AAPL or SPY.',
      }),
      right: Type.Optional(
        Type.String({ description: 'call or put. Required when strike is set.' }),
      ),
      strike: Type.Optional(
        Type.Number({ description: 'Strike per share. Required with right for one-contract insight.' }),
      ),
      expiry: Type.Optional(
        Type.String({ description: 'Expiration YYYY-MM-DD. Omit to use nearest listed expiry.' }),
      ),
      side: Type.Optional(
        Type.String({ description: 'long (default) or short — payoff framing.' }),
      ),
      units: Type.Optional(
        Type.Number({ description: 'Number of contracts (default 1).' }),
      ),
      multiplier: Type.Optional(
        Type.Number({ description: 'Shares per contract (default 100 US equity).' }),
      ),
      include_books: Type.Optional(
        Type.Boolean({
          description: 'If true, overlay matching option lots from the user books (needs channel id).',
        }),
      ),
    }),
    async execute(_id, raw) {
      const p = raw as ChannelIds & {
        underlying: string;
        right?: string;
        strike?: unknown;
        expiry?: string;
        side?: string;
        units?: unknown;
        multiplier?: unknown;
        include_books?: boolean;
      };
      try {
        const underlying = p.underlying?.trim();
        if (!underlying) return fail('underlying is required.');
        const expiry = p.expiry?.trim() || undefined;
        const strike =
          p.strike === undefined || p.strike === null
            ? undefined
            : coerceToolNumber(p.strike, 'strike');
        const units =
          p.units === undefined || p.units === null
            ? 1
            : coerceToolNumber(p.units, 'units');
        const multiplier =
          p.multiplier === undefined || p.multiplier === null
            ? 100
            : coerceToolNumber(p.multiplier, 'multiplier');
        if (!(units > 0) || !(multiplier > 0)) {
          return fail('units and multiplier must be > 0.');
        }

        const chain = await loadOptionsChain(underlying, expiry);

        if (strike != null) {
          const right = asRight(p.right);
          const side = asSide(p.side);
          const rows = right === 'call' ? chain.calls : chain.puts;
          if (!rows.length) {
            return fail(`Yahoo ${right} chain empty for ${chain.underlying} @ ${chain.expiry}.`);
          }
          const row = findContract(rows, strike, chain.expiry);
          const insight = buildContractInsight({
            underlying: chain.underlying,
            right,
            side,
            units,
            multiplier,
            spot: chain.spot,
            currency: chain.currency,
            asOfYmd: chain.asOfYmd,
            expiry: chain.expiry,
            row,
            calls: chain.calls,
            puts: chain.puts,
          });
          let text = formatContractInsight(insight);
          const books = p.include_books ? booksOverlay(p, chain.underlying, insight) : null;
          if (books) text += `\n\n${books}`;
          return ok(text, { insight, expirations: chain.expirationDates, books: books ?? null });
        }

        const text = formatExpirySnapshot(chain);
        const books = p.include_books ? booksLotsSummary(p, chain.underlying) : null;
        return ok(books ? `${text}\n\n${books}` : text, {
          snapshot: {
            underlying: chain.underlying,
            expiry: chain.expiry,
            spot: chain.spot,
            currency: chain.currency,
            expirationDates: chain.expirationDates,
          },
          books: books ?? null,
        });
      } catch (error) {
        return failFrom(error);
      }
    },
  };
}

function booksOverlay(
  p: ChannelIds,
  underlying: string,
  insight: ContractInsight,
): string | null {
  try {
    if (!p.telegram_user_id && !p.slack_user_id && !p.user_slug) {
      throw new Error('include_books requires telegram_user_id, slack_user_id, or user_slug.');
    }
    const state = resolveInvestorFromChannel(p);
    const portfolio = getPortfolio(state);
    const lots = Object.entries(portfolio).filter(([, h]) => {
      if (!isOptionHolding(h) || h.option == null) return false;
      return (
        h.option.underlying.trim().toUpperCase() === underlying.toUpperCase() &&
        h.option.right === insight.right &&
        Math.abs(h.option.strike - insight.strike) < 1e-6 &&
        h.option.expiry === insight.expiry
      );
    });
    if (lots.length === 0) {
      return `BOOKS: no matching ${insight.right} ${insight.strike} ${insight.expiry} lot on ${underlying}.`;
    }
    return lots
      .map(([key, h]) => {
        const o = h.option!;
        const live = insight.economics.premiumPerContract;
        const dir = o.side === 'short' ? -1 : 1;
        const pl = Number((dir * (live - h.avg_price) * h.units).toFixed(2));
        return (
          `BOOKS lot ${key}: ${o.side} ${h.units} ct @ avg ${h.avg_price}/ct ` +
          `stored mark ${o.mark} | live mark ${live} | MTM P/L vs cost ${pl} ${insight.currency} ` +
          `(does not rewrite YAML).`
        );
      })
      .join('\n');
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

function booksLotsSummary(p: ChannelIds, underlying: string): string | null {
  if (!p.telegram_user_id && !p.slack_user_id && !p.user_slug) {
    throw new Error('include_books requires telegram_user_id, slack_user_id, or user_slug.');
  }
  const state = resolveInvestorFromChannel(p);
  const portfolio = getPortfolio(state);
  const lots = Object.entries(portfolio).filter(([, h]) => {
    if (!isOptionHolding(h) || h.option == null) return false;
    return h.option.underlying.trim().toUpperCase() === underlying.toUpperCase();
  });
  if (lots.length === 0) return `BOOKS: no option lots on ${underlying}.`;
  return (
    'BOOKS option lots on this underlying:\n' +
    lots
      .map(([key, h]) => {
        const o = h.option!;
        return `  ${key}: ${o.side} ${o.right} K=${o.strike} ${o.expiry} units=${h.units} avg=${h.avg_price}`;
      })
      .join('\n')
  );
}
