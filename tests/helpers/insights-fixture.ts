import { positionsFixture } from './positions-fixture.js';
export function insightsFixture(): any {
  const p = positionsFixture();
  p.model.live.positions.push({ ...p.model.live.positions[2],ticker:'TSLA-call',units:1,cost:-1000,value:-100,pl:900,
    option:{...p.model.live.positions[2].option,underlying:'TSLA',right:'call',strike:120,mark:100},
    probabilityQuote:{spot:100,mark:100,spotAsOf:'2026-10-20T20:00:00Z'},contingentCashObligation:0,contingentShareObligation:100 });
  p.optionTradeDetails['TSLA-call'] = {stoGrossPremium:1000,currency:'USD'};
  return p;
}
