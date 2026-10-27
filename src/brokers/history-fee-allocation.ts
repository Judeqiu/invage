import type { BrokerHistory, BrokerHistoryExecution } from './history.js';
import { addDecimals } from './option-executions.js';

function units(value: string, scale: number): bigint | undefined {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  if (/[1-9]/.test(fraction.slice(scale))) return undefined;
  return BigInt(whole + fraction.slice(0, scale).padEnd(scale, '0')) * (negative ? -1n : 1n);
}

/** Preserve an existing allocation only when both complete fill sets prove
 * the exact same order fee. The rounding remainder may belong to a different
 * fill in an older importer; no price, cash total or reported fee is tolerated away. */
export function preserveHistoryFeeAllocation(previous: BrokerHistory | undefined, incoming: BrokerHistory): BrokerHistory {
  if (!previous || previous.broker_id !== incoming.broker_id ||
      previous.channel !== incoming.channel || previous.account_id !== incoming.account_id) return incoming;
  const retained = new Map<string, string>();
  const groups = (history: BrokerHistory) => {
    const result = new Map<string, BrokerHistoryExecution[]>();
    for (const row of history.executions) if (row.order_id) {
      const group = result.get(row.order_id) ?? [];
      group.push(row);
      result.set(row.order_id, group);
    }
    return result;
  };
  const oldGroups = groups(previous), nextGroups = groups(incoming);
  const oldOrders = new Map(previous.orders.map(row => [row.id, row]));
  for (const order of incoming.orders) {
    const priorOrder = oldOrders.get(order.id);
    if (!order.fees || !priorOrder?.fees || !order.filled_quantity || !priorOrder.filled_quantity ||
        !order.fees.currency || order.fees.currency !== priorOrder.fees.currency ||
        !/^0(?:\.0+)?$/.test(addDecimals(order.filled_quantity, `-${priorOrder.filled_quantity}`)) ||
        !/^0(?:\.0+)?$/.test(addDecimals(order.fees.total, `-${priorOrder.fees.total}`))) continue;
    const next = nextGroups.get(order.id) ?? [], old = oldGroups.get(order.id) ?? [];
    const oldById = new Map(old.map(row => [row.id, row]));
    if (next.length < 2 || next.length !== old.length || new Set(next.map(row => row.id)).size !== next.length ||
        next.some(row => !oldById.has(row.id))) continue;
    if ([...old, ...next].some(row => row.fee_cash === null || row.currency !== order.fees!.currency ||
        row.native_symbol !== order.native_symbol || row.instrument !== next[0].instrument)) continue;
    // Use the precision of the actual records and currency, not an epsilon or
    // a broker-specific number of decimal places.
    const currencyScale = /^[A-Z]{3}$/.test(order.fees.currency)
      ? new Intl.NumberFormat('en', {style:'currency',currency:order.fees.currency}).resolvedOptions().maximumFractionDigits! : 0;
    const scale = Math.max(currencyScale, order.fees.total.split('.')[1]?.length ?? 0,
      ...[...old, ...next].map(row => row.fee_cash!.split('.')[1]?.length ?? 0));
    const fee = units(order.fees.total, scale)!;
    const quantityScale = Math.max(...[...old, ...next].map(row => row.quantity.split('.')[1]?.length ?? 0),
      order.filled_quantity.split('.')[1]?.length ?? 0);
    const total = units(order.filled_quantity, quantityScale)!;
    if (total <= 0n || fee < 0n) continue;
    const valid = (rows: BrokerHistoryExecution[]) => {
      const quantities = rows.map(row => units(row.quantity, quantityScale)!);
      if (quantities.reduce((sum, value) => sum + value, 0n) !== total) return false;
      const floors = quantities.map(quantity => fee * quantity / total);
      const remainder = fee - floors.reduce((sum, value) => sum + value, 0n);
      let recipients = 0, sum = 0n;
      for (const [i, row] of rows.entries()) {
        const signed = units(row.fee_cash!, scale);
        if (signed === undefined || signed > 0n) return false;
        const amount = -signed;
        if (amount !== floors[i]) {
          if (!remainder || amount !== floors[i] + remainder) return false;
          recipients++;
        }
        sum += amount;
      }
      return sum === fee && recipients === (remainder ? 1 : 0);
    };
    if (!valid(old) || !valid(next)) continue;
    for (const row of next) retained.set(row.id, oldById.get(row.id)!.fee_cash!);
  }
  return retained.size ? { ...incoming, executions: incoming.executions.map(row =>
    retained.has(row.id) ? { ...row, fee_cash: retained.get(row.id)! } : row) } : incoming;
}
