import {negateDecimal} from '../brokers/option-executions.js';
import { assertBrokerHistory, type BrokerHistory, type BrokerHistoryGap, type BrokerHistorySyncPlan } from '../brokers/history.js';
import { historyText as text, historyAmount as amount, optionalHistoryAmount as optional, historyProduct, marketClock } from '../brokers/history-values.js';
import { looksLikeOptionCode,parseBrokerOptionCode,optionUnderlyingFromBroker } from '../brokers/option-symbol.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import { allocateMooMooFees, parseMooMooOrderFees } from '../moomoo/moomoo-fees.js';
import { BrokerParseError } from '../brokers/errors.js';
type Row=Record<string,any>;
export function mapFutubullHistory(bundle:Row,channel:string):BrokerHistory|undefined {
 const h=bundle.history as {plan:BrokerHistorySyncPlan;deals:Row[];orders:Row[];order_fees?:Row[];fee_gaps?:BrokerHistoryGap[]}|undefined;if(!h)return undefined;
 if(!Array.isArray(h.deals)||!Array.isArray(h.orders))throw new BrokerParseError('OpenD historical arrays missing');
 const scope={broker_id:'futubull',channel,account_id:bundle.acc_id};const gaps:BrokerHistoryGap[]=[...(h.fee_gaps??[])];
 const account=(row:Row)=>{if(row.acc_id!=null&&String(row.acc_id)!==bundle.acc_id)throw new BrokerParseError('OpenD historical account mismatch');};
 const stamp=(v:unknown)=>text(v).replace(' ','T');
 const side=(v:unknown):'buy'|'sell'=>{if(['BUY','BUY_BACK'].includes(String(v)))return 'buy';if(['SELL','SELL_SHORT'].includes(String(v)))return 'sell';throw new BrokerParseError('Unknown OpenD historical direction');};
 const executions=h.deals.map(row=>{
  account(row);const code=text(row.code),[market,native]=code.split('.',2);if(!native)throw new BrokerParseError('Invalid OpenD historical symbol');
  if(row.status!=null&&row.status!=='OK')throw new BrokerParseError('Changed OpenD deal requires reconciliation');
  const isOption=looksLikeOptionCode(native),parsed=isOption?parseBrokerOptionCode(native):null;
  if(parsed&&'skip'in parsed)throw new BrokerParseError(parsed.skip);
  const size=row.contract_size??row.multiplier??row.lot_size;const multiplier=isOption?optional(size):'1';
  const symbol=isOption?optionUnderlyingFromBroker({market,optionRoot:parsed&&!('skip'in parsed)?parsed.root:undefined}):yahooSymbolFromBroker({market,symbol:native});
  const currency=row.currency??({US:'USD',HK:'HKD',CN:'CNY',SG:'SGD',JP:'JPY',AU:'AUD'}as Record<string,string>)[market]??null;
  const direction=side(row.trd_side),qty=amount(row.qty),price=amount(row.price);const gross=multiplier&&currency?historyProduct(qty,price,multiplier):null;
  if(!multiplier)gaps.push({kind:'metadata',reference:code,reason:'Historical OpenD option contract multiplier unavailable; cash remains unknown.'});
  return {...scope,id:text(row.deal_id),order_id:row.order_id==null?null:text(row.order_id),native_symbol:code,symbol:typeof symbol==='string'?symbol:null,instrument:isOption?'option' as const:'security' as const,
   side:direction,effect:row.trd_side==='BUY_BACK'?'close' as const:row.trd_side==='SELL_SHORT'?'open' as const:'unknown' as const,executed_at:stamp(row.create_time),clock:marketClock(market),currency,quantity:qty,price,multiplier,gross_cash:gross===null?null:direction==='buy'?negateDecimal(gross):gross,fee_cash:null as string|null,
   option:parsed&&!('skip'in parsed)?{right:parsed.right,expiry:parsed.expiry,strike:String(parsed.strike)}:null};
 });
 const orders:import('../brokers/history.js').BrokerHistoryOrder[]=h.orders.map(row=>{account(row);const code=text(row.code),market=code.split('.')[0];return {...scope,id:text(row.order_id),native_symbol:code,side:side(row.trd_side),status:text(row.order_status),created_at:stamp(row.create_time),updated_at:stamp(row.updated_time??row.create_time),clock:marketClock(market),currency:row.currency??({US:'USD',HK:'HKD',CN:'CNY',SG:'SGD',JP:'JPY',AU:'AUD'}as Record<string,string>)[market]??null,quantity:optional(row.qty),limit_price:optional(row.price),filled_quantity:optional(row.dealt_qty),filled_price:optional(row.dealt_avg_price),order_type:text(row.order_type),time_in_force:row.time_in_force??null,session:null,legs:[]};});
 const grouped=new Map<string,typeof orders>();
 for(const order of orders){const group=grouped.get(order.id)??[];group.push(order);grouped.set(order.id,group);}
 orders.splice(0,orders.length);
 for(const [id,group]of grouped){
  const first=group[0];
  if(group.some(order=>order.native_symbol!==first.native_symbol||order.side!==first.side)){
   orders.push({...first,native_symbol:'futubull:order:'+id,currency:group.every(o=>o.currency===first.currency)?first.currency:null,side:'unknown',quantity:null,filled_quantity:null,limit_price:null,filled_price:null});
   gaps.push({kind:'orders',reference:id,reason:'OpenD shared parent has multiple reported contracts; parent fee retained once without an inferred leg split.'});
  }else{
   if(group.some(order=>JSON.stringify(order)!==JSON.stringify(first)))throw new BrokerParseError('Conflicting repeated OpenD parent order');
   orders.push(first);
  }
 }
 const invalidFees=new Set<string>();
 for(const fee of h.order_fees??[]){
  const id=text(fee.order_id),parent=orders.find(order=>order.id===id);
  try {
   account(fee);
   if(!parent||invalidFees.has(id))throw new Error('Fee parent unavailable or contradictory');
   const items=Array.isArray(fee.fee_details)?fee.fee_details.map((item:unknown)=>{
    if(!Array.isArray(item)||item.length!==2)throw new Error('Invalid fee detail');
    return {type:item[0],amount:item[1]};
   }):fee.fee_details==null?[]:fee.fee_details;
   const reported=parseMooMooOrderFees({order_id:id,acc_id:bundle.acc_id,total_fee:fee.fee_amount,fees:items},id,bundle.acc_id,parent.currency??undefined);
   if(parent.fees&&JSON.stringify(parent.fees)!==JSON.stringify(reported))throw new BrokerParseError('Conflicting repeated OpenD fee');
   parent.fees=reported;
  } catch {
   invalidFees.add(id);if(parent)delete parent.fees;
   gaps.push({kind:'coverage',reference:id,reason:'Order fees unavailable or invalid; OpenD charge evidence retained in raw archive.'});
  }
 }
 for(const order of orders)allocateMooMooFees(order,executions.filter(fill=>fill.order_id===order.id));
 for(const id of new Set(executions.map(fill=>fill.order_id)))if(id&&!orders.find(order=>order.id===id)?.fees)
  gaps.push({kind:'coverage',reference:id,reason:'Order fees unavailable or invalid; OpenD charges remain unknown.'});
 return assertBrokerHistory({...scope,executions,orders,sync:{...h.plan,historical_imported:h.plan.mode==='full',version:1,status:gaps.length?'partial':'complete',full_history_synced:h.plan.mode==='full'&&!gaps.length,fees:executions.length&&executions.every(e=>e.fee_cash!==null)?'available':orders.some(o=>o.fees)?'partial':'unavailable',gaps}});
}
