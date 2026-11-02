import {describe,it,expect} from 'vitest';
import {readIBKRReviewStatement,planIBKRWorksheetReview,statementCSV} from '../src/brokers/ibkr-worksheet-review.js';
import type {SpreadsheetJournalRow} from '../src/brokers/spreadsheet-trades.js';
const row=(extra:Partial<SpreadsheetJournalRow>={}):SpreadsheetJournalRow=>({source_sha256:'a'.repeat(64),sheet:'2022',row:110,date:'2022-10-24',symbol:'TSLA',strategy_as_reported:'TSLA 28OCT22 270 P',strike_as_reported:'270',expiry_excel_serial_as_reported:'44862',quantity_as_reported:'1',currency:'USD',credit:'0',debit:'-6455',fees:'0.74809',...extra});
const csv=(symbol:string,date:string,quantity:string,price:string,proceeds:string,fee:string,code:string,extra='')=>Buffer.from(`Account Information,Header,Field Name,Field Value
Account Information,Data,Account,A1
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Proceeds,Comm/Fee,Realized P/L,Code
Trades,Data,Order,Equity and Index Options,USD,${symbol},"${date}, 09:45:18",${quantity},${price},${proceeds},${fee},0,${code}
${extra}Financial Instrument Information,Header,Asset Category,Description,Underlying,Multiplier,Expiry,Type,Strike
Financial Instrument Information,Data,Equity and Index Options,${symbol},TSLA,100,2022-10-28,P,270
Codes,Data,A,Assignment
Codes,Data,Ep,Resulted from an Expired Position
`);
const scope={channel:'ibkr',account_id:'A1'};
const plan=(r:SpreadsheetJournalRow,b:Buffer)=>planIBKRWorksheetReview([r],[readIBKRReviewStatement('monthly.csv',b,'A1')],scope);
describe('IBKR held worksheet evidence',()=>{
 it('preserves source line numbers and quoted CSV',()=>{expect(statementCSV('\uFEFFa,"b,c"\r\nx,"y\ny"\r\nz,q')).toEqual([{line:1,cells:['a','b,c']},{line:2,cells:['x','y\ny']},{line:4,cells:['z','q']}]);expect(()=>statementCSV('a,"b')).toThrow('Unterminated');});
 it('uses the actual negative proceeds and exact fee for row 110',()=>{
  const p=plan(row(),csv('TSLA 28OCT22 270 P','2022-10-24','1','64.55','-6455','-0.7480905','C'));
  expect(p.executions[0]).toMatchObject({side:'buy',effect:'close',gross_premium:'-6455',commission:'-0.7480905',contracts:'1'});
  expect(p.gross_cash).toBe('-6455');expect(row().debit).toBe('-6455');
 });
 it('resolves the second negative debit without flipping its broker cash',()=>{
  const b=csv('TSLA 19JAN24 350 C','2022-11-21','4','9.5','-3800','-2.902482','C').toString().replace('2022-10-28,P,270','2024-01-19,C,350');
  const p=plan(row({row:162,date:'2022-11-21',strategy_as_reported:'TSLA 19JAN24 350 C',quantity_as_reported:'4',debit:'-3800'}),Buffer.from(b));
  expect(p.executions[0]).toMatchObject({gross_premium:'-3800',commission:'-2.902482',side:'buy',effect:'close'});
 });
 it('distinguishes a same-day opening sale from the reviewed closing buy',()=>{
  const b=csv('TSLA 28OCT22 270 P','2022-10-24','1','64.55','-6455','-0.7480905','C').toString().replace('Financial Instrument Information,Header','Trades,Data,Order,Equity and Index Options,USD,TSLA 28OCT22 270 P,"2022-10-24, 09:00:00",-1,10,1000,-1,0,O\nFinancial Instrument Information,Header');
  expect(plan(row(),Buffer.from(b)).executions[0].gross_premium).toBe('-6455');
 });
 it('uses broker quantity for an explicit expiration and records the discrepancy',()=>{
  const p=plan(row({date:'2022-10-28',credit:'0',debit:'0',quantity_as_reported:'1'}),csv('TSLA 28OCT22 270 P','2022-10-28','5','0','0','0','C;Ep'));
  expect(p.executions).toHaveLength(0);expect(p.events[0]).toMatchObject({kind:'expiration',contracts:'5',source:'broker_statement',proceeds:'0'});
  expect(p.resolutions[0]).toMatchObject({quantity_discrepancy:true});
 });
 it('requires matching physical shares and keeps their principal out of premium',()=>{
  const shares='Trades,Data,Order,Stocks,USD,TSLA,"2022-10-24, 09:45:18",100,270,-27000,0,0,A;O\n';
  const b=csv('TSLA 28OCT22 270 P','2022-10-24','1','0','0','0','A;C',shares);
  const p=plan(row({debit:'0'}),b);expect(p.events[0]).toMatchObject({kind:'assignment',settlement:'physical',proceeds:'0'});expect(p.gross_cash).toBe('0');
  expect(()=>plan(row({debit:'0'}),Buffer.from(b.toString().replace('-27000','-26000')))).toThrow('stock delivery');
 });
 it('rejects ambiguous matches, wrong accounts, mismatching cash and trade quantities',()=>{
  const b=csv('TSLA 28OCT22 270 P','2022-10-24','1','64.55','-6455','0.5','C');
  expect(()=>readIBKRReviewStatement('x',b,'other')).toThrow('account mismatch');
  const s=readIBKRReviewStatement('x',b,'A1');expect(()=>planIBKRWorksheetReview([row()],[s,s],scope)).toThrow('2 matching');
  expect(()=>plan(row({quantity_as_reported:'2'}),b)).toThrow('quantity differs');
  expect(()=>plan(row(),Buffer.from(b.toString().replace('64.55,-6455','64.55,6455')))).toThrow('proceeds disagree');
  expect(plan(row(),b).executions[0].commission).toBe('0.5');
 });
});
