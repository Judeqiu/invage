import { addDecimals, negateDecimal } from '../brokers/option-executions.js';
import { historyProduct, historyRatio } from '../brokers/history-values.js';
import { BrokerParseError } from '../brokers/errors.js';
import { cashLogAmount } from './moomoo-cash-fees.js';
import type { MooMooRawBundle } from './moomoo-types.js';

const canonical = (value: string) => addDecimals(value,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1').replace(/^-0$/,'0');
const equal = (a:string,b:string) => canonical(a) === canonical(b);
function amounts(values:string[]) {
  const result = new Map<string,number>();
  for (const value of values) { const key=canonical(value); if(key!=='0')result.set(key,(result.get(key)??0)+1); }
  return result;
}
function sameAmounts(a:string[],b:string[]) {
  const left=amounts(a),right=amounts(b);
  return left.size===right.size&&[...left].every(([key,count])=>right.get(key)===count);
}
function covers(from:string,through:string,start:string,end:string) {
  return Number.isFinite(Date.parse(from))&&Number.isFinite(Date.parse(through))&&
    BigInt(Date.parse(from))*1000n<=BigInt(start)&&BigInt(Date.parse(through))*1000n>=BigInt(end);
}

/** Derive size independently for each exact contract from complete broker cash.
 * No clock/settlement-delay association, default size or estimated leg split.
 */
export function recoverMooMooCashMultipliers(bundle:MooMooRawBundle, known:ReadonlyMap<string,unknown>) {
  const recovered=new Map<string,string>();
  if(!bundle.fills_history)return recovered;
  for(const cash of bundle.cash_logs??[]) {
    if(!cash.complete||known.has(cash.code)||recovered.has(cash.code))continue;
    if((bundle.cash_logs??[]).filter(g=>g.code===cash.code).length!==1)continue;
    if(!Number.isFinite(Date.parse(cash.from))||!Number.isFinite(Date.parse(cash.through)))continue;
    const start=String(BigInt(Date.parse(cash.from))*1000n),end=String(BigInt(Date.parse(cash.through))*1000n);
    const primary=bundle.fills_history;
    const sources=[{from:new Date(Number(BigInt(primary.start)/1000n)).toISOString(),through:new Date(Number(BigInt(primary.end)/1000n)).toISOString(),rows:primary.rows},
      ...(bundle.fee_fills_history??[]).filter(g=>g.code===cash.code)];
    const complete=sources.filter(g=>covers(g.from,g.through,start,end));
    if(!complete.length)continue;
    const fills=new Map<string,Record<string,unknown>>();
    for(const group of complete)for(const row of group.rows)if(row.code===cash.code) {
      const account=row.account_id??row.acc_id;
      if(account!=null&&String(account)!==bundle.acc_id)throw new BrokerParseError('Moomoo historical record account mismatch');
      if(!/^\d+$/.test(String(row.create_time)))throw new BrokerParseError('Moomoo cash recovery requires exact fill times');
      if(BigInt(String(row.create_time))<BigInt(start)||BigInt(String(row.create_time))>BigInt(end))continue;
      const id=String(row.deal_id??'');if(!id||row.status!=='OK')throw new BrokerParseError('Moomoo cash recovery requires unchanged fill identity');
      const old=fills.get(id);
      if(old&&(!equal(String(old.qty),String(row.qty))||!equal(String(old.price),String(row.price))||old.trd_side!==row.trd_side||old.order_id!==row.order_id||String(old.create_time)!==String(row.create_time)))throw new BrokerParseError('Conflicting cash-recovery fill evidence');
      fills.set(id,row);
    }
    if(!fills.size||[...fills.values()].some(r=>!['BUY','BUY_BACK','SELL','SELL_SHORT'].includes(String(r.trd_side))))continue;
    const native=cash.code.slice(cash.code.indexOf('.')+1),currency=cash.code.startsWith('US.')?'USD':cash.code.startsWith('HK.')?'HKD':null;
    const candidates:string[]=[];const zeroSums:Array<{bases:string[];reported:string[];rows:Record<string,unknown>[]}>=[];let valid=true;
    try {
      for(const side of ['buy','sell'] as const) {
        const rows=[...fills.values()].filter(r=>(side==='buy'?['BUY','BUY_BACK']:['SELL','SELL_SHORT']).includes(String(r.trd_side)));
        const logs=cash.rows.filter(r=>r.transaction_name===`Option ${side==='buy'?'Buy':'Sell'} Execution`);
        if(!rows.length&&!logs.length)continue;
        if(!rows.length||!currency||logs.some(r=>r.symbol!==native||String(r.balance??'').match(/\b([A-Z]{3,4})\s*$/)?.[1]!==currency)) {valid=false;break;}
        for(const row of logs){const account=row.account_id??row.acc_id;if(account!=null&&String(account)!==bundle.acc_id)throw new BrokerParseError('Moomoo cash record account mismatch');}
        const bases=rows.map(r=>{const v=historyProduct(String(r.qty),String(r.price));return side==='buy'?negateDecimal(v):v;});
        const reported=logs.map(r=>cashLogAmount(r.cash_change));
        const base=addDecimals('0',...bases),gross=addDecimals('0',...reported);
        if(equal(base,'0')){if(!equal(gross,'0'))valid=false;zeroSums.push({bases,reported,rows});continue;}
        if(!logs.length){valid=false;break;}
        // Signed prices are authoritative: a negative-price buy can receive cash.
        const negative=base.startsWith('-');
        const ratio=historyRatio(negative?negateDecimal(gross):gross,negative?negateDecimal(base):base);
        const expected=bases.map(v=>historyProduct(v,ratio));
        const orders=new Map<string,string>();let completeOrders=true;
        rows.forEach((r,i)=>{if(typeof r.order_id!=='string'||!r.order_id)completeOrders=false;else orders.set(r.order_id,addDecimals(orders.get(r.order_id)??'0',expected[i]));});
        if(!sameAmounts(reported,expected)&&(!completeOrders||!sameAmounts(reported,[...orders.values()]))) {valid=false;break;}
        candidates.push(ratio);
      }
    } catch(error) {
      if(error instanceof BrokerParseError&&/account mismatch|Conflicting/.test(error.message))throw error;
      valid=false;
    }
    if(valid&&candidates.length&&candidates.every(v=>equal(v,candidates[0]))) {
      for(const {bases,reported,rows} of zeroSums) {
        const expected=bases.map(v=>historyProduct(v,candidates[0]));
        const orders=new Map<string,string>();
        rows.forEach((r,i)=>{if(typeof r.order_id==='string'&&r.order_id)orders.set(r.order_id,addDecimals(orders.get(r.order_id)??'0',expected[i]));});
        if(!sameAmounts(reported,expected)&&!(rows.every(r=>typeof r.order_id==='string'&&r.order_id)&&sameAmounts(reported,[...orders.values()])))valid=false;
      }
      if(valid)recovered.set(cash.code,candidates[0]);
    }
  }
  return recovered;
}
