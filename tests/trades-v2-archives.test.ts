import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tradesFixture } from './helpers/trades-fixture.js';
import { recordBrokerSyncRun } from '../src/brokers/sync-history.js';
import { optionHistoryForState } from '../src/webapp/option-history-data.js';
import { buildOptionIdentityIndex } from '../src/brokers/option-identities.js';
import { tradesHistory } from '../src/webapp/trades-v2-data.js';
it('backfills IDs for archive-only options and includes explicit archived lifecycle events without rewriting evidence', () => {
  const state = tradesFixture(); state.portfolio = {}; delete state.option_executions;
  const owner = state.user.id, dir = join(process.env.UTARUS_DATA_ROOT!,'drive',owner,'broker-sync','ibkr');
  mkdirSync(dir,{recursive:true});
  for (const [date,present] of [['2026-10-01',true],['2026-10-04',false]] as const) {
    const row = present ? '<OpenPosition accountId="U1" currency="USD" assetCategory="OPT" symbol="AAPL  270115P00150000" underlyingSymbol="AAPL" conid="123" quantity="-1" multiplier="100" strike="150" expiry="20270115" putCall="P" costBasisMoney="500" markPrice="2"/>' : '';
    const event = present ? '' : '<OptionEAEList><OptionEAE accountId="U1" assetCategory="OPT" tradeID="assignment-1" conid="123" underlyingSymbol="AAPL" putCall="P" strike="150" expiry="20270115" multiplier="100" date="20261003" transactionType="Assignment" quantity="1" currency="USD"/></OptionEAEList>';
    writeFileSync(join(dir,date+'.xml'),`<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" fromDate="${date.replaceAll('-','')}" toDate="${date.replaceAll('-','')}"><OpenPositions>${row}</OpenPositions><CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport>${event}</FlexStatement></FlexStatements></FlexQueryResponse>`);
    recordBrokerSyncRun(owner,'ibkr',{at:date+'T12:00:00Z',trigger:'scheduled',ok:true,account_id:'U1',as_of:date,raw_data_id:`broker-sync/ibkr/${date}.xml`});
  }
  const before = structuredClone(state), evidence = optionHistoryForState(state);
  expect(evidence.gaps).toEqual([]);
  expect(evidence.events[0]).toMatchObject({id:'assignment-1',kind:'assignment'});
  const enriched = {...state,option_observations:evidence.observations,option_events:evidence.events};
  const index = buildOptionIdentityIndex(enriched);
  expect(Object.keys(index.options)).toHaveLength(1);
  expect(buildOptionIdentityIndex({...enriched,option_identities:index})).toEqual(index);
  expect(tradesHistory(enriched).rows).toHaveLength(1);
  expect(tradesHistory(enriched).rows[0]).toMatchObject({status:'Assigned',entryDate:null,contracts:'1',realizedPnl:null});
  expect(state).toEqual(before);
});
