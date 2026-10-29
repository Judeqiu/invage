import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildPageProjections } from '../src/report/page-projections.js';
const context: any = {};
runInNewContext(readFileSync('webui/dashboard/net-risk-capital.js', 'utf8'), context);
const leg = (side: string, right: string, strike: number, cost: number, extra = {}) => ({
  instrument: 'option', channel: 'ibkr', currency: 'USD', units: 1, cost,
  option: { side, right, strike, multiplier: 100, underlying: 'AAPL', expiry: '2026-11-20' }, ...extra,
});
const risk = (positions: any[], extra = {}) => context.NetRiskCapital.calculate({ positions, reportingCurrency: 'USD', ...extra });
const stock = (units = 100, cost = 8000, extra = {}) => ({
  instrument: 'equity', ticker: 'AAPL@ibkr', channel: 'ibkr', currency: 'USD', units, cost, ...extra,
});
it('keeps the $95/$90 put spread obligation at $9,500 and maximum loss at $300', () => {
  const holdings: any = {};
  for (const [side, strike, avg_price] of [['short', 95, 300], ['long', 90, 100]] as const) {
    holdings[side] = { instrument: 'option', channel: 'ibkr', currency: 'USD', units: 1, avg_price,
      option: { side, right: 'put', strike, multiplier: 100, underlying: 'AAPL', expiry: '2026-11-20', settlement: 'physical', mark: 50 } };
  }
  const model = buildDashboardModel(buildLivePositions(holdings, {}, {},
    [{ channel: 'ibkr', currency: 'USD', amount: 10000 }], [], '2026-10-28', { reportingCurrency: 'USD', fxRates: {} }), []);
  const payload: any = { model, generatedAt: '2026-10-28T10:00:00Z', brokerAsOf: { ibkr: '2026-10-28' } };
  const views = buildPageProjections(payload).dashboard.live;
  for (const channel of ['merged', 'ibkr']) {
    const scope = views[channel] as any;
    expect(scope.assignmentObligation).toBe(9500);
    expect(context.NetRiskCapital.calculate(scope.view).value).toBe(300);
  }
});
it.each([
  ['short', 'put', 95, -300, 'long', 90, 100, 300],
  ['short', 'call', 95, -300, 'long', 100, 100, 300],
  ['long', 'call', 95, 300, 'short', 100, -100, 200],
  ['long', 'put', 100, 300, 'short', 95, -100, 200],
])('bounds a %s %s vertical without multiplying contract premiums again', (side, right, strike, cost, otherSide, otherStrike, otherCost, expected) => {
  expect(risk([leg(side as string, right as string, strike as number, cost as number),
    leg(otherSide as string, right as string, otherStrike as number, otherCost as number)]).value).toBe(expected);
});
it('uses backing shares for delivery without adding their principal to options risk capital', () => {
  const call = leg('short', 'call', 100, -300);
  expect(risk([call, stock()]).value).toBe(0);
  expect(risk([call, stock(125, 10000)]).value).toBe(0);
  expect(risk([call, stock(50, 4000)]).value).toBeNull();
  expect(risk([call, stock(100, 8000, { channel: 'other-account' })]).value).toBeNull();
  expect(risk([call, stock(100, null as any)]).value).toBe(0);
  expect(risk([call, stock(100, 16000, { currency: 'SGD' })], { fxRates: { SGD: 0.5 } }).value).toBeNull();
  expect(risk([call, stock(100, 16000)], { reportingCurrency: 'SGD', fxRates: { USD: 2 } }).value).toBe(0);
});

