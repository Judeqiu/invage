import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const context: any = {};runInNewContext(readFileSync('webui/trades/model.js','utf8'),context);const model = context.TradesV2;
const row = (patch: any = {}) => ({id:'1',entryDate:'2026-10-01',entryThrough:'2026-10-01',currency:'USD',premium:'200',contracts:'1',side:'short',strike:'100',multiplier:'100',realizedPnl:null,feeBasis:'unknown',...patch});
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
