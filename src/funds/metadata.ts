import referenceData from './reference-data.json' with {type:'json'};
import type { FundSpec, Holding, FundProductClass } from '../market/types.js';

/** ISO security identifier syntax and check digit, never product-name classification. */
export function validIsin(value: string): boolean {
  if(!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value))return false;
  const digits=[...value].map(c=>c>='A'&&c<='Z'?String(c.charCodeAt(0)-55):c).join('');
  let sum=0;
  for(let i=digits.length-1,alternate=false;i>=0;i--,alternate=!alternate){let n=Number(digits[i]);if(alternate)n*=2;sum+=n>9?n-9:n;}
  return sum%10===0;
}
export interface FundReference {
  isin:string;currency:string;name:string;product_class:FundProductClass;
  source:{url:string;sha256:string;retrieved_at:string;basis:string};
  broker_symbols:Array<{broker_id:string;symbol:string}>;
}
/** Reviewed reference facts live in data, separate from adapters and calculation rules. */
export const fundReferences:readonly FundReference[]=referenceData as FundReference[];
const byIsin=new Map<string,FundReference>(),byBrokerSymbol=new Map<string,FundReference>();
for(const entry of fundReferences){
  if(!validIsin(entry.isin)||byIsin.has(entry.isin)||!['income','balanced','equity','mmf','other'].includes(entry.product_class)||
    !/^[A-Z]{3,4}$/.test(entry.currency)||!entry.name.trim()||!entry.source.basis.trim()||
    new URL(entry.source.url).protocol!=='https:'||!/^[a-f0-9]{64}$/.test(entry.source.sha256)||!Number.isFinite(Date.parse(entry.source.retrieved_at)))throw Error('Invalid fund reference facts');
  byIsin.set(entry.isin,entry);
  for(const binding of entry.broker_symbols){
    const key=JSON.stringify([binding.broker_id,binding.symbol,entry.currency]);
    if(byBrokerSymbol.has(key))throw Error('Conflicting fund reference identity binding');
    byBrokerSymbol.set(key,entry);
  }
}
export function enrichFundMetadata(fund:FundSpec,identity:{broker_id:string;symbol:string;currency:string;isin?:string}):FundSpec {
  const isin=identity.isin??fund.isin;
  if(isin!==undefined&&!validIsin(isin))throw Error('Invalid broker fund ISIN');
  const bound=byBrokerSymbol.get(JSON.stringify([identity.broker_id,identity.symbol,identity.currency]));
  if(isin&&bound&&isin!==bound.isin)throw Error('Broker fund identities disagree');
  const reference=isin?byIsin.get(isin):bound;
  const result={...fund,broker_symbol:identity.symbol,...(isin?{isin}:{})};
  if(!reference)return result;
  if(reference.currency!==identity.currency)throw Error('Fund reference share-class currency differs from broker currency');
  if(fund.product_class&&fund.product_class!==reference.product_class)throw Error('Fund classification conflicts with issuer reference');
  return {...result,isin:reference.isin,product_class:reference.product_class,classification_source:{kind:'issuer_document',isin:reference.isin,
    url:reference.source.url,sha256:reference.source.sha256,verified_at:reference.source.retrieved_at}};
}
/** Preserve independently recorded classification on a later snapshot of the same
 * account/security. Never carry marks, quantities, costs or financial source values.
 */
export function retainFundMetadata(previous:Holding|undefined,incoming:Holding):Holding {
  if(previous?.instrument!=='fund'||incoming.instrument!=='fund'||!previous.fund||!incoming.fund)return incoming;
  const a=previous.fund,b=incoming.fund;
  const sameIsin=a.isin!==undefined&&a.isin===b.isin;
  const sameSymbol=a.broker_symbol!==undefined&&a.broker_symbol===b.broker_symbol;
  const conflictingIsin=a.isin!==undefined&&b.isin!==undefined&&a.isin!==b.isin;
  const conflictingNative=previous.broker_ref?.native_id!==undefined&&incoming.broker_ref?.native_id!==undefined&&previous.broker_ref.native_id!==incoming.broker_ref.native_id;
  if(previous.channel!==incoming.channel||previous.currency!==incoming.currency||conflictingIsin||conflictingNative||!sameIsin&&!sameSymbol)return incoming;
  if(a.product_class&&b.product_class&&a.product_class!==b.product_class)throw Error('Retained fund classification conflicts with incoming classification');
  return {...incoming,fund:{...b,...(b.isin===undefined&&a.isin?{isin:a.isin}:{}),
    ...(b.product_class===undefined&&a.product_class?{product_class:a.product_class}:{}),
    ...(b.classification_source===undefined&&a.classification_source&&(!b.product_class||b.product_class===a.product_class)?{classification_source:a.classification_source}:{}),
  }};
}
