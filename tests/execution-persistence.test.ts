import { expect, it } from 'vitest';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';
import { loadInvestor } from '../src/state/investor-store.js';
import { importOptionExecutions } from '../src/brokers/import-executions.js';
import { applyBrokerStatement } from '../src/brokers/apply-statement.js';
import { mapFlexDocToStatement } from '../src/ibkr/flex-map.js';
import { parseFlexQueryXml } from '../src/ibkr/flex-parse.js';

await useTestDatabase();
const xml = `<FlexStatement accountId="U1" fromDate="20260909" toDate="20260909"><OpenPositions/><CashReport><CashReportCurrency currency="USD" endingCash="193400"/></CashReport><Trades><Trade accountId="U1" levelOfDetail="EXECUTION" assetCategory="OPT" tradeID="1" conid="123" dateTime="20260909;103015" buySell="SELL" openCloseIndicator="O" quantity="-2" multiplier="100" underlyingSymbol="PATH" putCall="C" strike="20" expiry="20270319" currency="USD" proceeds="5140.00" ibCommission="-1.23456789" ibCommissionCurrency="USD"/></Trades></FlexStatement>`;

it('persists historical executions in PostgreSQL and retains them after closing the snapshot position', async () => {
  await createInvestorFixture({
    user: { id: '00000000-0000-4000-8000-000000000061', slug: 'execution-test', created_at: '2026-09-09', telegram_user_ids: [], auth_token: '00000000-0000-4000-8000-000000000062' },
    profile: { display_name: 'Execution Test', contact_email: 'execution@example.com' }, log: [],
    cash: { amount: 193400, currency: 'USD', channel: 'ibkr', updated_at: '2026-09-09' },
    portfolio: { 'PATH@ibkr': { units: 10, avg_price: 12, channel: 'ibkr' } },
  });
  await importOptionExecutions(await loadInvestor('execution-test'), xml);
  let saved = await loadInvestor('execution-test');
  expect(saved.state.portfolio?.['PATH@ibkr'].units).toBe(10);
  expect(saved.state.option_executions?.[0].commission).toBe('-1.23456789');
  await applyBrokerStatement(saved, 'ibkr', mapFlexDocToStatement(parseFlexQueryXml(xml), 'ibkr'));
  saved = await loadInvestor('execution-test');
  expect(saved.state.portfolio).toEqual({});
  expect(saved.state.option_executions).toHaveLength(1);
  const noTrades = xml.replace(/<Trades>[\s\S]*<\/Trades>/, '');
  await applyBrokerStatement(saved, 'ibkr', mapFlexDocToStatement(parseFlexQueryXml(noTrades), 'ibkr'));
  expect((await loadInvestor('execution-test')).state.option_executions).toHaveLength(1);
});
