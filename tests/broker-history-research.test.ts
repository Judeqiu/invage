import { describe, expect, it } from 'vitest';
// Operator helper deliberately has no database/application side effects.
// @ts-expect-error JavaScript research helper
import { collectPages, assertAccountRows, flexYearWindows, summarizeFlex } from '../scripts/lib/broker-history-research.mjs';
import { parseXmlAttrs } from '../src/ibkr/flex-parse.js';
describe('read-only historical research',()=>{
 it('continues after an empty page when a cursor is supplied',async()=>{
  const tokens:unknown[]=[];const result=await collectPages(async(token:unknown)=>{tokens.push(token);return token?{data:[{id:'1'}]}:{data:[],next:'a'}},{rows:(r:any)=>r.data,cursor:(r:any)=>r.next});
  expect(tokens).toEqual([undefined,'a']);expect(result).toEqual([{id:'1'}]);
 });
 it('rejects repeated cursors and malformed rows',async()=>{
  await expect(collectPages(async()=>({data:[],next:'a'}),{rows:(r:any)=>r.data,cursor:(r:any)=>r.next})).rejects.toThrow('did not advance');
  await expect(collectPages(async()=>({data:null}),{rows:(r:any)=>r.data,cursor:()=>null})).rejects.toThrow('invalid rows');
 });
 it('requires reported account identity for Tiger and rejects every foreign identity',()=>{
  expect(()=>assertAccountRows([{}],'a',['account'],true)).toThrow();
  expect(()=>assertAccountRows([{account:'a',accountId:'b'}],'a',['account','accountId'])).toThrow();
  expect(()=>assertAccountRows(undefined,'a',['account'])).toThrow();
 });
 it('bounds IBKR to the current and four previous calendar years',()=>{
  expect(flexYearWindows(new Date('2026-10-14T00:00:00Z'))).toEqual([
   {from:'20220101',through:'20221231'},{from:'20230101',through:'20231231'},{from:'20240101',through:'20241231'},
   {from:'20250101',through:'20251231'},{from:'20260101',through:'20261014'}]);
 });
 it('counts only exact-account execution rows, excluding totals and foreign statements',()=>{
  const xml='<FlexQueryResponse><FlexStatement accountId="a" fromDate="20220101" toDate="20221231"><Trades><Trade accountId="a" levelOfDetail="EXECUTION" tradeID="1" assetCategory="STK" symbol="AAPL"/><Trade levelOfDetail="SYMBOL_SUMMARY" tradeID="2" assetCategory="STK"/></Trades></FlexStatement><FlexStatement accountId="b"><Trades><Trade tradeID="3" levelOfDetail="EXECUTION" assetCategory="OPT"/></Trades></FlexStatement></FlexQueryResponse>';
  expect(summarizeFlex(xml,'a',parseXmlAttrs)).toMatchObject({executionRows:1,foreignStatements:1,securities:1,options:0,sections:['Trades']});
  expect(()=>summarizeFlex(xml,'c',parseXmlAttrs)).toThrow('bound account');
 });
});
