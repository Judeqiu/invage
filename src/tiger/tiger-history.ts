import { assertBrokerHistory, type BrokerHistory, type BrokerHistoryGap, type BrokerHistoryOrder } from '../brokers/history.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { yahooSymbolFromBroker } from '../brokers/yahoo-symbol.js';
import { historyText as text, historyAmount as amount, optionalHistoryAmount as optional, scaledHistoryQuantity as quantity, historyProduct, historyLocalTime, marketClock, putHistoryMultiplier, reconcileHistoryCash } from '../brokers/history-values.js';
import type { BrokerLot } from '../brokers/statement.js';
import type { TigerRawBundle } from './tiger-types.js';
import { tigerCommissions } from './tiger-executions.js';
import { BrokerParseError } from '../brokers/errors.js';
type Row = Record<string,unknown>;
// Tiger transactions use SI and Yahoo-style symbols, while orders use SG.
function normalizeHistoryRow(row:Row):Row {
 const normalized={...row};
 if(row.market==='SI'||row.market==='SG'){
  normalized.market='SG';
  if(typeof row.symbol==='string')normalized.symbol=row.symbol.replace(/\.SI$/,'');
 }
 if(Array.isArray(row.legs))normalized.legs=(row.legs as Row[]).map(normalizeHistoryRow);
 return normalized;
}
function terms(row:Row){
 const right=row.right==='PUT'?'put':row.right==='CALL'?'call':null;
 if(!right)throw new BrokerParseError('Tiger historical option right missing');
 const expiry=text(row.expiry).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const underlying=canonicalOptionUnderlying(text(row.symbol),{right,expiry,strike:Number(row.strike)});
 const mapped=yahooSymbolFromBroker({market:text(row.market),symbol:underlying});
 return {symbol:typeof mapped==='string'?mapped:null,option:{right:right as 'call'|'put',expiry,strike:amount(row.strike)}};
}
function identity(row:Row):string {
 if(row.secType!=='OPT')return `${text(row.market)}.${text(row.symbol)}`;
 const t=terms(row);return `tiger:${JSON.stringify([t.symbol,t.option.right,t.option.expiry,Number(t.option.strike)])}`;
}
function side(row:Row):'buy'|'sell'{if(row.action==='BUY')return 'buy';if(row.action==='SELL')return 'sell';throw new BrokerParseError('Unknown Tiger historical side');}
function effect(row:Row):'open'|'close'|'unknown'{return typeof row.isOpen==='boolean'?row.isOpen?'open':'close':'unknown';}
export function mapTigerHistory(bundle:TigerRawBundle,lots:BrokerLot[],channel:string):BrokerHistory|undefined {
 const raw=bundle.history;if(!raw)return undefined;
 const h={...raw,orders:raw.orders.map(normalizeHistoryRow),transactions:raw.transactions.map(normalizeHistoryRow)};
 const scope={broker_id:'tiger',channel,account_id:bundle.account},gaps:BrokerHistoryGap[]=[...h.gaps];
 const metadata=new Map<string,string>();
 const account=(row:Row)=>{const id=row.accountId??row.account;if(id==null||text(id)!==bundle.account)throw new BrokerParseError('Tiger history account mismatch');};
 for(const lot of lots)if(lot.holding.option){const o=lot.holding.option;putHistoryMultiplier(metadata,`tiger:${JSON.stringify([canonicalOptionUnderlying(o.underlying,o),o.right,o.expiry,o.strike])}`,String(o.multiplier));}
 for(const row of h.orders){account(row);if(row.secType==='OPT')putHistoryMultiplier(metadata,identity(row),row.multiplier);for(const leg of Array.isArray(row.legs)?row.legs as Row[]:[])if(leg.secType==='OPT')putHistoryMultiplier(metadata,identity(leg),leg.multiplier);}
 const ordersById=new Map(h.orders.map(row=>[text(row.id),row]));const byOrder=new Map<string,Row[]>();
 for(const row of h.transactions){account(row);const id=text(row.orderId);byOrder.set(id,[...(byOrder.get(id)??[]),row]);}
 const fees=new Map<string,string>();for(const [id,rows]of byOrder){const parent=ordersById.get(id);if(parent&&rows.every(r=>r.secType==='OPT'))for(const [fill,fee]of tigerCommissions(parent,rows,h.end))fees.set(fill,fee);}
 const executions=h.transactions.flatMap(row=>{
  const parent=ordersById.get(text(row.orderId));
  if(parent&&Array.isArray(parent.attrList)&&parent.attrList.some(attr=>['ASSIGNMENT','EXERCISE','EXPIRE','CASH_SETTLE'].includes(String(attr)))){gaps.push({kind:'coverage',reference:text(row.id),reason:'Lifecycle delivery retained in raw evidence; not counted as a second cash execution.'});return [];}
  const native=identity(row),isOption=row.secType==='OPT',clock=marketClock(row.market);
  const t=isOption?terms(row):null;const mapped=isOption?t!.symbol:yahooSymbolFromBroker({market:text(row.market),symbol:text(row.symbol)});
  const multiplier=isOption?metadata.get(native)??null:row.secType==='STK'?'1':optional(row.multiplier);
  const qty=quantity(row.filledQuantity,row.filledQuantityScale??0),price=amount(row.filledPrice),direction=side(row);
  const computed=multiplier?historyProduct(qty,price,multiplier):null;
  const gross=computed!==null&&row.filledAmount!=null?reconcileHistoryCash(amount(row.filledAmount),computed,text(row.currency)):computed;
  if(!multiplier)gaps.push({kind:'metadata',reference:native,reason:'Exact expired-contract multiplier unavailable; retained execution cash is unknown.'});
  if(isOption&&parent&&parent.secType!=='OPT')gaps.push({kind:'orders',reference:text(row.orderId),reason:'Multi-leg execution open/close intent not explicitly reported.'});
  if(!parent)gaps.push({kind:'orders',reference:text(row.orderId),reason:'Execution parent order unavailable.'});
  return [{...scope,id:text(row.id),order_id:text(row.orderId),native_symbol:native,symbol:typeof mapped==='string'?mapped:null,instrument:isOption?'option' as const:'security' as const,
   side:direction,effect:isOption&&parent?.secType==='OPT'?effect(parent):'unknown' as const,executed_at:historyLocalTime(row.transactionTime,clock),clock,currency:text(row.currency),
   quantity:qty,price,multiplier,gross_cash:gross===null?null:direction==='buy'?`-${gross}`:gross,fee_cash:fees.get(text(row.id))??null,option:t?.option??null}];
 });
 const orders:BrokerHistoryOrder[]=h.orders.map(row=>{const clock=marketClock(row.market);return {...scope,id:text(row.id),native_symbol:row.secType==='MLEG'?`tiger:order:${text(row.id)}`:identity(row),side:row.action==='BUY'?'buy':row.action==='SELL'?'sell':'unknown',status:text(row.status),
  created_at:historyLocalTime(row.openTime,clock),updated_at:historyLocalTime(row.updateTime??row.latestTime??row.openTime,clock),clock,currency:row.currency==null?null:text(row.currency),
  quantity:row.totalQuantity==null?null:quantity(row.totalQuantity,row.totalQuantityScale??0),limit_price:optional(row.limitPrice),filled_quantity:row.filledQuantity==null?null:quantity(row.filledQuantity,row.filledQuantityScale??0),filled_price:optional(row.avgFillPrice),
  order_type:text(row.orderType),time_in_force:row.timeInForce==null?null:text(row.timeInForce),session:row.tradingSessionType==null?null:text(row.tradingSessionType),
  legs:(Array.isArray(row.legs)?row.legs as Row[]:[]).map(l=>({native_symbol:identity(l),side:side(l),effect:effect(l),ratio:amount(l.ratio),multiplier:optional(l.multiplier)}))};});
 return assertBrokerHistory({...scope,executions,orders,sync:{historical_imported:h.mode==='full',version:1,mode:h.mode,from:new Date(h.start).toISOString(),through:new Date(h.end).toISOString(),status:gaps.length?'partial':'complete',full_history_synced:h.mode==='full'&&!gaps.length,fees:executions.some(e=>e.fee_cash!==null)?'partial':'unavailable',gaps}});
}
