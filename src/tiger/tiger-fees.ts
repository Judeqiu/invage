import { tigerMarketClock, tigerHistoryTime } from './tiger-markets.js';
import { addDecimals, decimal } from '../brokers/option-executions.js';
import type { BrokerOrderFees } from '../brokers/history.js';

/** commission already includes the charge categories; GST is separate.
 * Never add the item breakdown to commission a second time. */
export function tigerOrderFees(order: Record<string, unknown>, cutoff?: number): BrokerOrderFees | undefined {
  const currency = order.commissionCurrency ?? order.currency;
  if (order.commission == null || order.gst == null || typeof currency !== 'string' || !/^[A-Z]{3,4}$/.test(currency)) return;
  const commission = decimal(String(order.commission)), gst = decimal(String(order.gst));
  const total = addDecimals(commission, gst);
  if (commission.startsWith('-') || gst.startsWith('-')) throw new Error('Negative Tiger order charge');
  if (!/[1-9]/.test(total)) {
    const clock = tigerMarketClock(order.market), at = order.updateTime ?? order.latestTime ?? order.openTime;
    if (!clock || cutoff === undefined || at == null ||
        !['filled','cancelled','expired','rejected'].includes(String(order.status).toLowerCase()) ||
        tigerHistoryTime(at,clock).slice(0,10) >= tigerHistoryTime(cutoff,clock).slice(0,10)) return;
  }
  const items: BrokerOrderFees['items'] = [];
  if (Array.isArray(order.charges)) for (const category of order.charges) {
    if (!category || !Array.isArray(category.details)) continue;
    for (const item of category.details) {
      if (typeof item?.type !== 'string' || item.afterDiscountAmount == null) continue;
      items.push({ type:item.type, amount:decimal(String(item.afterDiscountAmount)) });
    }
  }
  // Some endpoints omit itemization. Keep its two reported components instead.
  if (!items.length) items.push({type:'Commission and fees',amount:commission},{type:'GST',amount:gst});
  return { currency, total, items };
}
