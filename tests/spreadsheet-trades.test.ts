import { describe, expect, it } from 'vitest';
import { reconstructSpreadsheetTrades, type SpreadsheetJournalRow } from '../src/brokers/spreadsheet-trades.js';
import { assertOptionExecution, buildExecutionJournal, mergeOptionExecutions } from '../src/brokers/option-executions.js';
import { buildRecordedOptionAnalytics } from '../src/webapp/option-analytics.js';

const scope={channel:'ibkr',account_id:'U1',source_sha256:'a'.repeat(64),source_file_id:'offline-journals/source.xlsx',sheet:'2022',year:2022,approved_multiplier:'100'};
const row=(changes:Partial<SpreadsheetJournalRow>={}):SpreadsheetJournalRow=>({source_sha256:scope.source_sha256,sheet:'2022',row:5,date:'2022-06-23',symbol:'BAC',strategy_as_reported:'BAC 29JUL22 29 P',strike_as_reported:'29',expiry_excel_serial_as_reported:'44771',quantity_as_reported:'5',currency:'USD',credit:'295',debit:'0',fees:'3.75',...changes});
describe('approved spreadsheet trade reconstruction',()=>{
 it('preserves date precision, cash, fees and provenance without inventing opening intent',()=>{
  const {executions,review}=reconstructSpreadsheetTrades([row(),row({row:6,date:'2022-07-20',credit:'0',debit:'84',fees:'1.123456789'})],scope);
  expect(review).toEqual([]);
  expect(executions[0]).toMatchObject({executed_at:'2022-06-23',side:'sell',effect:'unknown',gross_premium:'295',commission:'-3.75',multiplier:'100',spreadsheet_source:{row:5,date_precision:'day',sha256:scope.source_sha256}});
  expect(executions[1]).toMatchObject({side:'buy',gross_premium:'-84',commission:'-1.123456789'});
  expect(mergeOptionExecutions(executions,executions)).toHaveLength(2);
  expect(buildExecutionJournal(executions).cumulative[0]).toMatchObject({gross_premium:'211',net_premium:'206.126543211'});
  expect(buildRecordedOptionAnalytics(executions).profits).toEqual([]);
 });
 it('holds zero cash, negative debits and conflicting terms for human review',()=>{
  const {executions,review}=reconstructSpreadsheetTrades([row({row:6,credit:'0',debit:'0',fees:'0'}),row({row:7,credit:'0',debit:'-3800'}),row({row:8,strike_as_reported:'30'}),row({row:9,expiry_excel_serial_as_reported:'44772'})],scope);
  expect(executions).toEqual([]);expect(review.map(r=>r.row)).toEqual([6,7,8,9]);
  expect(review[1].source.debit).toBe('-3800');
  expect(review[2].reasons).toContain('Strike column conflicts with strategy');
  expect(review[3].reasons).toContain('Expiry column conflicts with strategy');
 });
 it('rejects altered source scope or duplicate row identity before importing',()=>{
  expect(()=>reconstructSpreadsheetTrades([row({source_sha256:'b'.repeat(64)})],scope)).toThrow(/scope/);
  expect(()=>reconstructSpreadsheetTrades([row({date:'2023-01-01'})],scope)).toThrow(/scope/);
  expect(()=>reconstructSpreadsheetTrades([row(),row()],scope)).toThrow(/scope/);
 });
 it('accepts equivalent XLSX binary strike serialization without rounding cash',()=>{
  const r=row({strategy_as_reported:'BAC 29JUL22 133.33 P',strike_as_reported:'133.33000000000001',fees:'1.44177000000000001'});
  expect(reconstructSpreadsheetTrades([r],scope).executions[0]).toMatchObject({strike:'133.33',commission:'-1.44177000000000001'});
 });
 it('requires manual provenance for date-only trades and retains it across normalization',()=>{
  const manual=reconstructSpreadsheetTrades([row()],scope).executions[0];
  const {spreadsheet_source,...withoutSource}=manual;
  expect(()=>assertOptionExecution(withoutSource)).toThrow(/date/);
  expect(()=>assertOptionExecution({...manual,effect:'open'})).toThrow(/provenance/);
  expect(()=>assertOptionExecution({...manual,execution_id:'broker-123'})).toThrow(/provenance/);
  expect(mergeOptionExecutions([manual],[manual])[0].spreadsheet_source).toEqual(spreadsheet_source);
  const persisted={...manual,spreadsheet_source:Object.fromEntries(Object.entries(spreadsheet_source!).reverse())};
  expect(mergeOptionExecutions([persisted],[manual])).toHaveLength(1);
 });
});
