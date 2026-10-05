import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel } from '../src/brokers/accounts.js';
import { recordBrokerSyncRun } from '../src/brokers/sync-history.js';
import { optionHistoryForState } from '../src/webapp/option-history-data.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'option-backfill-')); process.env.UTARUS_DATA_ROOT = root; });
afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.UTARUS_DATA_ROOT; });

function flex(date: string, option: boolean): string {
  const ymd = date.replaceAll('-', '');
  const row = option ? `<OpenPosition accountId="U1" currency="USD" assetCategory="OPT"
    symbol="AAPL  261120P00150000" underlyingSymbol="AAPL" conid="123"
    quantity="-1" multiplier="100" strike="150" expiry="20261120" putCall="P"
    costBasisMoney="500" markPrice="2" />` : '';
  return `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1"
    fromDate="${ymd}" toDate="${ymd}"><OpenPositions>${row}</OpenPositions>
    <CashReport><CashReportCurrency accountId="U1" currency="USD" endingCash="100"/></CashReport>
    </FlexStatement></FlexStatements></FlexQueryResponse>`;
}

it('reconstructs option presence and absence from successful IBKR raw archives', () => {
  const state: InvestorState = { user: { id: 'u1', slug: 'alice', created_at: '2026-01-01' },
    profile: { display_name: 'Alice', contact_email: 'a@example.com' }, log: [] };
  const source = addBrokerSource(state, 'ibkr', { token: 'secret1234' });
  const id = addBrokerAccount(state, { source_id: source, account_id: 'U1', label: 'Main',
    config: { activity_query_id: '111' } });
  const channel = readBrokerAccountModel(state).connections[id].channel;
  const dir = join(root, 'drive', 'alice', 'broker-sync', channel);
  mkdirSync(dir, { recursive: true });
  for (const [date, present] of [['2026-10-01', true], ['2026-10-04', false]] as const) {
    const name = `${date}.xml`;
    writeFileSync(join(dir, name), flex(date, present));
    recordBrokerSyncRun('alice', channel, { at: `${date}T12:00:00Z`, trigger: 'scheduled',
      ok: true, account_id: 'U1', as_of: date, raw_data_id: `broker-sync/${channel}/${name}` });
  }
  const result = optionHistoryForState(state, new Date('2026-10-05T00:00:00Z'));
  expect(result.gaps).toEqual([]);
  expect(result.episodes).toHaveLength(1);
  expect(result.episodes[0]).toMatchObject({ first_seen: '2026-10-01',
    last_seen_open: '2026-10-01', first_seen_absent: '2026-10-04', status: 'no_longer_observed' });
});
