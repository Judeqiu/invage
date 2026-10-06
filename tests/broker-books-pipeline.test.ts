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
  });
});
