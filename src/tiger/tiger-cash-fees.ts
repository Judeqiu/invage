import {createHash} from 'node:crypto';
import {addDecimals,decimal,negateDecimal} from '../brokers/option-executions.js';
import {historyProduct} from '../brokers/history-values.js';
import type {BrokerHistoryExecution,BrokerHistoryOrder,BrokerHistoryGap} from '../brokers/history.js';
import {allocateMooMooFees} from '../moomoo/moomoo-fees.js';
import {canonicalOptionUnderlying} from '../brokers/option-symbol.js';

type Row=Record<string,unknown>;
export interface TigerCashEvidence {from:string;through:string;complete:boolean;rows:Row[]}
const equal=(a:string,b:string)=>!/[1-9]/.test(addDecimals(a,negateDecimal(b)));
const canonical=(n:string)=>addDecimals(n,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
function terms(desc:unknown){
 const match=typeof desc==='string'?desc.match(/^(Buy|Sell)-(.+) (\d{4})(\d{2})(\d{2}) (PUT|CALL) (-?\d+(?:\.\d+)?)$/):null;
 if(!match)return null;
 const right=match[6]==='PUT'?'put' as const:'call' as const,expiry=`${match[3]}-${match[4]}-${match[5]}`;
 return {side:match[1]==='Buy'?'buy':'sell',symbol:canonicalOptionUnderlying(match[2],{right,expiry,strike:Number(match[7])}),right,expiry,strike:canonical(match[7])};
}
const fillKey=(f:BrokerHistoryExecution,date:string)=>f.option?JSON.stringify([f.symbol,f.option.right,f.option.expiry,canonical(f.option.strike),f.side,date]):null;
function blocks(evidence:TigerCashEvidence){
 const rows=[...evidence.rows].sort((a,b)=>BigInt(String(a.id))<BigInt(String(b.id))?-1:1);
 if(new Set(rows.map(r=>String(r.id))).size!==rows.length)throw Error('duplicate cash-flow record IDs.');
 const result=new Map<string,Row[][]>(),invalid=new Set<string>();
 for(let i=0;i<rows.length;i++){
  const trade=rows[i],contract=terms(trade.desc);if(trade.type!=='Trade'||!contract)continue;
  const key=JSON.stringify([contract.symbol,contract.right,contract.expiry,contract.strike,contract.side,trade.businessDate]);
  const group=[trade];
  for(let j=i+1;j<rows.length&&rows[j].type!=='Trade';j++){
   const fee=rows[j];
   if(fee.businessDate!==trade.businessDate||fee.currency!==trade.currency||String(fee.updatedAt)!==String(trade.updatedAt))continue;
   if(fee.desc!==trade.desc&&!(fee.type==='GST'&&(fee.desc==null||fee.desc==='')))invalid.add(key);
   if(typeof fee.type!=='string'||!/(?:Fee|Levy|Duty|Tax|Commission|^GST$)/.test(fee.type))invalid.add(key);
   group.push(fee);
  }
  const found=result.get(key)??[];found.push(group);result.set(key,found);
 }
 return {groups:result,invalid};
}
/** User-approved association of unlabeled GST within broker record-ID Trade blocks.
 * All economic matching is exact; unknown/ambiguous evidence never becomes zero. */
export function enrichTigerCashFees(orders:BrokerHistoryOrder[],fills:BrokerHistoryExecution[],evidence:TigerCashEvidence):BrokerHistoryGap[]{
 const gaps:BrokerHistoryGap[]=[],owners=new Map<string,Set<string>>(),byKey=new Map<string,BrokerHistoryExecution[]>();
 for(const fill of fills)if(fill.order_id){const key=fillKey(fill,fill.executed_at.slice(0,10));if(key){const ids=owners.get(key)??new Set();ids.add(fill.order_id);owners.set(key,ids);byKey.set(key,[...(byKey.get(key)??[]),fill]);}}
 let cash:ReturnType<typeof blocks>|undefined,error:string|undefined;
 try{if(!evidence.complete)throw Error('complete cash-flow evidence unavailable.');cash=blocks(evidence);}catch(e){error=e instanceof Error?e.message:'invalid cash-flow evidence.';}
 for(const order of orders){
  const all=fills.filter(f=>f.order_id===order.id);if(order.legs.length<2||!all.some(f=>f.fee_cash===null))continue;
  try{
   if(error||!cash)throw Error(error);
   if(!order.fees||!order.fees.currency||order.filled_quantity===null||!['filled','cancelled','expired','rejected'].includes(order.status.toLowerCase()))throw Error('final parent fees or quantities unavailable.');
   const updates=new Map<string,BrokerHistoryExecution>();let orderCash='0';
   for(const leg of order.legs){
    const matches=all.filter(f=>f.native_symbol===leg.native_symbol&&f.side===leg.side);
    if(!matches.length||matches.some(f=>f.instrument!=='option'||f.gross_cash===null||f.currency!==order.fees!.currency)||!equal(addDecimals(...matches.map(f=>f.quantity)),historyProduct(order.filled_quantity,leg.ratio)))throw Error('incomplete contract fills.');
    let legCash='0';const sources:Row[]=[];
    for(const date of new Set(matches.map(f=>f.executed_at.slice(0,10)))){
     const key=fillKey(matches[0],date)!;
     if(cash.invalid.has(key))throw Error('cash-flow block contains unlinked or unclassified records.');
     const groups=cash.groups.get(key);
     if(!groups?.length||groups.some(group=>group.length<2||!group.some(r=>r.type==='GST')||group.some(r=>r.currency!==order.fees!.currency)))throw Error('complete trade/fee/GST blocks unavailable.');
     const dated=matches.filter(f=>f.executed_at.slice(0,10)===date);
     const feeTotal=(group:Row[])=>addDecimals(...group.slice(1).map(r=>decimal(String(r.amount))));
     if(owners.get(key)?.size===1){
      const expected=addDecimals(...dated.map(f=>f.gross_cash!));
      if(!equal(addDecimals(...groups.map(g=>decimal(String(g[0].amount)))),expected))throw Error('cash-flow trade amounts disagree with retained executions.');
      legCash=addDecimals(legCash,...groups.map(feeTotal));sources.push(...groups.flat());
     }else{
      // Reused contracts can still be exact when trade cash identifies the fill,
      // or every possible matching block reports the identical fee amount.
      for(const fill of dated){
       const candidates=groups.filter(g=>equal(decimal(String(g[0].amount)),fill.gross_cash!));
       const peers=byKey.get(key)!.filter(f=>f.gross_cash!==null&&equal(f.gross_cash,fill.gross_cash!));
       if(!candidates.length||candidates.length!==peers.length||candidates.some(g=>!equal(feeTotal(g),feeTotal(candidates[0]))))throw Error('reused contract has ambiguous trade/fee blocks.');
       legCash=addDecimals(legCash,feeTotal(candidates[0]));sources.push(...candidates.flat());
      }
     }
    }
    const copies=matches.map(f=>({...f}));
    allocateMooMooFees({...order,status:'FILLED_ALL',native_symbol:leg.native_symbol,legs:[],filled_quantity:addDecimals(...matches.map(f=>f.quantity)),fees:{currency:order.fees.currency,total:negateDecimal(legCash),items:[]}},copies);
    const references=sources.map(r=>createHash('sha256').update(JSON.stringify(r)).digest('hex'));
    for(const fill of copies){const prior=matches.find(f=>f.id===fill.id)!;if(fill.fee_cash===null||prior.fee_cash!==null&&!equal(prior.fee_cash,fill.fee_cash))throw Error('cash-flow fees conflict with retained execution fees.');fill.fee_source={kind:'cash_log',references};updates.set(fill.id,fill);}
    orderCash=addDecimals(orderCash,legCash);
   }
   if(updates.size!==all.length||!equal(orderCash,negateDecimal(order.fees.total)))throw Error('cash-flow leg fees do not equal the parent fee total.');
   for(const fill of all){const next=updates.get(fill.id)!;fill.fee_cash=next.fee_cash;fill.fee_source=next.fee_source;}
  }catch(e){gaps.push({kind:'coverage',reference:order.id,reason:'Tiger cash-log fee enrichment: '+(e instanceof Error?e.message:'invalid evidence.')});}
 }
 return gaps;
}
