import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { optionRelationshipsForState } from '../src/webapp/option-relationships-data.js';
import { createDashboardApiRouter } from '../src/webapp/dashboard-api.js';
import { loadInvestor } from '../src/state/investor-store.js';

vi.mock('../src/state/investor-store.js', () => ({ loadInvestor: vi.fn(), saveInvestor: vi.fn() }));
const owner = '00000000-0000-4000-8000-000000000071';
const other = '00000000-0000-4000-8000-000000000072';
let root: string, state: InvestorState;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'roll-api-')); process.env.UTARUS_DATA_ROOT = root;
  state = { user: { id: owner, slug: 'owner', created_at: '2026-01-01' }, profile: { display_name: 'Owner', contact_email: 'test@example.com' }, log: [] };
  const s = addBrokerSource(state, 'ibkr', { token: 'test-token' });
  addBrokerAccount(state, { source_id: s, account_id: 'A', label: 'Main', config: { activity_query_id: '1' } });
  vi.mocked(loadInvestor).mockImplementation(async user => { if (user !== owner) throw new Error('Wrong tenant'); return { state, revision: 0 }; });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.clearAllMocks(); });
function archive(user: string, date = '20261001', price = '30') {
  const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const dir = join(root, 'drive', user, 'broker-sync', channel); mkdirSync(dir, { recursive: true });
  const row = (id: string, expiry: string, side: string, effect: string, cash: string) => `<Trade accountId="A" assetCategory="OPT" levelOfDetail="EXECUTION" transactionType="ExchTrade" tradeID="${id}" ibOrderID="${id}" brokerageOrderID="p${date}" ibExecID="a.b.02.01" dateTime="${date};100000" underlyingSymbol="AMD" putCall="C" expiry="${expiry}" strike="200" multiplier="100" currency="USD" ibCommissionCurrency="USD" quantity="${side === 'SELL' ? '-' : ''}1" buySell="${side}" openCloseIndicator="${effect}" netCash="${cash}"/>`;
  writeFileSync(join(dir, `${date}.xml`), `<FlexStatement accountId="A"><Trades>${row(`c${date}`, '20261120', 'BUY', 'C', '-10')}${row(`o${date}`, '20270115', 'SELL', 'O', price)}</Trades></FlexStatement>`);
}
function app(auth = true) {
  const app = express(); if (auth) app.use((req, _res, next) => { Object.assign(req, { user: { userId: owner } }); next(); });
  app.use(createDashboardApiRouter()); return app;
}
it('reads only the authenticated tenant and deduplicates source records', async () => {
  archive(owner); archive(other, '20261002', '999');
  const response = await request(app()).get('/option-relationships');
  expect(response.status).toBe(200); expect(loadInvestor).toHaveBeenCalledWith(owner);
  expect(response.body.total).toBe(1); expect(response.body.groups[0].relationships[0].cash).toBe('20');
  expect(response.headers['cache-control']).toBe('private, no-store');
});
it('requires authentication and validates filters before loading state', async () => {
  expect((await request(app(false)).get('/option-relationships')).status).toBe(401);
  for (const query of ['limit=0', 'offset=-1', 'evidence=confirmed', 'from=2026-02-30', 'as_of=tomorrow', 'from=2026-10-03&to=2026-10-01', 'q[]=AMD']) {
    expect((await request(app()).get(`/option-relationships?${query}`)).status).toBe(400);
  }
  expect(loadInvestor).not.toHaveBeenCalled();
});
it('filters future relationships from dated replay and paginates matching groups', async () => {
  archive(owner); archive(owner, '20261002');
  expect(optionRelationshipsForState(state, { asOf: '2026-09-30' }).groups).toEqual([]);
  const page = await request(app()).get('/option-relationships?as_of=2026-10-01&limit=1');
  expect(page.body.total).toBe(1); expect(page.body.next_offset).toBeNull();
  const first = await request(app()).get('/option-relationships?limit=1');
  expect(first.body.total).toBe(2); expect(first.body.next_offset).toBe(1);
  const second = await request(app()).get('/option-relationships?limit=1&offset=1');
  expect(second.body.groups[0].id).not.toBe(first.body.groups[0].id);
});
it('shows empty and malformed archive coverage without inventing zero trading', () => {
  expect(optionRelationshipsForState(state).gaps[0].reason).toContain('No usable');
  archive(owner); const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  writeFileSync(join(root, 'drive', owner, 'broker-sync', channel, 'bad.xml'), '<not-valid');
  const result = optionRelationshipsForState(state); expect(result.groups).toHaveLength(1); expect(result.gaps.some(g => g.source?.endsWith('bad.xml'))).toBe(true);
});
it('withholds earlier relationships when a newer archive contains corrections needing reconciliation', () => {
  archive(owner); const channel = Object.values(readBrokerAccountModel(state).connections)[0].channel;
  const dir = join(root, 'drive', owner, 'broker-sync', channel);
  const original = readFileSync(join(dir, '20261001.xml'), 'utf8');
  writeFileSync(join(dir, 'correction.xml'), original.replace('tradeID="c20261001"', 'origTradeID="older" tradeID="c20261001"'));
  const result = optionRelationshipsForState(state);
  expect(result.groups).toEqual([]);
  expect(result.gaps.some(g => g.reason.includes('withheld'))).toBe(true);
});
