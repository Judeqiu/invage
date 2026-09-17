import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { type InvestorSnapshot } from '../src/state/investor-store.js';

const mocks = vi.hoisted(() => ({ save: vi.fn(), load: vi.fn(), session: vi.fn(), target: vi.fn() }));
vi.mock('../src/state/investor-store.js', () => ({ saveInvestor: mocks.save, loadInvestor: mocks.load }));
vi.mock('utarus', async importOriginal => ({ ...await importOriginal<object>(), loadSessionState: mocks.session, targetSlug: mocks.target }));

const { importOptionExecutions } = await import('../src/brokers/import-executions.js');
const { createBrokerConnectionsRouter } = await import('../src/webapp/broker-api.js');
const { createDashboardApiRouter } = await import('../src/webapp/dashboard-api.js');
const { parseFlexQueryXml } = await import('../src/ibkr/flex-parse.js');
const { mapFlexDocToStatement } = await import('../src/ibkr/flex-map.js');
const { applyBrokerStatement } = await import('../src/brokers/apply-statement.js');
const xml = `<FlexQueryResponse><FlexStatement accountId="U1" fromDate="20260909" toDate="20260909"><OpenPositions/><CashReport><CashReportCurrency currency="USD" endingCash="100"/></CashReport><Trades><Trade accountId="U1" levelOfDetail="EXECUTION" assetCategory="OPT" tradeID="1" conid="123" dateTime="20260909;103015" buySell="SELL" openCloseIndicator="O" quantity="-2" multiplier="100" underlyingSymbol="PATH" putCall="C" strike="20" expiry="20270319" currency="USD" proceeds="5140.00" ibCommission="-1.23456789" ibCommissionCurrency="USD"/></Trades></FlexStatement></FlexQueryResponse>`;
let snapshot: InvestorSnapshot;
beforeEach(() => {
  vi.clearAllMocks();
  snapshot = { revision: 4, state: { user: { id: 'u', slug: 'alice', created_at: '2026-01-01', telegram_user_ids: [], auth_token: 'token' }, profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [], cash: { amount: 193400, currency: 'USD' }, portfolio: { PATH: { units: 10, avg_price: 12 } } } };
  mocks.session.mockResolvedValue(snapshot);
  mocks.load.mockResolvedValue(snapshot);
  mocks.target.mockResolvedValue('alice');
});

it('imports old history without replacing cash or positions; repeat upload is idempotent', async () => {
  const portfolio = structuredClone(snapshot.state.portfolio);
  const cash = structuredClone(snapshot.state.cash);
  expect((await importOptionExecutions(snapshot, xml)).added).toBe(1);
  expect((await importOptionExecutions(snapshot, xml)).added).toBe(0);
  expect(snapshot.state.portfolio).toEqual(portfolio);
  expect(snapshot.state.cash).toEqual(cash);
  expect(mocks.save).toHaveBeenCalledWith(snapshot);
});

it('aborts a conflicting sync before changing the holdings snapshot', async () => {
  await importOptionExecutions(snapshot, xml);
  const before = structuredClone(snapshot);
  mocks.save.mockClear();
  const doc = mapFlexDocToStatement(parseFlexQueryXml(xml.replace('5140.00', '8008.00')), 'ibkr');
  await expect(applyBrokerStatement(snapshot, 'ibkr', doc)).rejects.toThrow(/conflict/i);
  expect(snapshot).toEqual(before);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('normal Flex parsing maps execution history into the canonical statement', () => {
  const doc = mapFlexDocToStatement(parseFlexQueryXml(xml), 'ibkr');
  expect(doc.option_executions?.[0].commission).toBe('-1.23456789');
});

function app(authenticated = true) {
  const a = express();
  a.use((req, _res, next) => { if (authenticated) Object.assign(req, { user: { slug: 'alice' } }); next(); });
  a.use(createDashboardApiRouter());
  a.use(createBrokerConnectionsRouter());
  return a;
}

it('requires authentication for reads and historical uploads', async () => {
  expect((await request(app(false)).get('/trades')).status).toBe(401);
  expect((await request(app(false)).post('/trades/import').type('application/xml').send(xml)).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('uploads for the session user and returns exact money through the API', async () => {
  const result = await request(app()).post('/trades/import').type('application/xml').send(xml);
  expect(result.status).toBe(200);
  expect(result.body.executions[0].net_premium).toBe('5138.76543211');
  expect(mocks.session).toHaveBeenCalledOnce();
  const read = await request(app()).get('/trades');
  expect(read.body.executions[0].commission).toBe('-1.23456789');
  expect(mocks.load).toHaveBeenCalledWith('alice');
});

it('returns an explicit unavailable state and rejects invalid uploads without saving', async () => {
  expect((await request(app()).get('/trades')).body.available).toBe(false);
  expect((await request(app()).post('/trades/import').type('application/xml').send('invalid XML')).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
