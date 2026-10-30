import { matchingProbabilityQuote, type OptionProbabilityQuote } from './fetch-option-marks.js';
import type { DashboardPayload } from '../webapp/dashboard-data.js';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';

const context = createContext({});
new Script(readFileSync(new URL('../../webui/option-probability.js', import.meta.url), 'utf8')).runInContext(context);

/** Reuse evidence for the same account/contract, never a stored valuation mark. */
export function retainProbabilityQuotes(dashboard: DashboardPayload, prior?: DashboardPayload): void {
  const previous = prior?.model?.live.positions ?? [];
  const now = Date.parse(dashboard.generatedAt);
  for (const position of dashboard.model?.live.positions ?? []) {
    const option = position.option;
    if (!option) continue;
    const valid = (quote?: OptionProbabilityQuote) => {
      if (!quote) return undefined;
      const pair = matchingProbabilityQuote(
        { strike: option.strike, lastPrice: quote.mark / option.multiplier, lastTradeDate: quote.optionAsOf },
        { regularMarketPrice: quote.spot, regularMarketTime: quote.spotAsOf }, option.multiplier, now,
      );
      if (!pair) return undefined;
      const days = context.OptionProbability.daysToExpiry(option.expiry, pair.spotAsOf.slice(0, 10));
      const result = context.OptionProbability.currentSpotItmProbability({ ...position, providerIv: undefined, probabilityQuote: pair }, pair.spot, days);
      return result.iv != null ? pair : undefined;
    };
    const current = valid(position.probabilityQuote);
    const old = previous.find(p => p.ticker === position.ticker && p.channel === position.channel &&
      p.currency === position.currency && p.option?.underlying === option.underlying &&
      p.option.right === option.right && p.option.side === option.side && p.option.strike === option.strike &&
      p.option.expiry === option.expiry && p.option.multiplier === option.multiplier);
    const providerValid = (value: typeof position.providerIv) => value?.source === 'yahoo' &&
      Number.isFinite(value.iv) && value.iv > 0 && Number.isFinite(Date.parse(value.fetchedAt));
    if (providerValid(old?.providerIv) && (!providerValid(position.providerIv) ||
      old!.providerIv!.fetchedAt > position.providerIv!.fetchedAt)) position.providerIv = old!.providerIv;
    const retained = valid(old?.probabilityQuote);
    if (retained && (!current || retained.optionAsOf > current.optionAsOf)) {
      position.probabilityQuote = retained;
    } else if (!current) {
      delete position.probabilityQuote;
    }
  }
}