it('excludes the reported 35k of covered-call backing principal', () => {
  expect(risk([leg('short', 'call', 400, -1950), stock(100, 35000)]).value).toBe(0);
  // Replay the retained view's fractional backing lot and proportional 35k basis.
  expect(risk([leg('short', 'call', 400, -1950), stock(108.3256, 38002.8953176)]).value).toBe(0);
  // Other option risk remains: a $95/$90 put spread with $200 net credit.
  expect(risk([leg('short', 'call', 400, -1950), stock(100, 35000),
    leg('short', 'put', 95, -300, { channel: 'other-account' }),
    leg('long', 'put', 90, 100, { channel: 'other-account' })]).value).toBe(300);
});
it('never reuses shares across call expiries or charges stock cost to a protected call vertical', () => {
  const call = leg('short', 'call', 100, -300);
  const later = { ...call, option: { ...call.option, expiry: '2026-12-18' } };
  expect(risk([call, later, stock()]).value).toBeNull();
  expect(risk([call, later, stock(200, 16000)]).value).toBe(0);
  expect(risk([call, leg('long', 'call', 105, 100), stock()]).value).toBe(300);
});
it('renders a finite spread loss and never renders Unbounded on the dashboard card', () => {
  const source = readFileSync('webui/dashboard/app.js', 'utf8');
  const card = source.slice(source.indexOf('function netRiskCapitalCard('), source.indexOf('function explanationScope('));
  const render = runInNewContext(`${card}\nnetRiskCapitalCard`, {
    window: context, reportingCcyCode: () => 'USD', fmtPrettyMoney: (n: number) => `$${n}`,
    metricCardHtml: (label: string, value: string, note: string, help: string) => ({ label, value, note, help }),
  });
  const view = (positions: any[]) => ({ positions, reportingCurrency: 'USD' });
  expect(render(view([leg('short', 'put', 95, -300), leg('long', 'put', 90, 100)])).value).toBe('$300');
  expect(render(view([leg('short', 'call', 100, -300), stock()])).value).toBe('$0');
  const uncovered = render(view([leg('short', 'call', 100, -300)]));
  expect(uncovered.value).toBe('—');
  expect(JSON.stringify(uncovered)).not.toMatch(/unbounded/i);
  expect(uncovered.note).toContain('no finite maximum');
});
it('bounds a cash-secured put, long option and credit vertical using signed costs', () => {
  expect(risk([leg('short', 'put', 100, -300)]).value).toBe(9700);
  expect(risk([leg('long', 'call', 100, 300)]).value).toBe(300);
  expect(risk([leg('short', 'put', 100, -300), leg('long', 'put', 90, 100)]).value).toBe(800);
});
it('recognizes call spreads and unbounded net short calls', () => {
  expect(risk([leg('short', 'call', 100, -300), leg('long', 'call', 110, 100)]).value).toBe(800);
  expect(risk([leg('short', 'call', 100, -300)]).unbounded).toBe(true);
});
it('offsets protective legs whose underlying is reported as a verified broker contract code', () => {
  const short = leg('short', 'call', 100, -300);
  const long = leg('long', 'call', 105, 100);
  for (const underlying of ['AAPL 261120C00105000', 'aapl261120c105000', ' aapl ']) {
    expect(risk([short, { ...long, option: { ...long.option, underlying } }]).value).toBe(300);
  }
  // Mismatched terms must not turn an unrelated contract into protection.
  const mismatch = { ...long, option: { ...long.option, underlying: 'AAPL 261120C00110000' } };
  expect(risk([short, mismatch]).value).toBeNull();
  expect(risk([short, { ...long, channel: 'other-account' }]).unbounded).toBe(true);
});
it('does not offset contracts across broker accounts or expiries', () => {
  expect(risk([leg('short', 'put', 100, -300), leg('long', 'put', 90, 100, { channel: 'tiger' })]).value).toBe(9800);
  const other = leg('long', 'call', 110, 100); other.option.expiry = '2026-12-18';
  expect(risk([leg('short', 'call', 100, -300), other]).unbounded).toBe(true);
});
it('converts strike payoffs once, preserves converted cost, and rejects missing FX', () => {
  expect(risk([leg('short', 'put', 100, -600, { currency: 'SGD' })], { fxRates: { SGD: 2 } }).value).toBe(19400);
  expect(risk([leg('short', 'put', 100, -600, { currency: 'SGD' })]).value).toBeNull();
  expect(risk([], { navComplete: false }).value).toBeNull();
  expect(risk([]).value).toBe(0);
});
