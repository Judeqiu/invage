import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import type { DashboardPayload } from '../webapp/dashboard-data.js';

// Run trusted, pure application models in a private realm rather than duplicating
// their accounting rules or exposing Node's global object to browser scripts.
const context = createContext({});
for (const file of ['option-probability.js', 'option-position.js', 'positions/model.js', 'insights/model.js', 'dashboard/aggregate-model.js', 'trades/model.js']) {
  new Script(readFileSync(new URL('../../webui/' + file, import.meta.url), 'utf8'), { filename: file }).runInContext(context);
}
export function buildPageProjections(payload: DashboardPayload) {
  const channels = [...new Set(['all', ...(payload.model?.live.channels ?? [])])];
  const positions: Record<string, unknown> = {}, insights: Record<string, unknown> = {};
  for (const channel of channels) {
    positions[channel] = context.PositionsV2.build(payload, channel);
    insights[channel] = context.InsightsV2.build(payload, channel);
  }
  return { positions, insights, dashboard: context.DashboardAggregates.build(payload) as Record<string, Record<string, unknown>> };
}

/** Native-currency totals never silently combine different fee or currency bases. */
export function buildTradeProjections(rows: import('../webapp/trades-v2-data.js').TradeJournalRow[], history = false) {
  const visible = history ? rows.filter(row => !context.TradesV2.isOpen(row)) : rows;
  const channels = [...new Set(['all', ...visible.map(row => row.channel)])];
  return Object.fromEntries(channels.map(channel => {
    const scoped = channel === 'all' ? visible : visible.filter(row => row.channel === channel);
    const months: Record<string, unknown> = {};
    for (const year of context.TradesV2.groups(scoped)) for (const month of year.months) {
      months[month.month] = context.TradesV2.totals(month.entries);
    }
    return [channel, { totals: context.TradesV2.totals(scoped), months }];
  }));
}
