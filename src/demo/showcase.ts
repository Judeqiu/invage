/** User-approved fictional portfolio. Never copies customer or broker records. */
import type { InvestorState } from '../state/portfolio-state.js';
import type { DashboardPayload } from '../webapp/dashboard-data.js';
import type { OptionExecution } from '../brokers/option-executions.js';
import { buildExecutionJournal, mergeOptionExecutions } from '../brokers/option-executions.js';
import { buildDashboardModel, buildLivePositions } from '../report/dashboard-model.js';
import { buildRecordedOptionAnalytics } from '../webapp/option-analytics.js';
import { openOptionTradeDetails } from '../webapp/option-dashboard-data.js';
import { demoWorkbookForState, workbookDashboard } from './workbook.js';

export const DEMO_EMAIL = 'demo@velovest.ai';
export const DEMO_NAME = 'Velovest Demo — Synthetic Data';
const asOf = '2026-11-03T08:00:00Z';
const prices = { 'DEMO-A': 120, 'DEMO-B': 85 };
export function seedSyntheticPortfolio(state: InvestorState): void {
  if (state.profile.contact_email !== DEMO_EMAIL || Object.keys(state.portfolio ?? {}).length ||
      Object.keys(state.broker_connections ?? {}).length || state.option_executions?.length) {
    throw new Error('Seed only the empty, explicitly designated demo account.');
  }
  state.profile.display_name = DEMO_NAME;
  state.synthetic_demo = { version: 1 };
  state.portfolio = {
    'DEMO-A@demo-a': { instrument: 'equity', units: 200, avg_price: 100, currency: 'USD', channel: 'demo-a' },
  };
  const executions: OptionExecution[] = [];
  const add = (id: string, underlying: string, channel: string, right: 'put' | 'call', side: 'long' | 'short', strike: number, expiry: string, units: number, premium: number, mark: number) => {
    state.portfolio![id] = { instrument: 'option', units, avg_price: premium, currency: 'USD', channel,
      option: { underlying, right, side, strike, expiry, multiplier: 100, mark, quote_source: 'manual', settlement: 'physical', underlying_mark: prices[underlying as keyof typeof prices] } };
    executions.push({ channel, account_id: channel, execution_id: 'synthetic:' + id, contract_id: id,
      executed_at: '2026-10-15T10:00:00', underlying, right, expiry, strike: String(strike), multiplier: '100',
      contracts: String(units), side: side === 'short' ? 'sell' : 'buy', effect: 'open', currency: 'USD',
      gross_premium: String(units * premium * (side === 'short' ? 1 : -1)), commission: '-2' });
  };
  add('DEMO-A-CALL', 'DEMO-A', 'demo-a', 'call', 'short', 130, '2026-12-18', 2, 250, 100);
  add('DEMO-B-PUT', 'DEMO-B', 'demo-b', 'put', 'short', 80, '2027-02-19', 2, 300, 150);
  add('DEMO-B-PROTECTION', 'DEMO-B', 'demo-b', 'put', 'long', 70, '2027-02-19', 2, 50, 30);
  add('DEMO-A-PUT', 'DEMO-A', 'demo-a', 'put', 'short', 110, '2026-11-20', 1, 200, 80);
  for (const year of [2025, 2026]) for (let month = 1; month <= (year === 2026 ? 10 : 12); month++) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const base: OptionExecution = { channel: 'demo-a', account_id: 'demo-a', execution_id: `synthetic:${ym}:open`,
      contract_id: `SYNTHETIC-${ym}`, executed_at: `${ym}-05T10:00:00`, underlying: 'DEMO-A', right: 'put',
      expiry: `${ym}-21`, strike: '90', multiplier: '100', contracts: '1', side: 'sell', effect: 'open', currency: 'USD', gross_premium: '200', commission: '-1' };
    executions.push(base, { ...base, execution_id: `synthetic:${ym}:close`, executed_at: `${ym}-15T10:00:00`, side: 'buy', effect: 'close', gross_premium: '-50' });
  }
  state.option_executions = mergeOptionExecutions([], executions);
  state.cash = [{ amount: 25000, currency: 'USD', channel: 'demo-a', updated_at: '2026-11-03' },
    { amount: 15000, currency: 'USD', channel: 'demo-b', updated_at: '2026-11-03' }];
  state.log.push({ ts: '2026-11-03', action: 'synthetic_demo_seeded', reason: 'User-approved fictional showcase; no customer data or broker connections.' });
}
export function isSyntheticDemo(state: InvestorState): boolean {
  return state.profile.contact_email === DEMO_EMAIL && state.synthetic_demo?.version === 1;
}
export function syntheticDashboard(state: InvestorState): DashboardPayload {
  if (!isSyntheticDemo(state)) throw new Error('Not the synthetic demo account');
  if (demoWorkbookForState(state)) return workbookDashboard(state);
  const cash = Array.isArray(state.cash) ? state.cash : state.cash ? [state.cash] : [];
  const live = buildLivePositions(state.portfolio ?? {}, prices, undefined, cash, null, '2026-11-03', undefined, { reportingCurrency: 'USD' });
  for (const position of live.positions) if (position.option) position.brokerMark = position.option.mark;
  const journal = buildExecutionJournal(state.option_executions);
  const channels = [...new Set((state.option_executions ?? []).map(row => row.channel))];
  return { slug: state.user.id, displayName: DEMO_NAME, generatedAt: asOf, empty: false,
    model: buildDashboardModel(live, []), benchmark: null, equityPrices: prices,
    optionTradeDetails: openOptionTradeDetails(state.portfolio ?? {}, state.option_executions),
    premiumJournal: { available: true, daily: journal.daily, channels },
    premiumSupportedChannels: channels, optionAnalytics: buildRecordedOptionAnalytics(state.option_executions),
    productProfile: 'consultant', productName: 'Velovest',
    warnings: [{ code: 'synthetic_demo', severity: 'warning', message: 'Fictional demonstration data. Prices and trades are synthetic and fixed at 3 November 2026. No broker accounts are connected.' }] };
}
