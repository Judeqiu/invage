import {createHash} from 'node:crypto';
import {addDecimals,decimal,negateDecimal} from '../brokers/option-executions.js';
import {historyProduct} from '../brokers/history-values.js';
import type {BrokerHistoryExecution,BrokerHistoryOrder,BrokerHistoryGap} from '../brokers/history.js';
import {allocateMooMooFees} from './moomoo-fees.js';

export interface CashLogEvidence { code:string; from:string; through:string; complete:boolean; rows:Record<string,unknown>[]; }
const equal=(a:string,b:string)=>!/[1-9]/.test(addDecimals(a,negateDecimal(b)));
export function cashLogAmount(v:unknown):string {
  if(typeof v!=='string'||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(v))throw Error('Invalid cash-log amount');
  return decimal(v.replace(/^\+/,'').replaceAll(',',''));
}
/** Exact contract/side cash evidence, complete fills and parent fee conservation.
 * No timestamp timezone, settlement delay or estimated leg split is inferred. */
export function enrichMooMooCashFees(orders:BrokerHistoryOrder[],fills:BrokerHistoryExecution[],evidence:CashLogEvidence[]):BrokerHistoryGap[] {
 const gaps:BrokerHistoryGap[]=[];
 const groups=new Map<string,Set<string>>();
 for(const f of fills)if(f.order_id){const key=JSON.stringify([f.native_symbol,f.side]);const ids=groups.get(key)??new Set();ids.add(f.order_id);groups.set(key,ids);}
 for(const order of orders){
  const all=fills.filter(f=>f.order_id===order.id);
  if(order.legs.length<2||!all.some(f=>f.fee_cash===null))continue;
  const fail=(reason:string)=>gaps.push({kind:'coverage',reference:order.id,reason:'Cash-log fee enrichment: '+reason});
  if(!order.fees||!order.fees.currency||order.filled_quantity===null||!['FILLED_ALL','CANCELLED_ALL','CANCELLED_PART','DELETED','FAILED','DISABLED'].includes(order.status)){fail('final parent fees or quantities unavailable.');continue;}
  const updates=new Map<string,BrokerHistoryExecution>();let total='0';let valid=true;
  try{
   for(const leg of order.legs){
    const matches=all.filter(f=>f.native_symbol===leg.native_symbol&&f.side===leg.side);
    if(!matches.length||matches.some(f=>f.instrument!=='option'||f.currency!==order.fees!.currency||f.gross_cash===null)||!equal(addDecimals(...matches.map(f=>f.quantity)),historyProduct(order.filled_quantity,leg.ratio))||groups.get(JSON.stringify([leg.native_symbol,leg.side]))?.size!==1)throw Error('contract/side has ambiguous or incomplete matching fills.');
    const logs=evidence.filter(g=>g.code===leg.native_symbol);
    if(logs.length!==1||!logs[0].complete)throw Error('complete contract cash logs unavailable.');
    const native=leg.native_symbol.slice(leg.native_symbol.indexOf('.')+1),action=leg.side==='buy'?'Buy':'Sell';
    const feeRows=logs[0].rows.filter(r=>r.transaction_name===`Option ${action} Fee`);
    const executions=logs[0].rows.filter(r=>r.transaction_name===`Option ${action} Execution`);
    if(feeRows.length!==1||!executions.length||[...feeRows,...executions].some(r=>r.symbol!==native))throw Error('fee or execution rows cannot be uniquely linked to this contract.');
    const currency=String(feeRows[0].balance??'').match(/\b([A-Z]{3,4})\s*$/)?.[1];
    if(currency!==order.fees.currency)throw Error('cash-log fee currency is not verified against parent currency.');
    if(!equal(addDecimals(...executions.map(r=>cashLogAmount(r.cash_change))),addDecimals(...matches.map(f=>f.gross_cash!))))throw Error('cash-log execution cash does not reconcile to retained fills.');
    const cash=cashLogAmount(feeRows[0].cash_change);total=addDecimals(total,cash);
    const copies=matches.map(f=>({...f}));
    allocateMooMooFees({...order,native_symbol:leg.native_symbol,legs:[],filled_quantity:addDecimals(...matches.map(f=>f.quantity)),fees:{currency,total:negateDecimal(cash),items:[{type:'Reported cash-log fee',amount:negateDecimal(cash)}]}},copies);
    const references=[...feeRows,...executions].map(r=>createHash('sha256').update(JSON.stringify(r)).digest('hex'));
    for(const f of copies){if(f.fee_cash===null||matches.find(m=>m.id===f.id)!.fee_cash!==null&&!equal(matches.find(m=>m.id===f.id)!.fee_cash!,f.fee_cash))throw Error('cash-log fee conflicts with a retained execution fee.');f.fee_source={kind:'cash_log',references};updates.set(f.id,f);}
   }
   if(updates.size!==all.length||!equal(total,negateDecimal(order.fees.total)))throw Error('leg fees do not reconcile exactly to the whole-order fee.');
  }catch(error){valid=false;fail(error instanceof Error?error.message:'unverified cash-log evidence.');}
  if(valid)for(const f of all){const update=updates.get(f.id)!;f.fee_cash=update.fee_cash;f.fee_source=update.fee_source;}
 }
 return gaps;
}
