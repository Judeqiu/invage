import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { insightsFixture } from './helpers/insights-fixture.js';
const m = runInNewContext(['webui/option-probability.js','webui/option-position.js','webui/positions/model.js','webui/insights/model.js'].map(p => readFileSync(p,'utf8')).join('\n')+'; InsightsV2');
it('matches the five underlying columns and eight mockup statistics',() => {
  expect([...m.columns]).toEqual(['Underlying','Contract lines','Premium received','Open P&L','Signal']);
  expect([...m.statLabels]).toEqual(['Best contributor','Biggest drag','Contracts in profit','Average DTE','Average premium','Put / call split','LEAP exposure','Cash weight']);
});
it('uses reconciled remaining premium and current marks, with separate line and contract counts',() => {
  const v = m.build(insightsFixture());
  expect(v).toMatchObject({options:3,shorts:3,longs:0,premium:2500,optionPnl:-1900,obligation:12000,cashGap:9000,puts:1,calls:2,nearLines:0,averageDte:31});
  expect(v.averagePremium).toBeCloseTo(2500/3);
  expect(v.profitPct).toBeCloseTo(100/3);
  expect(v.best).toMatchObject({ticker:'TSLA',pnl:900,lines:1,contracts:1});
  expect(v.worst).toMatchObject({ticker:'AAPL',pnl:-2800,lines:2,contracts:3});
  expect(v.actions[0]).toMatchObject({ticker:'TSLA',capture:90});
});
it('does not manufacture opening proceeds or rank a partially valued book',() => {
  const p = insightsFixture();delete p.optionTradeDetails['TSLA-call'];
  expect(m.build(p)).toMatchObject({premium:null,averagePremium:null,actions:[]});
  p.model.live.positions[2].pricingMode = 'cost';
  const v = m.build(p);
  expect(v).toMatchObject({best:null,worst:null,rankingIncomplete:true,profitPct:null,optionPnl:null});
});
it('keeps broker filters, currencies, cash and concentrations scoped consistently',() => {
  const p = insightsFixture();
  const tiger = m.build(p,'tiger');
  expect(tiger).toMatchObject({options:0,equities:1,cash:2000,nav:16000,actions:[],rows:[],cashGap:0});
  expect(tiger.cashWeight).toBe(12.5);
  p.model.live.positions[2].currency = 'HKD';
  expect(m.build(p)).toMatchObject({premium:null,optionPnl:null,obligation:null});
  p.model.live.fxApplied = true;p.model.live.fxRates = {HKD:.128};
  p.optionTradeDetails['AAPL-put'].currency = 'HKD';
  expect(m.build(p).premium).toBeCloseTo(2064);
});
it('marks stale brokers and old or missing matching quotes unscored, never clear',() => {
  const p = insightsFixture();p.brokerAsOf.ibkr = '2026-10-01';
  expect(m.build(p)).toMatchObject({premium:null,optionPnl:null,obligation:null,highRisk:0,unscored:3,actions:[]});
  p.brokerAsOf.ibkr = '2026-10-20';
  for (const row of p.model.live.positions) if (row.option) row.probabilityQuote.spotAsOf = '2026-09-01T00:00:00Z';
  expect(m.build(p)).toMatchObject({highRisk:0,unscored:3});
});
it('keeps cash settlement out of physical obligations and long premiums out of received credits',() => {
  const p = insightsFixture();p.model.live.positions[2].option.settlement = 'cash';
  p.model.live.positions[4].option.side = 'long';p.model.live.positions[4].value = 100;
  const v = m.build(p);
  expect(v).toMatchObject({shorts:2,longs:1,premium:1500,obligation:null,cashGap:null,calls:1,actions:[]});
  expect(v.rows.find((r: any) => r.ticker === 'TSLA')).toMatchObject({longLines:1,premium:0});
});
it('separates past-expiry records from the coming 30 days and handles missing dates and empty books',() => {
  const p = insightsFixture();p.model.live.positions[2].option.expiry = '2026-10-01';
  expect(m.build(p)).toMatchObject({expired:1,nearLines:0});
  delete p.generatedAt;
  expect(m.build(p).averageDte).toBeNull();
  expect(m.build({})).toMatchObject({options:0,rows:[],averageDte:null,averagePremium:null,profitPct:null,best:null,worst:null});
});
