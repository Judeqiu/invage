import { BrokerParseError } from '../brokers/errors.js';
import type { BrokerLot } from '../brokers/statement.js';
import { assertOptionExecution, decimal, mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import type { WebullRawBundle } from './webull-types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Webull history row');
  return value as Record<string, unknown>;
}
function product(...values: string[]): string {
  let scale = 0; let units = 1n;
  for (const value of values) {
    const text = decimal(value); scale += text.split('.')[1]?.length ?? 0;
    units *= BigInt(text.replace('.', ''));
  }
  const digits = units.toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
function contract(symbol: string, right: string, expiry: string, strike: unknown): string {
  return JSON.stringify([symbol, right, expiry, Number(strike)]);
}
function executedAt(value: unknown): string {
  const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value as string);
  if (!Number.isFinite(date.getTime())) throw new Error('Missing Webull execution timestamp');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = (name: string) => parts.find(part => part.type === name)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}

/** Webull exposes cumulative order fills, not individual executions or fees.
 * Import only terminal single-leg orders; retain unknown fees explicitly. */
export function mapWebullOptionHistory(bundle: WebullRawBundle, lots: BrokerLot[], channel: string): OptionExecution[] | undefined {
  if (!bundle.option_history) return undefined;
  try {
    const contracts = new Map(lots.filter(lot => lot.holding.option).map(lot => {
      const o = lot.holding.option!;
      return [contract(canonicalOptionUnderlying(o.underlying, o), o.right, o.expiry, o.strike), lot];
    }));
    const orders = new Map<string, Record<string, unknown>>();
    for (const raw of bundle.option_history) {
      const group = record(raw);
      if (!Array.isArray(group.orders)) throw new Error('Webull history missing orders');
      for (const rawOrder of group.orders) {
        const order = record(rawOrder);
        if (order.instrument_type !== 'OPTION' || Number(order.filled_quantity ?? 0) === 0) continue;
        if (typeof order.order_id !== 'string' || !order.order_id) throw new Error('Missing Webull order ID');
        const prior = orders.get(order.order_id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(order)) throw new Error('Conflicting Webull order history');
        orders.set(order.order_id, order);
      }
    }
    const balances = new Map<string, number>();
    const executions: OptionExecution[] = [];
    const rows = [...orders.values()].sort((a, b) => executedAt(a.filled_time_at ?? a.filled_time).localeCompare(executedAt(b.filled_time_at ?? b.filled_time)) || String(a.order_id).localeCompare(String(b.order_id)));
    for (const order of rows) {
      if (!Array.isArray(order.legs) || order.legs.length !== 1) continue;
      if (order.option_strategy != null && order.option_strategy !== 'SINGLE') continue;
      if (!['FILLED', 'CANCELED', 'CANCELLED', 'FAILED'].includes(String(order.status))) continue;
      const leg = record(order.legs[0]);
      const right = leg.option_type === 'PUT' || leg.option_type === 'P' ? 'put' : leg.option_type === 'CALL' || leg.option_type === 'C' ? 'call' : '';
      const expiry = String(leg.option_expire_date);
      const underlying = canonicalOptionUnderlying(String(leg.symbol), { right: right as 'put' | 'call', expiry, strike: Number(leg.strike_price) });
      const key = contract(underlying, right, expiry, leg.strike_price);
      const lot = contracts.get(key);
      if (!lot) continue;
      if (lot.currency !== 'USD') throw new Error('Webull history currency is unavailable for a non-US option');
      const o = lot.holding.option!;
      if (Number(leg.option_contract_multiplier) !== o.multiplier) throw new Error('Webull history multiplier mismatch');
      const side = ['SELL', 'SHORT'].includes(String(order.side)) ? 'sell' : order.side === 'BUY' ? 'buy' : null;
      if (!side || leg.side !== order.side) throw new Error('Webull history side mismatch');
      const balance = balances.get(key) ?? 0;
      const intent = order.position_intent;
      if (intent != null && !['BUY_TO_OPEN', 'BUY_TO_CLOSE', 'SELL_TO_OPEN', 'SELL_TO_CLOSE'].includes(String(intent))) throw new Error('Unknown Webull position intent');
      if (intent != null && !String(intent).startsWith(side.toUpperCase())) throw new Error('Webull position intent disagrees with side');
      const effect = intent != null ? String(intent).endsWith('_OPEN') ? 'open' : 'close' :
        side === 'buy' ? balance < 0 ? 'close' : 'open' : balance > 0 ? 'close' : 'open';
      const qty = decimal(String(order.filled_quantity));
      if (Number(qty) <= 0 || effect === 'close' && Number(qty) > Math.abs(balance)) throw new Error('Webull fill cannot reconcile with earlier history');
      const gross = product(decimal(String(order.filled_price)), qty, String(o.multiplier));
      if (gross.startsWith('-')) throw new Error('Negative Webull fill price');
      executions.push(assertOptionExecution({ channel, account_id: bundle.account_id, execution_id: `order:${order.order_id}`,
        contract_id: `webull:${key}`, executed_at: executedAt(order.filled_time_at ?? order.filled_time),
        underlying, right: o.right, expiry: o.expiry, strike: String(o.strike), multiplier: String(o.multiplier),
        contracts: qty, side, effect, currency: lot.currency, gross_premium: side === 'buy' ? `-${gross}` : gross, commission: null }));
      balances.set(key, balance + (side === 'buy' ? Number(qty) : -Number(qty)));
    }
    return mergeOptionExecutions([], executions);
  } catch (error) { throw new BrokerParseError(`Webull option history: ${error instanceof Error ? error.message : String(error)}`); }
}
