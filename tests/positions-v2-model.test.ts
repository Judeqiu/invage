import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { positionsFixture } from './helpers/positions-fixture.js';

const context = runInNewContext(['webui/option-probability.js', 'webui/option-position.js', 'webui/positions/model.js'].map(p => readFileSync(p, 'utf8')).join('\n') + '; PositionsV2');

const build = (data: any = positionsFixture(), channel = 'all') => context.build(data, channel);

it('matches the mockup’s exact column names and order', () => {
  expect([...context.equityColumns]).toEqual(['Ticker','Shares','Avg cost','Total cost','Last','Market value','Unrealized P&L','Return','% of NAV','Covered','Broker']);
  expect([...context.obligationColumns]).toEqual(['Ticker','Last','Shares held','Put contracts','Cash if assigned','Call contracts','Shares if called','Premium','Open P&L','Nearest expiry','High risk']);
});
it('groups stock costs and values, but never covers one broker’s calls with another broker’s shares', () => {
  const view = build();
  expect(view.stocks).toHaveLength(1);
  expect(view.stocks[0]).toMatchObject({ ticker:'AAPL', shares:300, cost:26000, value:30000, pnl:4000, covered:100, idle:200, navPct:120 });
  expect(view.stocks[0].avgCost).toBeCloseTo(26000 / 300);
  expect(view.totals.coveragePct).toBeCloseTo(100 / 300 * 100);
  expect(build(undefined, 'tiger').stocks[0]).toMatchObject({ shares:200, covered:0, idle:200 });
  expect(build(undefined, 'tiger').obligations).toHaveLength(0);
  expect(build(undefined, 'ibkr').cash).toBe(1000);
});
it('uses open quantities and matched premium; high risk counts rows rather than contract quantity', () => {
  const row = build().obligations[0];
  expect(row).toMatchObject({ putContracts:1, callContracts:2, cashIfAssigned:12000, sharesIfCalled:200, premium:1500, nearestDte:31, highRisk:2, unscored:0 });
  const data = positionsFixture(); delete data.optionTradeDetails['AAPL-put'];
  expect(build(data).obligations[0]).toMatchObject({ premium:null, premiumSubtotal:1000, missingPremium:1, knownPremium:1 });
  data.optionTradeDetails = {};
  expect(build(data).obligations[0]).toMatchObject({ premium:null, missingPremium:2, knownPremium:0 });
});
it('scores broker marks without paired trade quotes, but leaves stale or missing broker inputs unscored', () => {
  const data = positionsFixture(); data.brokerAsOf.ibkr = '2026-10-01';
  expect(build(data).obligations[0]).toMatchObject({ cashIfAssigned:null, sharesIfCalled:null, premium:null, pnl:null, highRisk:0, unscored:2, stale:true });
  expect(build(data).stocks[0].covered).toBeNull();
  data.brokerAsOf.ibkr = '2026-10-20';
  for (const p of data.model.live.positions) if (p.option) delete p.probabilityQuote;
  expect(build(data).obligations[0]).toMatchObject({ highRisk:2, unscored:0 });
  for (const p of data.model.live.positions) if (p.option) delete p.option.mark;
  expect(build(data).obligations[0]).toMatchObject({ highRisk:0, unscored:2 });
  for (const p of data.model.live.positions) if (p.option) p.option.expiry = '2026-10-01';
  expect(build(data).obligations[0].nearestDte).toBe(-19);
});
it('does not combine unconverted currencies or manufacture prices from book-cost fallbacks', () => {
  const data = positionsFixture(); data.model.live.positions[1].currency = 'SGD';
  expect(build(data).stocks[0]).toMatchObject({ cost:null, value:null, avgCost:null, last:null, pnl:null });
  data.model.live.fxApplied = true; data.model.live.fxRates = { SGD:0.75 };
  data.model.live.positions[1].cost *= 0.75; data.model.live.positions[1].value *= 0.75;
  expect(build(data).stocks[0]).toMatchObject({ cost:21500, value:25000 });
  data.model.live.positions[1].pricingMode = 'cost';
  expect(build(data).stocks[0]).toMatchObject({ cost:21500, value:null, last:null, pnl:null, estimated:true });
});
it('keeps fund holdings separate and cash-settled calls out of physical share coverage', () => {
  const data = positionsFixture();
  data.model.live.positions.push({ ...data.model.live.positions[1], ticker:'FUND@tiger', instrument:'fund' });
  data.model.live.positions.find((p: any) => p.option?.right === 'call').option.settlement = 'cash';
  expect(build(data).funds).toHaveLength(1);
  expect(build(data).stocks[0].covered).toBe(0);
  expect(build(data).obligations[0].sharesIfCalled).toBe(0);
});
