import {randomUUID} from 'node:crypto';
import {beforeAll,expect,it} from 'vitest';
import {useTestDatabase,createInvestorFixture} from './helpers/database.js';
import {loadInvestor,saveInvestor} from '../src/state/investor-store.js';
import {reconstructSpreadsheetTrades} from '../src/brokers/spreadsheet-trades.js';
import {recoverStatementEffects,applyEffectRecovery} from '../src/brokers/execution-effect-recovery.js';
import {mergeOptionExecutions} from '../src/brokers/option-executions.js';
import {tradesFixture} from './helpers/trades-fixture.js';

await useTestDatabase({books:true});
beforeAll(async()=>{const {migrateBooks}=await import('../src/books/index.js');await migrateBooks();});
it('persists independently sourced manual effects through normal books reconciliation and PostgreSQL jsonb reloads',async()=>{
 const state=tradesFixture(),user=randomUUID();state.user={id:user,created_at:'2026-01-01',auth_token:randomUUID()};
 const manual=reconstructSpreadsheetTrades([{source_sha256:'a'.repeat(64),sheet:'2022',row:5,date:'2022-07-20',symbol:'BAC',strategy_as_reported:'BAC 29JUL22 29 P',strike_as_reported:'29',expiry_excel_serial_as_reported:'44771',quantity_as_reported:'5',currency:'USD',credit:'295',debit:'0',fees:'3.75'}],
  {channel:'ibkr',account_id:'U1',source_sha256:'a'.repeat(64),source_file_id:'journal.xlsx',sheet:'2022',year:2022,approved_multiplier:'100'}).executions[0];
 state.option_executions=[manual];await createInvestorFixture(state);
 const source={file_id:'statement.csv',bytes:Buffer.from('Account Information,Data,Account,U1\nTrades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Code\nTrades,Data,Order,Equity and Index Options,USD,BAC 29JUL22 29 P,"2022-07-20, 10:00:00",-5,0.59,295,-9.99,O')};
 const snapshot=await loadInvestor(user),before=structuredClone(snapshot.state);
 const result=recoverStatementEffects(snapshot.state,[source],{channel:'ibkr',account_id:'U1'});expect(result.changes).toHaveLength(1);
 snapshot.state=applyEffectRecovery(snapshot.state,result.changes);await saveInvestor(snapshot);
 const actual=await loadInvestor(user),e=actual.state.option_executions![0];
 expect(actual.state.portfolio).toEqual(before.portfolio);expect(actual.state.cash).toEqual(before.cash);
 expect(e).toMatchObject({effect:'open',executed_at:'2022-07-20',gross_premium:'295',commission:'-3.75',spreadsheet_source:manual.spreadsheet_source});
 expect(e.effect_evidence![0]).toMatchObject({kind:'broker_statement',source_file_id:'statement.csv'});
 expect(mergeOptionExecutions([e],[manual])[0]).toEqual(e);
 expect(recoverStatementEffects(actual.state,[source],{channel:'ibkr',account_id:'U1'}).changes).toEqual([]);
});
