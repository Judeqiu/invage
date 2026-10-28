import { addDecimals, decimal } from '../brokers/option-executions.js';
import type { BrokerHistoryExecution, BrokerHistoryOrder, BrokerOrderFees } from '../brokers/history.js';
import { BrokerParseError } from '../brokers/errors.js';

export function parseMooMooOrderFees(raw: Record<string, unknown>, orderId: string, accountId: string, orderCurrency?: string): BrokerOrderFees {
  if (raw.order_id !== orderId || (raw.account_id ?? raw.acc_id ?? accountId) !== accountId) {
    throw new BrokerParseError('Moomoo order fee account/order mismatch');
  }
  // Live Cloud responses can omit currency despite the published response schema.
  // Only an authoritative matching parent order can supply the missing field.
  const currency = raw.currency === undefined ? orderCurrency : raw.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3,4}$/.test(currency)) {
    throw new BrokerParseError('Moomoo order fee currency unavailable');
  }
  const total = decimal(String(raw.total_fee));
  // Futubull reports a null breakdown when the explicitly reported total is zero.
  const detail = raw.fees === null && !/[1-9]/.test(total) ? [] : raw.fees;
  if (!Array.isArray(detail)) throw new BrokerParseError('Moomoo order fee breakdown unavailable');
  const items = detail.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string' || !item.type.trim()) {
      throw new BrokerParseError('Invalid Moomoo fee item');
    }
    return { type:item.type, amount:decimal(String(item.amount)) };
  });
  // The reported total is authoritative; a breakdown need not include every charge.
  return { currency, total, items };
}

/** Only final, single-contract orders with all fills present can be allocated.
 * Combo charges stay on the parent unless separate cash-log evidence verifies each leg. */
export function allocateMooMooFees(order: BrokerHistoryOrder, fills: BrokerHistoryExecution[]): void {
  if (!order.fees || !fills.length || order.legs.length > 1 ||
      !['FILLED_ALL','CANCELLED_ALL','CANCELLED_PART','DELETED','FAILED','DISABLED'].includes(order.status) ||
      order.filled_quantity === null || fills.some(f => f.native_symbol !== order.native_symbol ||
        f.currency !== order.fees!.currency || order.currency !== null && f.currency !== order.currency) ||
      new Set(fills.map(f => f.id)).size !== fills.length ||
      new Set(fills.map(f => `${f.side}:${f.effect}`)).size !== 1) return;
  const quantity = addDecimals(...fills.map(f => f.quantity));
  if (/[1-9]/.test(addDecimals(quantity, `-${order.filled_quantity}`))) return;
  const scale = Math.max(12, order.fees.total.split('.')[1]?.length ?? 0);
  const qtyScale = Math.max(...fills.map(f => f.quantity.split('.')[1]?.length ?? 0));
  const units = (value: string, precision: number) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(precision, '0'));
  };
  const denominator = units(quantity, qtyScale), total = units(order.fees.total, scale);
  if (denominator === 0n) return; // A zero total quantity has no defined proportional allocation.
  let remaining = total;
  // Stable order makes remainder assignment reproducible across repeated syncs.
  for (const [i, fill] of [...fills].sort((a,b) => a.id.localeCompare(b.id)).entries()) {
    const fee = i === fills.length - 1 ? remaining : total * units(fill.quantity, qtyScale) / denominator;
    remaining -= fee;
    const cash = -fee;
    const digits = (cash < 0n ? -cash : cash).toString().padStart(scale + 1, '0');
    fill.fee_cash = `${cash < 0n ? '-' : ''}${digits.slice(0,-scale)}.${digits.slice(-scale)}`;
  }
}
