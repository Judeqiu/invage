import { describe, it, expect } from 'vitest';
import { buildLivePositions, filterLiveByChannel } from '../src/report/dashboard-model.js';
import { applyBrokerNav } from '../src/report/broker-nav.js';
import { freezeReadModel } from '../src/state/freeze-read-model.js';
import { valuePosition } from '../src/market/position-value.js';
import type { Holding } from '../src/market/types.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';

it('includes frozen broker stock custody metadata without mutating it', () => {
  const h = freezeReadModel<Holding>({ units: 108.3256, avg_price: 350.821, currency: 'USD', channel: 'broker', broker_ref: { listing_exchange: 'US' }, encumbrance: { kind: 'lent', units: 1 } });
  const before = JSON.stringify(h);
  const live = buildLivePositions({ 'AVGO@broker': h }, { AVGO: 319.4534 }, undefined, null, [], undefined, undefined, { resilient: true });
  expect(live.positions).toHaveLength(1);
  expect(live.equityValue).toBeCloseTo(34604.98122704, 8);
  expect(live.issues).toEqual([]);
  expect(JSON.stringify(h)).toBe(before);
});

it('reproduces the complaint subtotal and restores all five equities at the same saved marks', () => {
  const portfolio: Record<string, Holding> = {};
  const prices: Record<string, number> = {};
  for (const [key, units, avg, price] of [ ['AVGO',108.3256,350.821,319.4534], ['MSFT',.6251,388.402,557.64], ['SCHD',7.5365,32.163,36.3], ['SPCX',2,199,134.3], ['GOOGL',1,347.2,291.45] ] as const) {
    portfolio[key+'@broker'] = { units, avg_price: avg, instrument: 'equity', currency: 'USD', channel: 'broker', broker_ref: { listing_exchange: 'US' } }; prices[key] = price;
  }
  for (const [key, units, avg, mark] of [['SOXL70',3,1763,2034],['INTC72',2,114,1569],['SOXL65',1,225,1150],['SKHY',1,-744,520],['AVGO400',1,1950,370],['INTC45',2,137,148],['ORCL',1,213,278]] as const) {
    portfolio[key+'@broker'] = { units, avg_price: avg, instrument: 'option', currency: 'USD', channel: 'broker', option: { underlying: key, mark, right: 'put', side: 'short', strike: 1, multiplier: 100, settlement: 'physical', expiry: '2026-12-18' } };
  }
  const cash = [{ amount:2461.59,currency:'USD',channel:'broker' },{amount:3000.91,currency:'SGD',channel:'broker'}];
  const optionsOnly = Object.fromEntries(Object.entries(portfolio).filter(([,h]) => h.option));
  const args = [prices, undefined, cash, [], undefined, { reportingCurrency:'USD', fxRates:{SGD:.7834289} }, {resilient:true}] as const;
  expect(buildLivePositions(optionsOnly,...args).totalValue).toBeCloseTo(-7041.410379701, 8);
  const live = buildLivePositions(freezeReadModel(portfolio),...args);
  expect(live.positions).toHaveLength(12);
  expect(live.equityValue).toBeCloseTo(35787.18694104, 8);
  expect(live.totalValue).toBeCloseTo(28745.776561339, 8);
  expect(live.issues).toEqual([]);
  expect(portfolio['SKHY@broker'].avg_price).toBe(-744);
  applyBrokerNav(live,{broker:{as_of:'2026-11-05',currency:'USD',broker_net_assets:29644.0691,broker_cash:4812.51,fund_assets:674.9}});
  expect(live.totalValue).toBe(29644.0691);
  expect(live.cashAmount).toBe(4812.51);
  expect(live.itemizedTotalValue).toBeCloseTo(28745.776561339, 8);
  expect(filterLiveByChannel(live,'broker').totalValue).toBe(29644.0691);
  const pages = buildPageProjections({ model:{live, history:[],periodChange:null,lastSnapshot:null}, generatedAt:'2026-11-05T11:33:07.490Z' } as unknown as DashboardPayload);
  expect(pages.dashboard.live.merged.view).toMatchObject({totalValue:29644.0691});
  expect(pages.dashboard.live.broker.view).toMatchObject({totalValue:29644.0691});
});

