import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildExecutionJournal } from '../src/brokers/option-executions.js';
import { optionFill } from './helpers/trades-fixture.js';
const context: any = {};runInNewContext(readFileSync('webui/trades/model.js','utf8'),context);const model = context.TradesV2;
const row = (patch: any = {}) => ({id:'1',entryDate:'2026-10-01',entryThrough:'2026-10-01',currency:'USD',premium:'200',contracts:'1',side:'short',strike:'100',multiplier:'100',realizedPnl:null,feeBasis:'unknown',...patch});
it('preserves every opening and closing transaction, account identity, original cash and trade dates', () => {
  const journal = buildExecutionJournal([optionFill(),
    optionFill({execution_id:'close',effect:'close',side:'buy',executed_at:'2026-10-01T10:00:00',gross_premium:'-12.345678',commission:'0.25'}),
    optionFill({execution_id:'close',channel:'tiger',account_id:'T1',effect:'close',side:'sell',right:'call',currency:'HKD',commission:null}),
    optionFill({execution_id:'unknown',effect:'unknown'}),optionFill({execution_id:'mixed',effect:'mixed'}),
    optionFill({execution_id:'manual:spreadsheet:'+ 'a'.repeat(64) + ':1',effect:'unknown',executed_at:'2026-08-01',
      spreadsheet_source:{sha256:'a'.repeat(64),file_id:'worksheet',sheet:'Trades',row:1,date_precision:'day',multiplier_basis:'user_approved'}})]);
  const before = JSON.stringify(journal), rows = model.transactionRows(journal);
  expect(rows).toHaveLength(journal.executions.length);
  expect(new Set(rows.map((r: any) => r.id)).size).toBe(rows.length);
  expect(JSON.stringify(journal)).toBe(before);
  expect(rows.map((r: any) => r.execution)).toEqual(expect.arrayContaining(journal.executions));
  const f = {channel:'all',ticker:'all',right:'all',currency:'all',year:'2026',month:'10',action:'buy to close'};
  const closing = model.filterTransactions(rows,f);
  expect(closing).toHaveLength(1);
  expect(closing[0].execution).toMatchObject({gross_premium:'-12.345678',commission:'0.25',net_premium:'-12.095678',executed_at:'2026-10-01T10:00:00'});
  expect(model.filterTransactions(rows,{...f,month:'09',action:'sell to close',channel:'tiger',right:'call',currency:'HKD'})[0].execution.commission).toBeNull();
  expect(rows.some((r: any) => r.action === 'sell to unknown')).toBe(true);
  expect(rows.some((r: any) => r.action === 'sell to mixed')).toBe(true);
  expect(rows.find((r: any) => r.execution.spreadsheet_source).execution.executed_at).toBe('2026-08-01');
});
it('calculates chronological cash only with a seed and one native currency, and stops at gaps', () => {
  const rows = [row({id:'2',entryDate:'2026-10-02',entryThrough:'2026-10-02',premium:'300'}),row()];
  expect(model.cashBalances(rows,1000).get('2')).toBe(1500);
  expect(model.cashBalances(rows,null).size).toBe(0);
  expect(model.cashBalances([...rows,row({currency:'HKD'})],1000).size).toBe(0);
  expect(model.cashBalances([row(),row({id:'2',premium:null})],1000).get('2')).toBeNull();
  expect(model.cashBalances([row({entryDate:null})],1000).size).toBe(0);
  expect(model.cashBalances([row({entryThrough:'2026-10-02'})],1000).get('1')).toBeNull();
});
it('keeps subtotal currencies and P&L fee bases separate, with weighted nonannualized returns', () => {
  const totals = model.totals([row({realizedPnl:'100',feeBasis:'net'}),row({id:'2',realizedPnl:'200',feeBasis:'gross'}),row({currency:'HKD',premium:'50'})]);
  expect(totals).toHaveLength(2);
  expect(totals[0]).toMatchObject({mixedBasis:true,netSubtotal:100,grossSubtotal:200,returnsPct:2});
  expect(totals[1]).toMatchObject({premium:50,returnsPct:.5});
  expect(model.totals([row(),row({premium:null})])[0]).toMatchObject({missing:1,returnsPct:null});
});
it('groups descending opening years and months, with deterministic row order and undated entries last', () => {
  const rows = [row({id:'old',entryDate:'2025-12-31'}),row({id:'b',entryDate:'2026-10-01'}),
    row({id:'unknown',entryDate:null}),row({id:'aug',entryDate:'2026-08-20'}),row({id:'a',entryDate:'2026-10-01'})];
  const before = JSON.stringify(rows),years = model.groups(rows);
  expect(years.map((y: any) => [y.year,y.count])).toEqual([['2026',3],['2025',1],['Unknown',1]]);
  expect(years[0].months.map((m: any) => m.month)).toEqual(['2026-10','2026-08']);
  expect(years[0].months[0].entries.map((r: any) => r.id)).toEqual(['a','b']);
  expect(years[2].months[0].entries[0].id).toBe('unknown');
  expect(JSON.stringify(rows)).toBe(before);
});
it('summarizes each month by currency, with weighted returns and the last chronological running cash', () => {
  const rows = [row({id:'prior',entryDate:'2026-09-01',entryThrough:'2026-09-01',premium:'100'}),
    row({id:'a',premium:'200'}),row({id:'z',premium:'300',contracts:'2',strike:'200',multiplier:'10'})];
  const balances = model.cashBalances(rows,1000),october = rows.slice(1);
  expect(model.monthTotals(october,balances)[0]).toMatchObject({currency:'USD',contracts:3,premium:500,netCash:1600});
  expect(model.monthTotals(october,balances)[0].returnsPct).toBeCloseTo(500/14000*100);
  expect(model.monthTotals([...october,row({id:'hkd',currency:'HKD'})],balances)).toHaveLength(2);
  expect(model.monthTotals([row({id:'missing',premium:null})],new Map())[0]).toMatchObject({missing:1,returnsPct:null,netCash:null});
  expect(model.monthTotals([row({entryDate:null})],balances)[0].netCash).toBeNull();
});

it('filters unmatched closing fills by their reported trade date and leaves cash unknown', () => {
  const r = row({entryDate:null,lastTrade:'2026-07-18',status:'Incomplete history',multiplier:null,premium:null,netCash:null});
  const filters = {channel:'all',ticker:'all',right:'all',currency:'all',strategy:'all',status:'Needs review',year:'2026',month:'07'};
  expect(model.filter([r],filters)).toHaveLength(1);
  expect(model.filter([r],{...filters,month:'09'})).toHaveLength(0);
  expect(model.totals([r])[0]).toMatchObject({missing:1,missingPnl:1,returnsPct:null});
});

it('keeps verified partial closes visible as historical profit without labelling them unresolved', () => {
  const r=row({status:'Partially closed'}),f={channel:'all',ticker:'all',right:'all',currency:'all',strategy:'all',status:'Partially closed',year:'all',month:'all'};
  expect(model.isOpen(r)).toBe(false);
  expect(model.filter([r],f)).toHaveLength(1);
  expect(model.filter([r],{...f,status:'Needs review'})).toHaveLength(0);
});
