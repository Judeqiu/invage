import { addDecimals, decimal } from '../brokers/option-executions.js';
import type { BrokerOrderFees } from '../brokers/history.js';
import type { WebullRawBundle } from './webull-types.js';

type Row = Record<string, any>;
/** Use settled actual amounts only. Receivable charges are estimates. Currency
 * can be absent from the API; retain the amounts without guessing a denomination. */
export function webullOrderFees(row: Row): BrokerOrderFees | undefined {
  const commission = row.commission?.actual_commission ?? row.actual_commission;
  if (commission == null || !Array.isArray(row.fees)) return;
  if (row.fees.some((item: Row) => item?.actual_value == null || typeof item.type !== 'string')) return;
  const items = [{type:'Commission',amount:decimal(String(commission))},
    ...row.fees.map((item: Row) => ({type:item.type,amount:decimal(String(item.actual_value))}))];
  const currency = row.currency == null ? null : String(row.currency);
  if (currency !== null && !/^[A-Z]{3,4}$/.test(currency)) throw new Error('Invalid Webull fee currency');
  return {currency,total:addDecimals(...items.map(item => item.amount)),items};
}

/** Enrich only the exact historical child order, never a sibling in a combo. */
export function webullOrderWithDetails(bundle: WebullRawBundle, row: Row): Row {
  for (const raw of bundle.order_details ?? []) {
    const group = raw as Row;
    if (group.account_id != null && String(group.account_id) !== bundle.account_id) throw new Error('Webull fee account mismatch');
    for (const detail of Array.isArray(group.orders) ? group.orders : []) {
      if (detail.order_id !== row.order_id) continue;
      if (detail.account_id != null && String(detail.account_id) !== bundle.account_id ||
          row.client_order_id != null && detail.client_order_id != null && row.client_order_id !== detail.client_order_id) throw new Error('Webull fee order/account mismatch');
      const result = {...row};
      for (const field of ['commission','actual_commission','fees','currency']) if (detail[field] != null) result[field] = detail[field];
      return result;
    }
  }
  return row;
}
