import { webullOrderFees, webullOrderWithDetails } from './webull-fees.js';
import { assertBrokerHistory, type BrokerHistory, type BrokerHistoryGap, type BrokerHistoryOrder } from '../brokers/history.js';
import { historyText as text, optionalHistoryAmount as optional, historyLocalTime, historyRatio, historyAmount } from '../brokers/history-values.js';
import { BrokerParseError } from '../brokers/errors.js';
import type { WebullRawBundle } from './webull-types.js';
type Row=Record<string,unknown>;
function record(v:unknown):Row{if(!v||typeof v!=='object'||Array.isArray(v))throw new BrokerParseError('Invalid Webull historical row');return v as Row;}
function side(row:Row):'buy'|'sell'|'unknown'{return row.side==='BUY'?'buy':['SELL','SHORT'].includes(String(row.side))?'sell':'unknown';}
export function mapWebullHistory(bundle:WebullRawBundle,channel:string):BrokerHistory|undefined {
 if(bundle.history_error)return undefined;
 const plan=bundle.history_plan;if(!plan)return undefined;
 if(!Array.isArray(bundle.option_history))throw new BrokerParseError('Webull historical orders missing');
 const scope={broker_id:'webull',channel,account_id:bundle.account_id};
 const gaps:BrokerHistoryGap[]=[...(bundle.fee_gaps??[]),{kind:'coverage',reference:null,reason:'Trading API returns cumulative order fills; individual execution history requires separately authorized Broker API access.'}];
 const account=(row:Row)=>{if(row.account_id!=null&&String(row.account_id)!==bundle.account_id)throw new BrokerParseError('Webull history account mismatch');};
 const orders:BrokerHistoryOrder[]=bundle.option_history.flatMap(raw=>{const group=record(raw);account(group);if(!Array.isArray(group.orders))throw new BrokerParseError('Webull history order group missing orders');return group.orders.map(raw=>{
  const row=webullOrderWithDetails(bundle,record(raw));account(row);const id=text(row.order_id),fees=webullOrderFees(row);
  if(Number(row.filled_quantity)>0&&!fees)gaps.push({kind:'coverage',reference:id,reason:'Webull actual order fees not reported completely; amounts remain unknown.'});const qty=optional(row.total_quantity),clock='UTC';
  const legs=(Array.isArray(row.legs)?row.legs:[]).flatMap(raw=>{const leg=record(raw);account(leg);const direction=side(leg);
   if(!qty||Number(qty)<=0||!leg.quantity||Number(leg.quantity)<=0||direction==='unknown'){gaps.push({kind:'orders',reference:id,reason:'Exact leg ratio/side unavailable; complete leg evidence remains in raw archive.'});return [];}
   const native=leg.option_type?`webull:${JSON.stringify([leg.symbol,leg.option_type,leg.option_expire_date,leg.strike_price])}`:text(leg.symbol);
   return [{native_symbol:native,side:direction,effect:typeof row.position_intent==='string'?row.position_intent.endsWith('_OPEN')?'open' as const:row.position_intent.endsWith('_CLOSE')?'close' as const:'unknown' as const:'unknown' as const,ratio:historyRatio(historyAmount(leg.quantity),qty),multiplier:optional(leg.option_contract_multiplier)}];
  });
  const created=row.place_time_at??row.place_time;return {...scope,id,native_symbol:text(row.symbol??id),side:side(row),status:text(row.status),created_at:historyLocalTime(created,clock),updated_at:historyLocalTime(row.updated_time_at??row.filled_time_at??row.filled_time??created,clock),clock,currency:row.currency==null?null:text(row.currency),quantity:qty,limit_price:optional(row.limit_price),filled_quantity:optional(row.filled_quantity),filled_price:optional(row.filled_price),order_type:text(row.order_type),time_in_force:row.time_in_force==null?null:text(row.time_in_force),session:row.support_trading_session==null?null:text(row.support_trading_session),legs,...(fees?{fees}:{})};
 });});
 return assertBrokerHistory({...scope,executions:[],orders,sync:{...plan,historical_imported:plan.mode==='full',version:1,status:'partial',full_history_synced:false,fees:orders.some(o=>o.fees)?'partial':'unavailable',gaps}});
}
