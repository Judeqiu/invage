import {expect,it} from 'vitest';
import {recoverStatementEffects,applyEffectRecovery,recoverSnapshotEffects} from '../src/brokers/execution-effect-recovery.js';
import {reconstructSpreadsheetTrades} from '../src/brokers/spreadsheet-trades.js';
import {assertOptionExecution,mergeOptionExecutions} from '../src/brokers/option-executions.js';
import {tradesFixture} from './helpers/trades-fixture.js';
import type {BrokerHistory} from '../src/brokers/history.js';
import type {OptionObservation} from '../src/brokers/option-history.js';

const scope={channel:'ibkr',account_id:'U1'};
function manual() {return reconstructSpreadsheetTrades([{source_sha256:'a'.repeat(64),sheet:'2022',row:5,date:'2022-07-20',symbol:'BAC',
 strategy_as_reported:'BAC 29JUL22 29 P',strike_as_reported:'29',expiry_excel_serial_as_reported:'44771',quantity_as_reported:'5',
 currency:'USD',credit:'295',debit:'0',fees:'3.75'}],{...scope,source_sha256:'a'.repeat(64),source_file_id:'journal.xlsx',sheet:'2022',year:2022,approved_multiplier:'100'}).executions[0];}
const csv=(rows:string[],account='U1')=>({file_id:'statements/july.csv',bytes:Buffer.from([
 `Account Information,Data,Account,${account}`,
 'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Code',...rows].join('\n'))});
