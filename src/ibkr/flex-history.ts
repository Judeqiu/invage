import { SaxesParser } from 'saxes';
import { flexTradeEffect, flexTradeIsOption, flexTradeRight, flexTradeTimestamp } from './flex-trade-values.js';
import { assertBrokerHistory, mergeBrokerHistory, type BrokerHistory, type BrokerHistoryGap, type BrokerHistorySyncPlan } from '../brokers/history.js';
import { historyText as text, historyAmount as amount, optionalHistoryAmount as optional } from '../brokers/history-values.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { BrokerParseError } from '../brokers/errors.js';
export interface FlexHistoryReport { xml:string; from:string; through:string; }
export function flexHistoryDates(xml:string,account:string):Array<{from:string;through:string}> {
 const dates:Array<{from:string;through:string}>=[];const parser=new SaxesParser({xmlns:false});
 parser.on('doctype',()=>{throw new BrokerParseError('Flex XML must not contain DOCTYPE');});
 parser.on('opentag',tag=>{if(tag.name==='FlexStatement'&&tag.attributes.accountId===account)dates.push({from:text(tag.attributes.fromDate).replaceAll('-',''),through:text(tag.attributes.toDate).replaceAll('-','')});});parser.write(xml).close();return dates;
}
export function mapFlexHistory(reports:FlexHistoryReport[],account:string,channel:string,plan:BrokerHistorySyncPlan,gaps:BrokerHistoryGap[],imported:boolean):BrokerHistory {
 const scope={broker_id:'ibkr',channel,account_id:account};const allLocalGaps:BrokerHistoryGap[]=[];let history:BrokerHistory|undefined;
 for(const report of reports){const rows:Record<string,string>[]=[];let statement='';let bound=false;let hasTrades=false;const path:string[]=[];
  const parser=new SaxesParser({xmlns:false});parser.on('doctype',()=>{throw new BrokerParseError('Flex XML must not contain DOCTYPE');});
  parser.on('opentag',tag=>{if(tag.name==='FlexStatement'){statement=text(tag.attributes.accountId);bound ||= statement===account;}
   if(statement===account&&tag.name==='Trades')hasTrades=true;
   if(statement===account&&tag.name==='Trade'&&path.at(-1)==='Trades')rows.push(tag.attributes);path.push(tag.name);});
  parser.on('closetag',tag=>{path.pop();if(tag.name==='FlexStatement')statement='';});parser.write(report.xml).close();
  if(!bound)throw new BrokerParseError('Historical Flex account mismatch');
  const localGaps:BrokerHistoryGap[]=[];if(!hasTrades)localGaps.push({kind:'coverage',reference:report.from,reason:'Configured Flex query omits the Trades section.'});
  const executions=rows.filter(r=>r.levelOfDetail==='EXECUTION'&&(plan.mode==='full'||(r.tradeDate??r.dateTime.split(/[;T]/)[0]).replaceAll('-','')>=plan.from.slice(0,10).replaceAll('-',''))).map(r=>{
   if(r.accountId&&r.accountId!==account||r.origTradeID&&r.origTradeID!=='0'||r.origTransactionID&&r.origTransactionID!=='0')throw new BrokerParseError('Flex execution account/correction requires reconciliation');
   if(!['BUY','SELL'].includes(r.buySell))throw new BrokerParseError('Unknown Flex historical direction');
   const isOption=flexTradeIsOption(r);const right=flexTradeRight(r.putCall);
   const expiry=r.expiry?.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
   if(isOption&&!right)throw new BrokerParseError('Flex historical option terms missing');
   const multiplier=optional(r.multiplier),currency=r.currency||null;const gross=optional(r.proceeds);
   const fee=r.ibCommissionCurrency===currency?optional(r.ibCommission):null;
   const at=flexTradeTimestamp(text(r.dateTime));
   const option:{right:'call'|'put';expiry:string;strike:string}|null=isOption?{right:right!,expiry,strike:amount(r.strike)}:null;
   const symbol=isOption?canonicalOptionUnderlying(text(r.underlyingSymbol),{...option!,strike:Number(r.strike)}):r.symbol?.trim()||null;
   if(!multiplier)localGaps.push({kind:'metadata',reference:text(r.conid||r.symbol),reason:'Exact contract multiplier unavailable in Flex fields.'});
   if(fee===null)localGaps.push({kind:'metadata',reference:`execution:${text(r.tradeID)}`,reason:'Execution fee unavailable or currency differs in Flex fields.'});
   return {...scope,id:text(r.tradeID),order_id:r.ibOrderID||r.brokerageOrderID||null,native_symbol:text(r.conid||r.symbol),symbol,instrument:isOption?'option' as const:'security' as const,
    side:r.buySell==='BUY'?'buy' as const:'sell' as const,effect:flexTradeEffect(r.openCloseIndicator),executed_at:at,clock:'IBKR_FLEX_UNSPECIFIED',currency,
    quantity:amount(r.quantity).replace(/^-/,''),price:optional(r.tradePrice),multiplier,gross_cash:gross,fee_cash:fee,option};
  });
  allLocalGaps.push(...localGaps);
  const next=assertBrokerHistory({...scope,executions,orders:[],sync:{...plan,historical_imported:imported,version:1,status:localGaps.length?'partial':'complete',full_history_synced:false,fees:executions.every(e=>e.fee_cash!==null)?'available':'partial',gaps:localGaps}});
  history=mergeBrokerHistory(history,next);
 }
 if(!history)throw new BrokerParseError('No historical Flex response for bound account');
 const aggregateGaps=[...allLocalGaps,...gaps,{kind:'orders' as const,reference:null,reason:'Flex Trades retain execution parent IDs, not a complete order/leg ledger.'}];
 return assertBrokerHistory({...history,sync:{...history.sync,...plan,historical_imported:imported,status:'partial',full_history_synced:false,gaps:aggregateGaps}});
}
