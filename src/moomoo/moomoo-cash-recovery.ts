import { isDeepStrictEqual } from 'node:util';
import { assertBrokerHistory, mergeBrokerHistory, verifiedHistoryMultipliers, type BrokerHistory } from '../brokers/history.js';
import { addDecimals, negateDecimal } from '../brokers/option-executions.js';
import { historyProduct } from '../brokers/history-values.js';
import { recoverMooMooCashMultipliers } from './moomoo-cash-metadata.js';
import { moomooMarketTime } from './moomoo-history.js';
import type { MooMooRawBundle } from './moomoo-types.js';

/** Enrich only missing metadata/cash. Retained broker fees and execution identity win. */
export function recoverRetainedMooMooCash(current: BrokerHistory, source: BrokerHistory, bundle: MooMooRawBundle) {
  assertBrokerHistory(current); assertBrokerHistory(source);
  for (const key of ['broker_id','channel','account_id'] as const) if(current[key]!==source[key]) throw Error('Recovery account binding changed');
  if(current.broker_id!=='moomoo'||bundle.schema!=='invage.moomoo.raw.v1'||bundle.acc_id!==current.account_id)throw Error('Recovery requires the bound moomoo account');
  const sizes=recoverMooMooCashMultipliers(bundle,verifiedHistoryMultipliers(source));
  const fresh=new Map(bundle.fills_history?.rows.map(row=>[String(row.deal_id),row]));
  const canonical=(v:string)=>addDecimals(v,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1').replace(/^-0$/,'0');
  const oldById=new Map(source.executions.map(e=>[e.id,e]));
  const currentById=new Map(current.executions.map(e=>[e.id,e]));
  for(const old of source.executions) {
    const row=fresh.get(old.id),now=currentById.get(old.id);
    if(!row||!now||row.code!==old.native_symbol||String(row.order_id)!==old.order_id||canonical(String(row.qty))!==canonical(old.quantity)||old.price===null||canonical(String(row.price))!==canonical(old.price)||
      (['BUY','BUY_BACK'].includes(String(row.trd_side))?'buy':['SELL','SELL_SHORT'].includes(String(row.trd_side))?'sell':null)!==old.side||
      moomooMarketTime(row.create_time,old.native_symbol.split('.')[0])!==old.executed_at)throw Error('Fresh API fill no longer matches retained execution');
    for(const key of Object.keys(old) as Array<keyof typeof old>) {
      if(['multiplier','gross_cash','fee_cash','fee_source','effect'].includes(key))continue;
      if(!isDeepStrictEqual(old[key],now[key]))throw Error(`Retained execution changed: ${key}`);
    }
    for(const key of ['multiplier','gross_cash','fee_cash'] as const)if(old[key]!==null&&(now[key]===null||canonical(old[key])!==canonical(now[key]!)))throw Error('Previously known broker value changed');
  }
  const recovered:string[]=[];
  const executions=current.executions.map(row=>{
    if(!oldById.has(row.id)||row.instrument!=='option'||!sizes.has(row.native_symbol))return row;
    const multiplier=sizes.get(row.native_symbol)!;
    if(row.price===null)throw Error('Missing broker price');
    const value=historyProduct(row.quantity,row.price,multiplier);
    const gross=row.side==='buy'?negateDecimal(value):value;
    if(row.multiplier!==null&&canonical(row.multiplier)!==canonical(multiplier)||row.gross_cash!==null&&canonical(row.gross_cash)!==canonical(gross))throw Error('Recovery conflicts with known broker values');
    if(row.multiplier!==null&&row.gross_cash!==null)return row;
    recovered.push(row.id);
    return {...row,multiplier:row.multiplier??multiplier,gross_cash:row.gross_cash??gross};
  });
  const history=recovered.length?mergeBrokerHistory(current,{...current,executions}):current;
  for(const before of current.executions) {
    const after=history.executions.find(row=>row.id===before.id)!;
    if(!isDeepStrictEqual({...after,multiplier:before.multiplier,gross_cash:before.gross_cash},before))throw Error('Recovery modified unrelated execution evidence');
  }
  return {history,recovered,multipliers:Object.fromEntries(sizes)};
}
