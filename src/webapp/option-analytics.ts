import { mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { mergeOptionLifecycleEvents, type OptionLifecycleEvent } from '../brokers/option-events.js';

export interface RecordedOptionProfit {
  channel: string; account_id: string; underlying: string; date: string; currency: string;
  gross: number | null; net: number | null; source: 'matched_fills' | 'broker_event';
}

/** Realization follows FIFO closes and explicit lifecycle events, never position disappearance. */
export function buildRecordedOptionAnalytics(executions: OptionExecution[] = [], events: OptionLifecycleEvent[] = []) {
  const fills = mergeOptionExecutions([], executions);
  const lifecycle = mergeOptionLifecycleEvents([], events);
  const profits: RecordedOptionProfit[] = [];
  const gaps: Array<{ channel: string; date: string; reason: string }> = [];
  const lots = new Map<string, Array<{ quantity: number; gross: number; fee: number | null }>>();
  const key = (r: OptionExecution | OptionLifecycleEvent, side: 'short' | 'long') => JSON.stringify([
    r.channel, r.account_id, r.underlying, r.right, Number(r.strike), r.expiry, Number(r.multiplier), r.currency, side,
  ]);
  const timeline = [...fills.map(row => ({ date: row.executed_at, row, event: null })),
    ...lifecycle.map(event => ({ date: `${event.date}T23:59:59`, row: null, event }))]
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const item of timeline) {
    const r = item.row ?? item.event!;
    const date = item.date.slice(0, 10);
    const reportedProfit = item.event?.broker_realized_pl != null;
    if (reportedProfit) profits.push({ channel: r.channel, account_id: r.account_id, underlying: r.underlying,
      date, currency: r.currency, gross: null, net: Number(item.event!.broker_realized_pl), source: 'broker_event' });
    const side = item.row ? (item.row.effect === 'open' ? item.row.side === 'sell' : item.row.side === 'buy') ? 'short' : 'long'
      : item.event!.kind === 'exercise' ? 'long' : item.event!.kind === 'assignment' ? 'short' : null;
    const candidates = side ? [key(r, side)] : [key(r, 'short'), key(r, 'long')].filter(k => lots.get(k)?.length);
    if (candidates.length !== 1) {
      if (!reportedProfit) gaps.push({ channel: r.channel, date, reason: 'Lifecycle position side cannot be established from recorded fills' });
      continue;
    }
    const k = candidates[0];
    const queue = lots.get(k) ?? [];
    lots.set(k, queue);
    const quantity = Number(r.contracts);
    if (item.row?.effect === 'open') {
      queue.push({ quantity, gross: Number(item.row.gross_premium) / quantity,
        fee: item.row.commission == null ? null : Number(item.row.commission) / quantity });
      continue;
    }
    let remaining = quantity, openingGross = 0, openingFees: number | null = 0;
    for (const lot of queue) {
      const used = Math.min(lot.quantity, remaining);
      openingGross += used * lot.gross;
      openingFees = openingFees == null || lot.fee == null ? null : openingFees + used * lot.fee;
      lot.quantity -= used; remaining -= used;
      if (remaining < 1e-9) break;
    }
    lots.set(k, queue.filter(lot => lot.quantity > 1e-9));
    if (remaining > 1e-9) {
      if (!reportedProfit) gaps.push({ channel: r.channel, date, reason: 'Closing quantity has no complete matching opening fills' });
      continue;
    }
    if (reportedProfit) continue;
    const base = { channel: r.channel, account_id: r.account_id, underlying: r.underlying, date, currency: r.currency };
    if (item.row) {
      const gross = openingGross + Number(item.row.gross_premium);
      profits.push({ ...base, gross, net: openingFees == null || item.row.commission == null ? null
        : gross + openingFees + Number(item.row.commission), source: 'matched_fills' });
    } else {
      const event = item.event!;
      if (event.kind === 'assignment' || event.kind === 'exercise') {
        // Physical delivery can transfer option premium into stock basis. Do not invent option profit.
        gaps.push({ channel: r.channel, date, reason: 'Physical delivery has no broker-reported option realized P&L' });
      } else if (event.kind === 'expiration' || event.proceeds != null) {
        const gross = openingGross + Number(event.proceeds ?? '0');
        profits.push({ ...base, gross, net: openingFees == null || event.fees == null ? null
          : gross + openingFees + Number(event.fees), source: 'matched_fills' });
      } else gaps.push({ channel: r.channel, date, reason: 'Cash settlement proceeds are unavailable' });
    }
  }
  return { executions: fills, profits, gaps };
}
