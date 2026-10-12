import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTestDatabase, createInvestorFixture } from './helpers/database.js';

const db = await useTestDatabase({ books: true });
const root = mkdtempSync(join(tmpdir(), 'broker-books-pipeline-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = root;

const userId = randomUUID();
const slug = `broker-pipeline-${userId.slice(0, 8)}`;

function flex(date: string, shares: number, cost: number, cash: number): string {
  return `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U123" fromDate="${date}" toDate="${date}">
    <OpenPositions><OpenPosition accountId="U123" currency="SGD" assetCategory="STK" symbol="D05" quantity="${shares}" costBasisMoney="${cost}" markPrice="40" /></OpenPositions>
    <CashReport><CashReportCurrency accountId="U123" currency="SGD" endingCash="${cash}" /></CashReport>
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
}

describe('IBKR Flex → BrokerStatement → portfolio → books journal', () => {
  beforeAll(async () => {
    const { migrateBooks } = await import('../src/books/index.js');
    await migrateBooks();
    await createInvestorFixture({
      user: { id: userId, slug, created_at: '2026-10-01', auth_token: randomUUID() },
      profile: { display_name: 'Broker Pipeline', contact_email: 'broker-pipeline@test.local' },
      log: [{ ts: '2026-10-01', action: 'created' }],
    });
  });
  afterAll(async () => { rmSync(root, { recursive: true, force: true }); });

  it('posts source-linked opening entries, skips unchanged sync, and recovers after a state-save failure', async () => {
    const { parseFlexQueryXml } = await import('../src/ibkr/flex-parse.js');
    const { mapFlexDocToStatement } = await import('../src/ibkr/flex-map.js');
    const { applyBrokerStatement } = await import('../src/brokers/apply-statement.js');
    const { loadInvestor } = await import('../src/state/investor-store.js');
    const { getCashes, getPortfolio } = await import('../src/state/portfolio-state.js');
    const { booksListJournals, withHouseholdTx } = await import('../src/books/index.js');
    const apply = async (xml: string, beforeSave?: () => void) => {
      const parsed = parseFlexQueryXml(xml);
      const statement = mapFlexDocToStatement(parsed, 'ibkr');
      return applyBrokerStatement(await loadInvestor(slug), 'ibkr', statement, Buffer.from(xml), beforeSave);
    };

    const first = flex('20261002', 10, 300, 1000);
    await apply(first);
    let snapshot = await loadInvestor(slug);
    expect(getCashes(snapshot.state)).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'ibkr', currency: 'SGD', amount: 1000 }),
    ]));
    expect(Object.values(getPortfolio(snapshot.state))).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'ibkr', currency: 'SGD', units: 10, avg_price: 30 }),
    ]));
    expect(await booksListJournals(snapshot.state, 20)).toHaveLength(2);

    await apply(first);
    expect(await booksListJournals((await loadInvestor(slug)).state, 20)).toHaveLength(2);

    const changed = flex('20261003', 12, 360, 1100);
    await expect(apply(changed, () => { throw new Error('simulated state save failure'); }))
      .rejects.toThrow(/simulated state save failure/);
    snapshot = await loadInvestor(slug);
    expect(getCashes(snapshot.state).find(row => row.channel === 'ibkr')?.amount).toBe(1000);
    expect(await booksListJournals(snapshot.state, 20)).toHaveLength(5);

    await apply(changed);
    snapshot = await loadInvestor(slug);
    expect(getCashes(snapshot.state).find(row => row.channel === 'ibkr')?.amount).toBe(1100);
    expect(await booksListJournals(snapshot.state, 20)).toHaveLength(5);
    const rows = await withHouseholdTx(userId, client => client.query(
      `SELECT DISTINCT external_ref FROM journal_entries WHERE household_id=$1::uuid AND tool_name='broker_sync'`, [userId]));
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every(row => String(row.external_ref).startsWith('broker:ibkr:U123:'))).toBe(true);

    await expect(apply(first)).rejects.toThrow(/older than the current ibkr position date 2026-10-03/);
    expect(getCashes((await loadInvestor(slug)).state).find(row => row.channel === 'ibkr')?.amount).toBe(1100);
  });

  it('replays option evidence through jsonb without duplicating money or history records', async () => {
    const { applyBrokerStatement } = await import('../src/brokers/apply-statement.js');
    const { loadInvestor } = await import('../src/state/investor-store.js');
    const { booksListJournals } = await import('../src/books/index.js');
    const { getPortfolio, getCashes } = await import('../src/state/portfolio-state.js');
    const { mapFlexDocToStatement } = await import('../src/ibkr/flex-map.js');
    const { parseFlexQueryXml } = await import('../src/ibkr/flex-parse.js');
    const doc = mapFlexDocToStatement(parseFlexQueryXml(flex('20261004', 12, 360, 1100)), 'ibkr');
    doc.option_executions = [{ channel: 'ibkr', account_id: 'U123', execution_id: 'fill-1',
      contract_id: 'option-1', executed_at: '2026-10-02T09:30:00', underlying: 'AAPL',
      right: 'put', expiry: '2026-10-03', strike: '150', multiplier: '100', contracts: '1',
      side: 'sell', effect: 'open', currency: 'USD', gross_premium: '300', commission: '-1' }];
    doc.option_events = [{ id: 'assignment-1', broker_id: 'ibkr', channel: 'ibkr', account_id: 'U123',
      contract_id: 'option-1', underlying: 'AAPL', right: 'put', expiry: '2026-10-03',
      strike: '150', multiplier: '100', contracts: '1', date: '2026-10-03', kind: 'assignment',
      settlement: 'physical', currency: 'USD', source: 'ibkr_flex' }];
    const syncId = randomUUID();
    const apply = async (statement = doc, id = syncId, raw = 'first archive') =>
      applyBrokerStatement(await loadInvestor(slug), 'ibkr', statement, Buffer.from(raw),
        undefined, undefined, { syncId: id });
    await apply();
    const before = (await loadInvestor(slug)).state;
    const journals = await booksListJournals(before, 100);
    // Each replay reloads PostgreSQL jsonb, changes wire bytes, and reorders
    // fields. Financial evidence is identical despite transport differences.
    const reordered = JSON.parse(JSON.stringify(doc, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse()) : value));
    await apply(reordered, syncId, 'retry archive');
    await apply(reordered, randomUUID(), 'new fetch archive');
    const after = (await loadInvestor(slug)).state;
    expect(getPortfolio(after)).toEqual(getPortfolio(before));
    expect(getCashes(after)).toEqual(getCashes(before));
    expect(after.option_executions).toEqual(before.option_executions);
    expect(after.option_events).toEqual(before.option_events);
    expect(await booksListJournals(after, 100)).toEqual(journals);
    expect(after.option_observations?.filter(row => row.id === syncId)).toHaveLength(1);
    expect(after.option_observations).toHaveLength(before.option_observations!.length + 1);

    const conflict = structuredClone(doc);
    conflict.option_events![0].contracts = '2';
    conflict.cash[0].amount = 9999;
    await expect(apply(conflict)).rejects.toThrow(/differing fields: contracts/);
    expect((await loadInvestor(slug)).state).toEqual(after);
    expect(await booksListJournals(after, 100)).toEqual(journals);

    const changedObservation = structuredClone(doc);
    changedObservation.skipped = [{ kind: 'position', symbol: 'AAPL', reason: 'unavailable' }];
    changedObservation.cash[0].amount = 9999;
    await expect(apply(changedObservation)).rejects.toThrow(/observation conflict/);
    expect((await loadInvestor(slug)).state).toEqual(after);
    expect(await booksListJournals(after, 100)).toEqual(journals);
  });
});