const trade=(code='O',time='10:00:00',cash='295.00',quantity='-5')=>`Trades,Data,Order,Equity and Index Options,USD,BAC 29JUL22 29 P,"2022-07-20, ${time}",${quantity},0.59,${cash},-9.99,${code}`;
it('recovers explicit statement effects while retaining different fees, date precision and all original fields',()=>{
 const state=tradesFixture();state.option_executions=[manual()];const before=structuredClone(state);
 const preview=recoverStatementEffects(state,[csv([trade()])],scope);
 expect(preview.changes).toHaveLength(1);expect(preview.feeDifferences).toBe(1);
 const next=applyEffectRecovery(state,preview.changes),e=next.option_executions![0];
 expect(e).toMatchObject({effect:'open',executed_at:'2022-07-20',gross_premium:'295',commission:'-3.75',spreadsheet_source:manual().spreadsheet_source});
 expect(e.effect_evidence![0]).toMatchObject({kind:'broker_statement',source_file_id:'statements/july.csv',reference:expect.stringContaining('Code O')});
 expect(state).toEqual(before);expect(next.portfolio).toEqual(before.portfolio);expect(next.cash).toEqual(before.cash);
 expect(recoverStatementEffects(next,[csv([trade()])],scope).changes).toEqual([]);
 expect(mergeOptionExecutions([e],[manual()])[0]).toEqual(e);
 const reordered=JSON.parse(JSON.stringify(e),(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v);
 expect(mergeOptionExecutions([reordered],[e])[0]).toEqual(e);
 expect(()=>assertOptionExecution({...e,effect_evidence:undefined})).toThrow(/provenance/);
 expect(()=>applyEffectRecovery(next,[{...preview.changes[0],effect:'close'}])).toThrow(/contradicts/);
});
it('requires exact account, date, contract, quantity and cash; no rounding or initial-position assumptions',()=>{
 const state=tradesFixture();state.option_executions=[manual()];
 expect(()=>recoverStatementEffects(state,[csv([trade()],'U2')],scope)).toThrow(/account/);
 for(const row of [trade('O','10:00:00','295.000000001'),trade('O','10:00:00','295','-4'),trade().replace('BAC','XYZ'),trade().replace('2022-07-20','2022-07-21')]) {
  expect(recoverStatementEffects(state,[csv([row])],scope).changes).toEqual([]);
 }
});
it('withholds conflicting intent, lifecycle deliveries and overallocated statement matches',()=>{
 const state=tradesFixture();state.option_executions=[manual()];
 expect(recoverStatementEffects(state,[csv([trade('O'),trade('C','11:00:00')])],scope).changes).toEqual([]);
 expect(recoverStatementEffects(state,[csv([trade('A;C'),trade('C;Ep')])],scope).changes).toEqual([]);
 state.option_executions.push({...manual(),execution_id:manual().execution_id+'other',spreadsheet_source:{...manual().spreadsheet_source!,row:6}});
 expect(recoverStatementEffects(state,[csv([trade()]),csv([trade()])],scope).changes).toEqual([]);
 expect(recoverStatementEffects(state,[csv([trade('O'),trade('O','11:00:00')])],scope).changes).toHaveLength(2);
});
it('retains explicit mixed opening/closing codes without making them pure closes',()=>{
 const state=tradesFixture();state.option_executions=[manual()];
 expect(recoverStatementEffects(state,[csv([trade('O;C')])],scope).changes[0].effect).toBe('mixed');
});
it('uses a verified option-history tail to include a later snapshot without changing the broker sync cursor',()=>{
 const state=tradesFixture(),scope={broker_id:'tiger',channel:'tiger',account_id:'A'};
 const history:BrokerHistory={...scope,orders:[],sync:{version:1,mode:'full',from:'2026-11-05T00:00:00Z',through:'2026-11-05T15:59:59Z',status:'complete',full_history_synced:true,fees:'unavailable',gaps:[]},executions:[
 {...scope,id:'old',order_id:'roll',native_symbol:'OLD',symbol:'AVGO',instrument:'option',side:'buy',effect:'unknown',executed_at:'2026-11-05T10:36:50',clock:'America/New_York',currency:'USD',quantity:'1',price:'1',multiplier:'100',gross_cash:'-100',fee_cash:null,option:{right:'put',expiry:'2026-11-20',strike:'300'}},
 {...scope,id:'new',order_id:'roll',native_symbol:'NEW',symbol:'AVGO',instrument:'option',side:'sell',effect:'unknown',executed_at:'2026-11-05T10:36:50',clock:'America/New_York',currency:'USD',quantity:'1',price:'2',multiplier:'100',gross_cash:'200',fee_cash:null,option:{right:'put',expiry:'2027-03-19',strike:'300'}}]};
 const anchor=(at:string,expiry:string):OptionObservation=>({...scope,id:at,connection_id:'tiger',observed_at:at,as_of:'2026-11-05',source:'broker',complete:true,skipped_positions:0,options:[{key:expiry,underlying:'AVGO',right:'put',side:'short',strike:300,expiry,multiplier:100,settlement:'physical',units:1,avg_price:1,mark:1,currency:'USD'}]});
 state.option_observations=[anchor('2026-11-05T15:12:00Z','2026-11-20'),anchor('2026-11-05T16:00:01Z','2027-03-19')];
 const tail={channel:'tiger',account_id:'A',from:history.sync.through,through:'2026-11-05T17:00:00Z',complete:true,transactions:[]};
 const evidence={kind:'broker_positions' as const,source_sha256:'a'.repeat(64),source_file_id:'proof.json',reference:'complete tail and broker snapshots'};
 const before=structuredClone(history),changes=recoverSnapshotEffects(state,history,tail,evidence);
 expect(changes.map(c=>c.effect)).toEqual(['close','open']);expect(history).toEqual(before);
 expect(()=>recoverSnapshotEffects(state,history,{...tail,transactions:[{id:'unseen',accountId:'A',secType:'OPT'}]},evidence)).toThrow(/normal history ingestion/);
 expect(()=>recoverSnapshotEffects(state,history,{...tail,complete:false},evidence)).toThrow(/coverage/);
 expect(()=>recoverSnapshotEffects(state,history,{...tail,transactions:[{id:'old',accountId:'other',secType:'OPT'}]},evidence)).toThrow(/scope/);
});
