import type { BrokerLot } from '../brokers/statement.js';
import { BrokerParseError } from '../brokers/errors.js';
import { addDecimals, assertOptionExecution, decimal, mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { assertOptionLifecycleEvent, mergeOptionLifecycleEvents, type OptionLifecycleEvent } from '../brokers/option-events.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import type { TigerRawBundle } from './tiger-types.js';

function fixed(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}
function historyId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new Error('Tiger history ID is missing or has lost precision');
}
function scaled(value: unknown, scale = 0): string {
  const text = decimal(String(value));
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new Error('Invalid quantity scale');
  const fraction = text.split('.')[1]?.length ?? 0;
  return fixed(BigInt(text.replace('.', '')), fraction + scale);
}
function quantity(row: Record<string, unknown>): string {
  return scaled(row.filledQuantity, Number(row.filledQuantityScale ?? 0));
}
function multiply(...values: string[]): string {
  const scale = values.reduce((sum, text) => sum + (decimal(text).split('.')[1]?.length ?? 0), 0);
  return fixed(values.reduce((n, text) => n * BigInt(text.replace('.', '')), 1n), scale);
}
function timestamp(raw: unknown, market: string): string {
  const date = new Date(Number(raw));
  const zones: Record<string, string> = { US: 'America/New_York', HK: 'Asia/Hong_Kong', SG: 'Asia/Singapore', AU: 'Australia/Sydney', JP: 'Asia/Tokyo' };
  if (!zones[market]) throw new Error('Unknown transaction market timezone');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zones[market], year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
function key(underlying: string, right: string, expiry: string, strike: unknown): string {
  return JSON.stringify([underlying, right, expiry, Number(strike)]);
}
function contractKey(row: Record<string, unknown>): string | undefined {
  const expiry = String(row.expiry ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const right = String(row.right).toUpperCase() === 'PUT' ? 'put' : String(row.right).toUpperCase() === 'CALL' ? 'call' : '';
  if (!right) return undefined;
  const symbol = canonicalOptionUnderlying(String(row.symbol ?? ''), { expiry, right, strike: Number(row.strike) });
  const underlying = yahooSymbolFromBroker({ market: String(row.market ?? ''), symbol });
  return typeof underlying === 'string' ? key(underlying, right, expiry, row.strike) : undefined;
}
const lifecycleKinds: Record<string, OptionLifecycleEvent['kind']> = {
  ASSIGNMENT: 'assignment', EXERCISE: 'exercise', EXPIRE: 'expiration', CASH_SETTLE: 'cash_settlement',
};
function lifecycleKind(order: Record<string, unknown>): OptionLifecycleEvent['kind'] | undefined {
  const attrs = Array.isArray(order.attrList) ? order.attrList : [];
  const kinds = [...new Set(attrs.flatMap(attr => lifecycleKinds[String(attr)] ? [lifecycleKinds[String(attr)]] : []))];
  if (kinds.length > 1) throw new Error('Ambiguous Tiger lifecycle order');
  return kinds[0];
}

/** Fees are allocated among same-contract fills only when every fill in a final
 * order reconciles. Combo-order per-leg fees remain unknown. */
function commissions(order: Record<string, unknown>, rows: Record<string, unknown>[], cutoff: number): Map<string, string> {
  const result = new Map<string, string>();
  if (order.secType !== 'OPT' || order.commission == null || order.gst == null ||
      !['filled', 'cancelled', 'expired', 'rejected'].includes(String(order.status).toLowerCase())) return result;
  const totalQty = addDecimals(...rows.map(quantity));
  if (Number(totalQty) !== Number(quantity(order)) || rows.some(row =>
    row.currency !== order.currency || contractKey(row) !== contractKey(order)) ||
    order.commissionCurrency != null && order.commissionCurrency !== order.currency) return result;
  const fee = addDecimals(decimal(String(order.commission)), decimal(String(order.gst)));
  if (fee.startsWith('-')) throw new Error('Negative Tiger order fee');
  // Tiger can return zero placeholders before overnight fee settlement.
  if (Number(fee) === 0 && rows.some(row => timestamp(row.transactionTime, String(row.market)).slice(0, 10) ===
      timestamp(cutoff, String(row.market)).slice(0, 10))) return result;
  const scale = Math.max(12, fee.split('.')[1]?.length ?? 0);
  const asUnits = (text: string, s: number) => {
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole + fraction.padEnd(s, '0'));
  };
  const qtyScale = Math.max(0, ...rows.map(row => quantity(row).split('.')[1]?.length ?? 0));
  const denominator = asUnits(totalQty, qtyScale);
  if (denominator <= 0n) throw new Error('Non-positive Tiger filled quantity');
  let remaining = asUnits(fee, scale);
  const totalFee = remaining;
  for (const [index, row] of rows.entries()) {
    const amount = index === rows.length - 1 ? remaining : totalFee * asUnits(quantity(row), qtyScale) / denominator;
    remaining -= amount;
    result.set(String(row.id), fixed(-amount, scale));
  }
  return result;
}

export function mapTigerOptionHistory(bundle: TigerRawBundle, lots: BrokerLot[], channel: string): {
  executions: OptionExecution[]; events: OptionLifecycleEvent[];
} | undefined {
  if (!bundle.option_history) return undefined;
  try {
    const contracts = new Map(lots.filter(lot => lot.holding.option).map(lot => {
      const o = lot.holding.option!;
      return [key(canonicalOptionUnderlying(o.underlying, o), o.right, o.expiry, o.strike), lot];
    }));
    const orderById = new Map<string, Record<string, unknown>>();
    for (const order of bundle.option_history.orders) {
      if (String(order.account) !== bundle.account) throw new Error('Order account mismatch');
      const id = historyId(order.id);
      const prior = orderById.get(id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(order)) throw new Error('Conflicting Tiger order history');
      orderById.set(id, order);
    }
    const fillById = new Map<string, Record<string, unknown>>();
    for (const row of bundle.option_history.transactions) {
      if (String(row.accountId) !== bundle.account || row.secType !== 'OPT') throw new Error('Transaction account or security type mismatch');
      const id = historyId(row.id);
      historyId(row.orderId);
      const prior = fillById.get(id);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error('Conflicting Tiger transaction history');
      fillById.set(id, row);
    }
    const fills = [...fillById.values()].sort((a, b) => Number(a.transactionTime) - Number(b.transactionTime) || String(a.id).localeCompare(String(b.id)));
    const byOrder = new Map<string, Record<string, unknown>[]>();
    for (const row of fills) byOrder.set(String(row.orderId), [...(byOrder.get(String(row.orderId)) ?? []), row]);
    const fees = new Map<string, string>();
    for (const [id, rows] of byOrder) {
      const order = orderById.get(id);
      if (order) for (const [fillId, fee] of commissions(order, rows, bundle.option_history.end)) fees.set(fillId, fee);
    }
    const events: OptionLifecycleEvent[] = [];
    const timeline: Array<{ at: string; key: string; event?: OptionLifecycleEvent; row?: Record<string, unknown> }> = [];
    for (const order of orderById.values()) {
      const k = contractKey(order);
      const lot = k && contracts.get(k);
      const kind = lifecycleKind(order);
      if (!lot || !kind || Number(quantity(order)) <= 0) continue;
      const o = lot.holding.option!;
      const at = timestamp(order.latestTime ?? order.openTime, String(order.market));
      const event = assertOptionLifecycleEvent({ id: `order:${order.id}`, broker_id: 'tiger', channel, account_id: bundle.account,
        contract_id: `tiger:${k}`, underlying: canonicalOptionUnderlying(o.underlying, o), right: o.right,
        strike: String(o.strike), expiry: o.expiry, multiplier: String(o.multiplier), date: at.slice(0, 10),
        kind, settlement: kind === 'cash_settlement' ? 'cash' : o.settlement,
        contracts: quantity(order), currency: lot.currency, source: 'tiger_api',
        ...(order.realizedPnl != null ? { broker_realized_pl: decimal(String(order.realizedPnl)) } : {}),
      });
      events.push(event); timeline.push({ at, key: k!, event });
    }
    for (const row of fills) {
      const k = contractKey(row);
      if (!k || !contracts.has(k)) continue;
      const order = orderById.get(String(row.orderId));
      if (order && lifecycleKind(order)) continue; // Delivery is not a second cash trade.
      if (!order) throw new Error(`Missing Tiger order metadata for transaction ${row.id}`);
      timeline.push({ at: timestamp(row.transactionTime, String(row.market)), key: k, row });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at) || (a.event ? 1 : 0) - (b.event ? 1 : 0));
    const balances = new Map<string, number>();
    const executions: OptionExecution[] = [];
    for (const item of timeline) {
      const lot = contracts.get(item.key)!;
      const o = lot.holding.option!;
      const balance = balances.get(item.key) ?? 0;
      if (item.event) {
        const qty = Number(item.event.contracts);
        balances.set(item.key, balance + (item.event.kind === 'assignment' ? qty : balance < 0 ? qty : -qty));
        continue;
      }
      const row = item.row!;
      const order = orderById.get(String(row.orderId))!;
      const side = row.action === 'BUY' ? 'buy' : row.action === 'SELL' ? 'sell' : null;
      if (!side) throw new Error('Unknown Tiger transaction side');
      const effect = typeof order.isOpen === 'boolean' && order.secType === 'OPT'
        ? order.isOpen ? 'open' : 'close'
        : side === 'buy' ? balance < 0 ? 'close' : 'open' : balance > 0 ? 'close' : 'open';
      const qty = quantity(row);
      if (effect === 'close' && balance !== 0 && Number(qty) > Math.abs(balance)) {
        throw new Error('Tiger fill crosses through a flat position; split execution evidence is required');
      }
      const gross = multiply(decimal(String(row.filledPrice)), qty, String(o.multiplier));
      if (gross.startsWith('-') || Number(qty) <= 0) throw new Error('Invalid Tiger fill price or quantity');
      if (row.currency !== lot.currency) throw new Error('Tiger fill currency disagrees with the current contract');
      if (row.filledAmount != null && Number(row.filledAmount) !== Number(gross)) throw new Error('Tiger fill amount disagrees with exact contract size');
      executions.push(assertOptionExecution({ channel, account_id: bundle.account, execution_id: String(row.id),
        contract_id: `tiger:${item.key}`, executed_at: item.at, underlying: canonicalOptionUnderlying(o.underlying, o),
        right: o.right, expiry: o.expiry, strike: String(o.strike), multiplier: String(o.multiplier), contracts: qty,
        side, effect, currency: String(row.currency), gross_premium: side === 'buy' ? `-${gross}` : gross,
        commission: fees.get(String(row.id)) ?? null,
      }));
      balances.set(item.key, balance + (side === 'buy' ? Number(qty) : -Number(qty)));
    }
    return { executions: mergeOptionExecutions([], executions), events: mergeOptionLifecycleEvents([], events) };
  } catch (error) {
    throw new BrokerParseError(`Tiger option history: ${error instanceof Error ? error.message : String(error)}`);
  }
}
