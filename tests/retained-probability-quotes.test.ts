import { expect, it } from 'vitest';
import { buildPageProjections } from '../src/report/page-projections.js';
import { retainProbabilityQuotes } from '../src/market/retain-probability-quotes.js';
import { buildLivePositions, buildDashboardModel } from '../src/report/dashboard-model.js';
import type { Holding } from '../src/market/types.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';
const pair = { mark:155, spot:92.07, optionAsOf:'2026-10-29T19:59:02.000Z', spotAsOf:'2026-10-29T20:00:01.000Z' };
function dashboard(): DashboardPayload {
  const holdings: Record<string,Holding> = { contract: { instrument:'option',channel:'ibkr',currency:'USD',units:5,avg_price:200,
    option:{ underlying:'INTC',right:'put',side:'short',strike:75,expiry:'2026-12-18',multiplier:100,mark:136.5,settlement:'physical' } } };
  return { generatedAt:'2026-10-29T23:20:00Z',empty:false,displayName:'Test',productProfile:'full',productName:'Test',benchmark:null,
    model:buildDashboardModel(buildLivePositions(holdings,{INTC:70.3415}),[]),equityPrices:{INTC:70.3415} };
}
it('retains the last valid paired quote across a missed refresh without changing valuation or evidence times', () => {
  const prior=dashboard(), next=dashboard();prior.model!.live.positions[0].probabilityQuote=pair;
  const valuation=JSON.stringify(next.model);
  retainProbabilityQuotes(next,prior);
  expect(next.model!.live.positions[0].probabilityQuote).toEqual(pair);
  delete next.model!.live.positions[0].probabilityQuote;
  expect(JSON.stringify(next.model)).toBe(valuation);
});
it('keeps newer valid evidence and falls back when a newer matched price cannot calibrate IV', () => {
  const prior=dashboard(), next=dashboard();prior.model!.live.positions[0].probabilityQuote=pair;
  const newer={...pair,mark:160,optionAsOf:'2026-10-29T20:01:00.000Z',spotAsOf:'2026-10-29T20:01:00.000Z'};
  next.model!.live.positions[0].probabilityQuote=newer;
  retainProbabilityQuotes(next,prior);expect(next.model!.live.positions[0].probabilityQuote).toEqual(newer);
  next.model!.live.positions[0].probabilityQuote={...newer,mark:100000};
  retainProbabilityQuotes(next,prior);expect(next.model!.live.positions[0].probabilityQuote).toEqual(pair);
});
it('does not reuse another account, currency, contract or multiplier', () => {
  for (const mutate of [
    (p:any)=>p.channel='other', (p:any)=>p.currency='HKD', (p:any)=>p.option.strike=80,
    (p:any)=>p.option.expiry='2027-01-15',(p:any)=>p.option.multiplier=10,
  ]) {
    const prior=dashboard(),next=dashboard();prior.model!.live.positions[0].probabilityQuote=pair;mutate(next.model!.live.positions[0]);
    retainProbabilityQuotes(next,prior);expect(next.model!.live.positions[0].probabilityQuote).toBeUndefined();
  }
});
it('applies existing quote-age and timestamp-matching validation to retained evidence', () => {
  const prior=dashboard(),next=dashboard();prior.model!.live.positions[0].probabilityQuote=pair;
  next.generatedAt='2026-11-07T23:20:00Z';retainProbabilityQuotes(next,prior);
  expect(next.model!.live.positions[0].probabilityQuote).toBeUndefined();
  next.generatedAt='2026-10-29T23:20:00Z';prior.model!.live.positions[0].probabilityQuote={...pair,optionAsOf:'2026-10-29T19:00:00Z'};
  retainProbabilityQuotes(next,prior);expect(next.model!.live.positions[0].probabilityQuote).toBeUndefined();
});

it('flags missing-evidence contracts regardless of expiry and calculates the observed INTC row', () => {
  const payload=dashboard();
  const rows=()=>(buildPageProjections(payload).dashboard.live.merged as any).risk.wheel.rows;
  expect(rows()[0]).toMatchObject({flagged:true,estimate:{probability:null}});
  payload.model!.live.positions[0].probabilityQuote=pair;
  const row=rows()[0];
  expect(row.flagged).toBe(true);
  expect(row.estimate.probability).toBeCloseTo(.6479676172,7);
});
