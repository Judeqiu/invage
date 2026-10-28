import type { OptionExecution } from './option-executions.js';

// Exact rational arithmetic keeps proportional opening allocations intact until presentation.
type R = { n:bigint; d:bigint };
const gcd=(a:bigint,b:bigint):bigint=>{a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a;};
const rat=(n:bigint,d=1n):R=>{if(!d)throw Error('Zero allocation denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};};
const read=(v:string):R=>rat(BigInt(v.replace('.','')),10n**BigInt(v.split('.')[1]?.length??0));
const add=(a:R,b:R)=>rat(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:R,b:R)=>rat(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:R,b:R)=>rat(a.n*b.n,a.d*b.d);
const div=(a:R,b:R)=>rat(a.n*b.d,a.d*b.n);
const less=(a:R,b:R)=>a.n*b.d<b.n*a.d;
const zero=()=>rat(0n);
function display(v:R,currency:string):{amount:string;rounded:boolean} {
  let d=v.d;while(d%2n===0n)d/=2n;while(d%5n===0n)d/=5n;
  if(d!==1n){
    const places=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;
    const scale=10n**BigInt(places),a=v.n<0n?-v.n:v.n;
    const units=(a*scale*2n+v.d)/(v.d*2n);const s=units.toString().padStart(places+1,'0');
    return {amount:`${v.n<0n?'-':''}${places?s.slice(0,-places)+'.'+s.slice(-places):s}`,rounded:true};
  }
  let a=v.n<0n?-v.n:v.n,out=String(a/v.d),remainder=a%v.d;
  if(remainder){out+='.';while(remainder){remainder*=10n;out+=String(remainder/v.d);remainder%=v.d;}}
  return {amount:(v.n<0n?'-':'')+out,rounded:false};
}
export interface CloseRealization {
  executionId:string; date:string; contracts:string; gross:string; net:string|null;
  openingPremium:string; openingFees:string|null; openingExecutionIds:string[];
}
/** Same FIFO basis as the open-book and dashboard analytics. No broker cash is modified. */
export function partialCloseSummary(executions:OptionExecution[]) {
  const rows=[...executions].sort((a,b)=>a.executed_at.localeCompare(b.executed_at)||a.execution_id.localeCompare(b.execution_id));
  const lots:Array<{fill:OptionExecution;remaining:R}>=[];const realizations:CloseRealization[]=[];
  let gross=zero(),premium=zero(),openingFees:R|null=zero(),fees:R|null=zero(),closed=zero(),closingCash=zero(),rounded=false;
  const timestamps=new Map<string,Set<string>>();for(const e of rows){if(!timestamps.has(e.executed_at))timestamps.set(e.executed_at,new Set());timestamps.get(e.executed_at)!.add(e.effect);}
  for(const e of rows){
    if(!['open','close'].includes(e.effect)||timestamps.get(e.executed_at)!.size>1||read(e.contracts).n<=0n)return undefined;
    if(e.effect==='open'){lots.push({fill:e,remaining:read(e.contracts)});continue;}
    let needed=read(e.contracts),credit=zero(),cost:R|null=zero();const ids:string[]=[];
    for(const lot of lots){if(!needed.n)break;if(!lot.remaining.n)continue;
      if(lot.fill.contract_id!==e.contract_id||lot.fill.currency!==e.currency||lot.fill.side===e.side)return undefined;
      const used=less(lot.remaining,needed)?lot.remaining:needed,share=div(used,read(lot.fill.contracts));
      credit=add(credit,mul(read(lot.fill.gross_premium),share));cost=cost===null||lot.fill.commission===null?null:add(cost,mul(read(lot.fill.commission),share));
      lot.remaining=sub(lot.remaining,used);needed=sub(needed,used);ids.push(lot.fill.execution_id);
    }
    if(needed.n)return undefined;
    const g=add(credit,read(e.gross_premium)),f=cost===null||e.commission===null?null:add(cost,read(e.commission));
    gross=add(gross,g);premium=add(premium,credit);closed=add(closed,read(e.contracts));closingCash=add(closingCash,read(e.gross_premium));
    openingFees=openingFees===null||cost===null?null:add(openingFees,cost);fees=fees===null||f===null?null:add(fees,f);
    const text=(v:R)=>{const out=display(v,e.currency);rounded ||= out.rounded;return out.amount;};
    realizations.push({executionId:e.execution_id,date:e.executed_at.slice(0,10),contracts:e.contracts,gross:text(g),net:f===null?null:text(add(g,f)),openingPremium:text(credit),openingFees:cost===null?null:text(cost),openingExecutionIds:ids});
  }
  if(!realizations.length)return undefined;
  const currency=rows[0].currency,text=(v:R)=>{const out=display(v,currency);rounded ||= out.rounded;return out.amount;};
  const result={gross:text(gross),net:fees===null?null:text(add(gross,fees)),premium:text(premium),netOpening:openingFees===null?null:text(add(premium,openingFees)),closed:text(closed),remaining:text(lots.reduce((sum,l)=>add(sum,l.remaining),zero())),closingCash:text(closingCash),realizations,rounded:false};
  result.rounded=rounded;return result;
}
