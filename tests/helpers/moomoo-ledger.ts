import type {MooMooRawBundle} from '../../src/moomoo/moomoo-types.js';
export const ledgerRow={transaction_name:'Bank Transfer Deposits',created_time:'01/02/2024 03:04:05',cash_change:'+1,234.123456789012345678',balance:'Balance: -27.50 SGD',symbol:'',stock_name:''};
export function ledgerBundle(broker:'moomoo'|'futubull'='futubull',rows:Record<string,unknown>[]=[ledgerRow]):MooMooRawBundle {
 return {schema:broker==='moomoo'?'invage.moomoo.raw.v1':'invage.futubull.cloud.raw.v1',acc_id:'A',fetched_at:'2026-11-14T08:00:00.000Z',authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'7',currency:'USD'}},positions:{s:'ok',d:[]},account_cash_logs:{begin_time:'1',end_time:String(BigInt(Date.parse('2026-11-14T08:00:00.000Z'))*1000n),observed_at:'2026-11-14T08:00:00.000Z',complete:true,gaps:[],rows,requests:[]}};
}
