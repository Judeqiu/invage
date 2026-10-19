import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { generateOptionIndex, type OptionIndexResult } from '../risk/option-index.js';

/** Public, deterministic contract scoring. No identity, manual model inputs or portfolio mutation. */
export function createOptionRiskIndexTool(generate = generateOptionIndex): AgentTool {
  return {
    name: 'get_option_risk_index', label: 'Calculate option risk index',
    description: 'Given an exact US stock/ETF option, fetch prices, IV, dividends and official rate, then calculate its stress risk index directly. Do not ask for premium, volatility, rate, equity or a calculator form. Pass an OCC symbol or TICKER YYYY-MM-DD STRIKE PUT/CALL. Omit side to show both buyer and seller risk. Read-only calculation; no expert delegation needed for the index itself. Index is worst loss per contract as a percentage of underlying notional, NOT account equity, probability or a validated 0–100 safety rating. Include unbounded-loss warning, dated inputs and model limitations. ES and account impact are unavailable. Strategy recommendations remain specialist work.',
    parameters: Type.Object({
      contract: Type.String({ minLength: 1, maxLength: 100, description: 'Exact OCC symbol or e.g. AAPL 2026-11-20 150 PUT. Never guess missing expiry/strike/right.' }),
      side: Type.Optional(Type.Union([Type.Literal('long'), Type.Literal('short'), Type.Literal('both')], { description: 'Use recorded/requested side; omitted means both.' })),
    }, { additionalProperties: false }),
    async execute(_id, raw, signal) {
      try {
        const result: OptionIndexResult = await generate(raw, undefined, signal);
        const lines = [`${result.contract.symbol} — automatic option risk index`, ...result.scores.map(s =>
          `${s.side === 'long' ? 'Buyer' : 'Seller'}: ${s.index.toFixed(2)}% of underlying notional; stress loss ${s.stressLoss.toFixed(2)} USD per contract; expiry maximum loss ${s.unboundedLoss ? 'UNBOUNDED' : s.maximumLoss!.toFixed(2) + ' USD'}.`),
          `Option last trade ${result.market.optionAsOf}; underlying quote ${result.market.spotAsOf}.`,
          'Standard stress grid, not probability. ES and account equity impact unavailable. State the returned assumptions and warnings.'];
        return { content: [{ type: 'text', text: lines.join('\n') }], details: result };
      } catch (e) {
        return { content: [{ type: 'text', text: e instanceof Error ? e.message : 'Option index unavailable; no score was calculated.' }], details: null };
      }
    },
  };
}
