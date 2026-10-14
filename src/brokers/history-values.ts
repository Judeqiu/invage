import { decimal, addDecimals } from './option-executions.js';
import { BrokerParseError } from './errors.js';
export function historyText(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== 'string' || !value.trim()) throw new BrokerParseError('Historical identifier/text is missing or inexact');
  return value;
}
export function historyAmount(value: unknown): string {
  if(typeof value==='number'){if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))throw new BrokerParseError('Historical amount is inexact');return decimal(String(value));}
  return decimal(historyText(value));
}
export function optionalHistoryAmount(value: unknown): string | null { return value == null || value === '' ? null : historyAmount(value); }
export function historyProduct(...values: string[]): string {
  let units=1n, scale=0;
  for(const value of values){decimal(value);scale+=value.split('.')[1]?.length??0;units*=BigInt(value.replace('.',''));}
  const negative=units<0n;const digits=(negative?-units:units).toString().padStart(scale+1,'0');
  return `${negative?'-':''}${scale?`${digits.slice(0,-scale)}.${digits.slice(-scale)}`:digits}`;
}
export function scaledHistoryQuantity(value: unknown, scale: unknown = 0): string {
  const places=Number(scale);if(!Number.isInteger(places)||places<0||places>18)throw new BrokerParseError('Invalid historical quantity scale');
  return historyProduct(historyAmount(value),places?`0.${'0'.repeat(places-1)}1`:'1');
}
export function historyLocalTime(value: unknown, clock: string): string {
  const date=new Date(typeof value==='number'||/^\d+$/.test(String(value))?Number(value):String(value));
  if(!Number.isFinite(date.getTime()))throw new BrokerParseError('Invalid historical timestamp');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:clock,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const p=(name:string)=>parts.find(v=>v.type===name)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}
export function marketClock(market: unknown): string {
  const clocks:Record<string,string>={US:'America/New_York',HK:'Asia/Hong_Kong',CN:'Asia/Shanghai',SG:'Asia/Singapore',AU:'Australia/Sydney',JP:'Asia/Tokyo'};
  const clock=clocks[String(market)];if(!clock)throw new BrokerParseError('Unknown historical market timezone');return clock;
}
export function putHistoryMultiplier(map: Map<string,string>, key:string, value:unknown): void {
  if(value==null||value==='')return;
  const next=historyAmount(value),old=map.get(key);
  if(Number(next)<=0||old&&!/^0(?:\.0+)?$/.test(addDecimals(old,`-${next}`)))throw new BrokerParseError('Conflicting exact historical multiplier');
  map.set(key,next);
}
export function historyRatio(numerator:string,denominator:string):string {
 const parts=(v:string)=>{const text=decimal(v);return {units:BigInt(text.replace('.','')),scale:text.split('.')[1]?.length??0};};
 const n=parts(numerator),d=parts(denominator);if(n.units<=0n||d.units<=0n)throw new BrokerParseError('Historical leg quantity ratio must be positive');
 const top=n.units*10n**BigInt(d.scale),bottom=d.units*10n**BigInt(n.scale);let q=top/bottom,r=top%bottom,out=String(q);
 if(!r)return out;out+='.';
 for(let i=0;i<18&&r;i++){r*=10n;out+=String(r/bottom);r%=bottom;}
 if(r)throw new BrokerParseError('Historical leg ratio is not an exact finite decimal');return out;
}
/** Use the broker's settled cash amount, allowing only its currency's rounding. */
export function reconcileHistoryCash(reported:string,computed:string,currency:string):string {
 const difference=addDecimals(reported,computed.startsWith('-')?computed.slice(1):`-${computed}`).replace(/^-/,'');
 const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits!;
 const scale=difference.split('.')[1]?.length??0,units=BigInt(difference.replace('.',''));
 if(units*2n*10n**BigInt(digits)>10n**BigInt(scale))throw new BrokerParseError('Historical cash disagrees with exact contract size beyond currency rounding');
 return reported;
}
