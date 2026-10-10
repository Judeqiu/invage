import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { findContract, loadOptionsChain } from '../market/options-insight.js';
import { validDate } from '../brokers/option-executions.js';

type Contract = { underlying: string; expiry: string; strike: number; right: 'call' | 'put' };
const reported = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;

/** Read-only quote retrieval, without a strategy analysis or a portfolio overlay. */
export function createOptionQuotesTool(): AgentTool {
  return {
    name: 'get_option_quotes', label: 'Get Option Quotes',
    description: 'Fetch latest reported Yahoo option bid/ask and last prices for exact contracts in one batch. Direct retrieval: no expert analysis, broker sync or accounting access. Shares one chain fetch per underlying/expiry. Prices are per underlying share, not per contract. Fetch time and underlying quote time do not establish option bid/ask freshness. Per-contract failures are explicit.',
    parameters: Type.Object({ contracts: Type.Array(Type.Object({
      underlying: Type.String({ minLength: 1, maxLength: 30 }),
      expiry: Type.String({ description: 'Exact expiry YYYY-MM-DD.' }),
      strike: Type.Number({ exclusiveMinimum: 0 }),
      right: Type.Union([Type.Literal('call'), Type.Literal('put')]),
    }, { additionalProperties: false }), { minItems: 1, maxItems: 40 }) }),
    async execute(_id, raw) {
      try {
        const input = (raw as { contracts: Contract[] }).contracts;
        if (!Array.isArray(input) || input.length < 1 || input.length > 40) throw new Error('Provide 1–40 exact contracts.');
        const contracts = input.map(c => {
          if (!c || typeof c.underlying !== 'string' || !c.underlying.trim() || c.underlying.trim().length > 30 || !validDate(c.expiry) ||
              !Number.isFinite(c.strike) || c.strike <= 0 || !['call', 'put'].includes(c.right)) throw new Error('Invalid exact option contract.');
          return { ...c, underlying: c.underlying.trim().toUpperCase() };
        });
        // Promise sharing is local to this call; no hidden stale quote cache.
        const chains = new Map<string, ReturnType<typeof loadOptionsChain>>();
        const rows = await Promise.all(contracts.map(async c => {
          try {
            const key = `${c.underlying}/${c.expiry}`;
            if (!chains.has(key)) chains.set(key, loadOptionsChain(c.underlying, c.expiry));
            const chain = await chains.get(key)!;
            const row = findContract(c.right === 'put' ? chain.puts : chain.calls, c.strike, c.expiry);
            const bid = reported(row.bid), ask = reported(row.ask), last = reported(row.lastPrice);
            return { ...c, available: bid !== null || ask !== null || last !== null,
              contract_symbol: row.contractSymbol ?? null, currency: chain.currency, price_unit: 'per underlying share',
              bid, ask, last_price: last, mid: bid !== null && ask !== null && bid > 0 && ask >= bid ? (bid + ask) / 2 : null,
              fetched_at: chain.fetchedAt ?? null, option_quote_as_of: null,
              underlying_quote: chain.quote ?? null, error: null };
          } catch (error) {
            return { ...c, available: false, error: error instanceof Error ? error.message : String(error) };
          }
        }));
        const details = { source: 'Yahoo Finance', rows,
          caveats: ['Latest reported values may be stale or from a closed market; not executable quotes.',
            'Option bid/ask timestamp is unavailable. Underlying quote timestamps and chain fetch time are not option quote timestamps.',
            'Prices are per underlying share; portfolio option marks are per contract. Use the recorded multiplier for conversion.'] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], details: null };
      }
    },
  };
}
