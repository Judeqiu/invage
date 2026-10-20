import type { Dataset, Field, Row } from './catalog.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { assertBrokerHistory } from '../brokers/history.js';

const field = (type: Field['type'], description: string, monetary = false): Field => ({ type, description, nullable:true,
  ...(monetary ? { unit:'native currency', sum_group_by:['currency'], comparison_group_by:['currency'] } : {}) });
const text = (description: string) => field('string',description);
const decimal = (description: string, monetary = false) => field('decimal',description,monetary);
const scope = { broker_id:text('Broker identifier.'),channel:text('Immutable account custody channel.'),account_id:text('Bound broker account identifier.') };
const histories = (state: InvestorState) => Object.values(state.broker_history ?? {}).map(assertBrokerHistory);
const available = (state: InvestorState) => state.broker_history !== undefined;
const caveats = ['Retained broker API history; coverage and unresolved records are reported in broker_history_sync and broker_history_gaps.',
  'Unknown amounts and fees are null, never zero. Gross execution cash is not realized P/L. Orders are instructions, not additional executions.'];
function dataset(description: string, fields: Record<string,Field>, rows: (s:InvestorState)=>object[]): Dataset {
  return { description,fields,caveats,available,rows:s=>rows(s).map(r=>Object.fromEntries(Object.keys(fields).map(k=>[k,(r as Row)[k] ?? null]))) };
}
export const brokerHistoryDatasets: Record<string,Dataset> = {
  broker_executions: dataset('All retained broker executions, including securities, closed options and unpriced historical contracts.',{
    ...scope,id:text('Broker execution identifier, unique within account and channel.'),order_id:text('Parent order identifier.'),
    native_symbol:text('Exact broker symbol.'),symbol:text('Canonical underlying/security symbol if resolved.'),instrument:text('security or option.'),
    side:text('buy or sell.'),effect:text('open, close or unknown.'),executed_at:field('datetime','Broker-local execution timestamp.'),clock:text('Known timestamp timezone; IBKR_FLEX_UNSPECIFIED when Flex omits it.'),
    currency:text('Reported or market-derived currency.'),quantity:decimal('Positive quantity; group by account and native_symbol when summing.'),price:decimal('Execution price per unit.'),
    multiplier:decimal('Exact verified contract multiplier; null if unavailable.'),gross_cash:decimal('Signed gross execution cash; buys negative, sells positive.',true),
    fee_cash:decimal('Signed execution fee/rebate, null if not reported.',true),right:text('call or put; null for securities.'),expiry:field('date','Option expiration date.'),strike:decimal('Option strike.'),
  },s=>histories(s).flatMap(h=>h.executions.map(e=>({...e,...e.option})))),
  broker_orders: dataset('Retained parent order history and latest reported status; do not add order amounts to execution cash.',{
    ...scope,id:text('Parent order identifier.'),native_symbol:text('Broker-native parent instrument.'),side:text('buy, sell or unknown.'),status:text('Broker order status.'),
    created_at:field('datetime','Broker-local order creation time.'),updated_at:field('datetime','Broker-local order update time.'),clock:text('IANA timezone for order timestamps.'),
    currency:text('Reported order currency.'),quantity:decimal('Requested parent quantity; null when omitted, including amount-based orders.'),limit_price:decimal('Signed parent limit price, possibly a spread credit/debit.'),
    filled_quantity:decimal('Reported cumulative parent filled quantity; null when unreported.'),filled_price:decimal('Reported average parent fill price.'),order_type:text('Broker order type.'),
    time_in_force:text('Reported time in force.'),session:text('Reported trading session.'),
    fee_total:{ ...decimal('Reported parent-order charge; positive expense. Includes allocated execution fees: never sum both.',true), sum_group_by:['fee_currency'], comparison_group_by:['fee_currency'] },
    fee_currency:text('Currency of the parent-order fee total, independent of order currency.'),
  },s=>histories(s).flatMap(h=>h.orders.map(o=>({...o,fee_total:o.fees?.total,fee_currency:o.fees?.currency})))),
  broker_order_fees: dataset('Broker-reported parent-order fee breakdown. Items are components of broker_orders.fee_total, not extra charges.',{
    ...scope,order_id:text('Parent order identifier.'),currency:text('Reported fee currency.'),type:text('Broker fee item name.'),amount:decimal('Reported charge/rebate component; positive expense.',true),
  },s=>histories(s).flatMap(h=>h.orders.flatMap(o=>(o.fees?.items ?? []).map(item=>({...scopeValues(h),order_id:o.id,currency:o.fees!.currency,...item}))))),
  broker_order_legs: dataset('Authoritative parent order legs; leg quantities are ratios, not independent fills.',{
    ...scope,order_id:text('Parent order identifier.'),native_symbol:text('Exact leg contract.'),side:text('buy or sell.'),effect:text('open, close or unknown.'),
    ratio:decimal('Positive leg ratio per parent contract.'),multiplier:decimal('Reported leg premium multiplier.'),
  },s=>histories(s).flatMap(h=>h.orders.flatMap(o=>o.legs.map(l=>({...scopeValues(h),order_id:o.id,...l}))))),
  broker_history_sync: dataset('History completeness tracked independently of position sync success.',{
    ...scope,historical_imported:field('boolean','One-time historical fetch has been retained; coverage gaps remain separate.'),version:field('number','History schema version.'),mode:text('Last fetch full or incremental.'),from:field('datetime','Retained coverage start, UTC.'),through:field('datetime','Last successful history fetch end, UTC.'),
    status:text('complete or partial for the last history fetch.'),full_history_synced:field('boolean','Whether a complete full history fetch has been retained.'),fees:text('Fee availability: available, partial or unavailable.'),
  },s=>histories(s).map(h=>({...scopeValues(h),...h.sync}))),
  broker_history_gaps: dataset('Explicit unresolved history and metadata gaps; next sync retries partial coverage.',{
    ...scope,kind:text('metadata, orders or coverage.'),reference:text('Related exact contract/order identifier if applicable.'),reason:text('Why this record remains unresolved.'),
  },s=>histories(s).flatMap(h=>h.sync.gaps.map(g=>({...scopeValues(h),...g})))),
};
function scopeValues(h:{broker_id:string;channel:string;account_id:string}) { return {broker_id:h.broker_id,channel:h.channel,account_id:h.account_id}; }
