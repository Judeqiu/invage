import { afterEach, beforeEach, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addBrokerSource, addBrokerAccount, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { createPortfolioProjectionRefresher } from '../src/state/portfolio-projections.js';
import { readPortfolioProjection } from '../src/state/projection-store.js';
import { buildDashboardModel, buildLivePositions } from '../src/report/dashboard-model.js';
import { buildExecutionJournal, type OptionExecution } from '../src/brokers/option-executions.js';
import { buildRecordedOptionAnalytics } from '../src/webapp/option-analytics.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import type { DashboardPayload } from '../src/webapp/dashboard-data.js';
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'broker-projections-')); process.env.UTARUS_DATA_ROOT = root; });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function fixture() {
  const state: InvestorState = { user: { id: '00000000-0000-4000-8000-000000000055', slug: 'broker-test', created_at: '2026-01-01' },
    profile: { display_name: 'Broker test', contact_email: 'test@example.com' }, log: [] };
  const ib = addBrokerSource(state, 'ibkr', { token: 'test' });
  const moo = addBrokerSource(state, 'moomoo', { app_key: 'test', private_key: String(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })) });
  const ids = [
    addBrokerAccount(state, { source_id: ib, account_id: 'IB1', label: 'Retirement', config: { activity_query_id: '1' } }),
    addBrokerAccount(state, { source_id: ib, account_id: 'IB2', label: 'Savings', config: { activity_query_id: '1' } }),
    addBrokerAccount(state, { source_id: moo, account_id: 'MOO1', label: 'Main', config: {} }),
  ];
  const channels = ids.map(id => readBrokerAccountModel(state).connections[id].channel);
  state.portfolio = Object.fromEntries(channels.map((channel, i) => [`AAPL@${channel}`, {
    units: [10, 20, 5][i], avg_price: [10, 5, 10][i], currency: i === 1 ? 'SGD' : 'USD', channel,
  }]));
  state.portfolio['AAPL@manual'] = { units: 1, avg_price: 1, currency: 'USD', channel: 'manual' };
  state.cash = channels.map((channel, i) => ({ channel, amount: [100, 200, 50][i], currency: i === 1 ? 'SGD' : 'USD', updated_at: '2026-10-23' }));
  state.deposits = [{ id: 'deposit', channel: channels[1], amount: 100, interest: 0, currency: 'SGD', start_date: '2026-01-01', end_date: '2027-01-01' }];
  const cycle = (channel: string, account_id: string, premium: string, cost: string): OptionExecution[] => {
    const base = { channel, account_id, contract_id: 'AAPL-put', underlying: 'AAPL', right: 'put' as const,
      expiry: '2026-10-30', strike: '100', multiplier: '100', contracts: '1', currency: 'USD', commission: '-1' };
    return [{ ...base, execution_id: 'open', executed_at: '2026-10-23T10:00:00', side: 'sell', effect: 'open', gross_premium: premium },
      { ...base, execution_id: 'close', executed_at: '2026-10-23T11:00:00', side: 'buy', effect: 'close', gross_premium: cost }];
  };
  state.option_executions = [...cycle(channels[0], 'IB1', '100', '-40'), ...cycle(channels[2], 'MOO1', '500', '-100')];
  const refresh = createPortfolioProjectionRefresher({
    loadInvestor: async () => ({ state: structuredClone(state), revision: 1 }),
    loadDashboardForSlug: async (): Promise<DashboardPayload> => {
      const live = buildLivePositions(state.portfolio!, { AAPL: 20 }, {}, state.cash, state.deposits, '2026-10-23',
        { reportingCurrency: 'USD', fxRates: { SGD: 0.75 } }, { allowEmpty: true, resilient: true, reportingCurrency: 'USD' });
      const journal = buildExecutionJournal(state.option_executions);
      return { slug: state.user.id, displayName: 'Broker test', generatedAt: '2026-10-23T12:00:00Z', empty: false,
        model: buildDashboardModel(live, []), benchmark: null, productProfile: 'full', productName: 'Test',
        premiumJournal: { available: journal.available, daily: journal.daily, channels },
        optionAnalytics: buildRecordedOptionAnalytics(state.option_executions),
        brokerAsOf: Object.fromEntries(channels.map(channel => [channel, '2026-10-23'])) };
    },
  });
  return { state, channels, refresh, ib };
}
it('persists separate broker rollups, combines same-broker accounts, and preserves account and currency boundaries', async () => {
  const f = fixture();
  await f.refresh(f.state.user.id);
  const saved = readPortfolioProjection(f.state)!;
  expect(Object.keys(saved.brokers).sort()).toEqual(['ibkr', 'moomoo']);
  const ib = saved.brokers.ibkr, moo = saved.brokers.moomoo;
  expect(ib.nav).toBe(825);
  expect(ib.dashboard.model!.live.totalValue).toBe(825);
  expect(ib.dashboard.model!.live.positions.every(row => row.channel !== f.channels[2])).toBe(true);
  expect(moo.nav).toBe(150);
  expect(ib.channels).toEqual(f.channels.slice(0, 2).sort());
  expect(ib.totals).toMatchObject({ totalValue: 825, positionsValue: 500, totalCost: 175, totalPL: 325, cashAmount: 250, depositsAmount: 75, navComplete: true });
  expect(moo.totals).toMatchObject({ totalValue: 150, cashAmount: 50, positionsValue: 100, navComplete: true });
  expect(ib.totals!.byChannel.reduce((sum, row) => sum + row.totalValue, 0)).toBe(ib.totals!.totalValue);
  expect(ib.totals!.positions.every(row => f.channels.slice(0, 2).includes(row.channel))).toBe(true);
  expect((ib.pages.positions.all as any).totals.value).toBe(500);
  expect((ib.pages.insights.all as any).nav).toBe(825);
  const scope = ib.scopes.live.merged as any;
  expect(scope.premium.total).toBe(60);
  expect(scope.realized[''].value).toBe(58);
  expect((moo.scopes.live.merged as any).premium.total).toBe(400);
  expect((moo.scopes.live.merged as any).realized[''].value).toBe(398);
  expect((ib.trades.history.all.totals[0] as any).pnl).toBe(58);
  expect(ib.journal.executions.every(row => row.account_id === 'IB1')).toBe(true);
  const directory = join(root, 'derived/portfolio');
  expect(JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8')).brokers.ibkr.totals.totalValue).toBe(825);
});
it('includes new accounts automatically and marks unrecorded cash or account totals incomplete', async () => {
  const f = fixture();
  await f.refresh(f.state.user.id);
  const id = addBrokerAccount(f.state, { source_id: f.ib, account_id: 'IB3', label: 'New', config: { activity_query_id: '1' } });
  expect(readPortfolioProjection(f.state)).toBeNull();
  await f.refresh(f.state.user.id);
  const saved = readPortfolioProjection(f.state)!;
  expect(saved.brokers.ibkr.channels).toContain(readBrokerAccountModel(f.state).connections[id].channel);
  expect(saved.brokers.ibkr.totals!.navComplete).toBe(false);
  expect(saved.brokers.ibkr.nav).toBeNull();
  expect(saved.brokers.ibkr.totals!.issues.some(issue => issue.code === 'broker_nav_incomplete')).toBe(true);
  f.state.cash = (f.state.cash as any[]).filter(row => row.channel !== f.channels[1]);
  await f.refresh(f.state.user.id);
  expect(readPortfolioProjection(f.state)!.brokers.ibkr.totals).toMatchObject({ navComplete: false, cashAmount: null });
});

it('rebuilds older generations that did not persist broker rollups', async () => {
  const f = fixture();
  await f.refresh(f.state.user.id);
  const directory = join(root, 'derived/portfolio');
  const file = join(directory, readdirSync(directory)[0]);
  const prior = JSON.parse(readFileSync(file, 'utf8'));
  prior.version = 1;
  delete prior.brokers;
  writeFileSync(file, JSON.stringify(prior));
  expect(readPortfolioProjection(f.state)).toBeNull();
  await f.refresh(f.state.user.id);
  expect(readPortfolioProjection(f.state)!.brokers.ibkr.totals!.totalValue).toBe(825);
});