it('replaces each broker once, converts once, preserves manual accounts and explicit zero/negative NAV', () => {
  const live = buildLivePositions({}, {}, undefined, [ {channel:'foreign',currency:'USD',amount:1}, {channel:'manual',currency:'USD',amount:10}, {channel:'zero',currency:'USD',amount:5} ], [], undefined, {reportingCurrency:'USD',fxRates:{SGD:.75}}, {allowEmpty:true});
  applyBrokerNav(live,{ foreign:{as_of:'2026-11-05',currency:'SGD',broker_net_assets:-100}, zero:{as_of:'2026-11-05',currency:'USD',broker_net_assets:0} });
  expect(live.totalValue).toBe(-65);
  expect(filterLiveByChannel(live,'zero').totalValue).toBe(0);
  expect(filterLiveByChannel(live,'foreign').totalValue).toBe(-75);
});

it('uses exact broker market values and unrealized P/L while preserving diluted cost and separate broker position P/L', () => {
  const h: Holding = {units:1,avg_price:-744,currency:'USD',instrument:'option',option:{underlying:'SKHY',right:'put',side:'short',strike:135,expiry:'2026-11-20',multiplier:100,settlement:'physical',mark:520},
    broker_values:{source:'moomoo.positions',as_of:'2026-11-05T11:32:58Z',currency:'USD',units:1,avg_price:-744,mark:504.9,market_value:-504.93,unrealized_pl:-369.93,position_pl:-1248.93,position_pl_pct:0,realized_pl:-879}};
  h.broker_values!.option_contract={...h.option!};
  const e = valuePosition('SKHY',freezeReadModel(h));
  expect(e).toMatchObject({value:-504.93,pl:-369.93,cost:744,price:504.9});
  expect(h.avg_price).toBe(-744);
  expect(valuePosition('SKHY',{...h,option:{...h.option!,strike:140}}).value).toBe(-520);
  expect(valuePosition('SKHY',{...h,units:2}).value).toBe(-1040);
});

it('keeps exact broker option values and unrealized P/L consistent across pages after FX conversion', () => {
 const h:Holding={units:1,avg_price:-744,currency:'USD',channel:'broker',instrument:'option',option:{underlying:'SKHY',right:'put',side:'short',strike:135,expiry:'2026-11-20',multiplier:100,settlement:'physical',mark:504.9},broker_values:{source:'broker',as_of:'2026-11-05',currency:'USD',units:1,avg_price:-744,mark:504.9,market_value:-504.93,unrealized_pl:-369.93,position_pl:-1248.93,position_pl_pct:0}};
 h.broker_values!.option_contract={...h.option!};
 const live=buildLivePositions({'SKHY@broker':h},{SKHY:136},undefined,[{channel:'broker',amount:1000,currency:'USD'}],[],'2026-11-05',{reportingCurrency:'SGD',fxRates:{USD:1.3}},{resilient:true});
 const payload={model:{live,history:[],periodChange:null,lastSnapshot:null},generatedAt:'2026-11-05T11:33:07Z',brokerAsOf:{broker:'2026-11-05'},equityPrices:{SKHY:136}} as unknown as DashboardPayload;
 const pages=buildPageProjections(payload);
 expect(live.positions[0].value).toBeCloseTo(-504.93*1.3,8);
 expect(live.totalPL).toBeCloseTo(-369.93*1.3,8);
 expect((pages.positions.all as any).obligations[0].pnl).toBeCloseTo(live.totalPL,8);
 expect((pages.insights.all as any).totalPnl).toBeCloseTo(live.totalPL,8);
});
