import {createHash} from 'node:crypto';
import {assertBrokerCashLedger,cashLedgerBatchId,type BrokerCashLedger,type BrokerCashLedgerBatch} from '../brokers/cash-ledger.js';
import {cashLogAmount} from './moomoo-cash-fees.js';
import type {MooMooRawBundle} from './moomoo-types.js';

const text=(value:unknown):string|null=>typeof value==='string'&&value.trim()?value:null;
/** Canonical source content identity, independent of JSON object key order. */
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function mapMooMooCashLedger(bundle:MooMooRawBundle,channel:string):BrokerCashLedger|undefined {
  const evidence=bundle.account_cash_logs;if(!evidence)return undefined;
  const gaps=[...evidence.gaps];
  if(!evidence.complete&&!gaps.length)gaps.push('Account cash-log pagination is incomplete.');
  const occurrences=new Map<string,number>();
  const records=evidence.rows.map((row,index)=>{
    if(row.account_id!=null&&String(row.account_id)!==bundle.acc_id)throw Error('Cloud cash ledger account mismatch');
    const digest=createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
    const occurrence=(occurrences.get(digest)??0)+1;occurrences.set(digest,occurrence);
    const id=`content:${digest}:${occurrence}`;
    let amount:string|null=null;try{amount=cashLogAmount(row.cash_change);}catch{/* Keep unavailable source values and their raw evidence. */}
    const reported_balance=text(row.balance);
    // The live Cloud response explicitly appends an ISO currency to balance.
    // No account-currency, symbol-market or transaction-name fallback.
    const currency=reported_balance?.match(/\s([A-Z]{3,4})$/)?.[1]??null;
    if(amount===null||currency===null)gaps.push(`Cash source row ${index} has unavailable amount or explicit balance currency; consult raw evidence.`);
    return {id,identity_basis:'content_occurrence' as const,segment:null,business_date:null,currency,amount,
      reported_type:text(row.transaction_name),description:null,contract_name:text(row.stock_name),source_updated_at:null,
      source_path:`/account_cash_logs/rows/${index}`,reported_time:text(row.created_time),reported_balance,native_symbol:text(row.symbol),
      currency_source:currency===null?null:'balance_suffix'};
  });
  const day=(micros:string)=>new Date(Number(BigInt(micros)/1000n)).toISOString().slice(0,10);
  const broker_id=bundle.schema==='invage.futubull.cloud.raw.v1'?'futubull':'moomoo';
  const batch:Omit<BrokerCashLedgerBatch,'id'>={source:`${broker_id}.cash_logs`,observed_at:evidence.observed_at,
    from:day(evidence.begin_time),through:day(evidence.end_time),segments:[],complete:evidence.complete&&!gaps.length,gaps,source_ref:null,
    evidence_sha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),records};
  return assertBrokerCashLedger({broker_id,channel,account_id:bundle.acc_id,batches:[{...batch,id:cashLedgerBatchId(batch)}]});
}
