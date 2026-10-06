/** One-time v4 portfolio projection → opening books, with broker currency evidence. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { resolveDataRoot } from 'utarus';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

const mode = process.argv[2];
if (!['plan', 'apply', 'verify'].includes(mode)) {
  throw new Error('Usage: node --env-file=<protected-env> scripts/books-bootstrap-v4.mjs plan|apply|verify');
}
if (!process.env.UTARUS_DATABASE_URL || (mode !== 'plan' && !process.env.INVAGE_BOOKS_DATABASE_URL)) {
  throw new Error('UTARUS_DATABASE_URL is required; apply/verify also require INVAGE_BOOKS_DATABASE_URL.');
}
process.env.UTARUS_LOADED_BY_HOST = '1';
const runtime = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError(error) { throw error; } });
const release = bindDatabaseRuntime(runtime);
const users = new pg.Pool({ connectionString: process.env.UTARUS_DATABASE_URL, max: 1 });

try {
  const { loadInvestor } = await import('../src/state/investor-store.js');
  const { getCashes, getDeposits, getPortfolio } = await import('../src/state/portfolio-state.js');
  const { buildHoldingKey } = await import('../src/market/position-value.js');
  const { readBrokerAccountModel } = await import('../src/brokers/accounts.js');
  const { getBrokerAdapter } = await import('../src/brokers/adapter.js');
  const { listRawData } = await import('../src/raw-data/store.js');
  const books = mode === 'plan' ? null : await import('../src/books/index.js');
  const { toMinor } = await import('../src/books/money.js');
  const rows = await users.query('SELECT slug FROM utarus.users WHERE deleted_at IS NULL ORDER BY slug');
  const summary = { mode, users: 0, cashSlots: 0, deposits: 0, brokerPositions: 0,
    legacyPositions: 0, journalEntries: 0, sources: [] };
  for (const { slug } of rows.rows) {
    const { state } = await loadInvestor(slug);
    const portfolio = getPortfolio(state);
    const model = readBrokerAccountModel(state);
    const positionSources = {};
    const connectedChannels = new Set();
    for (const [connectionId, conn] of Object.entries(model.connections)) {
      connectedChannels.add(conn.channel);
      const wanted = Object.entries(portfolio).filter(([, h]) => h.channel === conn.channel);
      if (wanted.length === 0) continue;
      const archives = [];
      for (let offset = 0;;) {
        const page = listRawData(slug, offset, 100, conn.channel);
        archives.push(...page.files.filter(f => f.source_kind === 'broker-sync'));
        if (page.next_offset === null) break;
        offset = page.next_offset;
      }
      let matched = null;
      for (const file of archives) {
        const raw = readFileSync(join(resolveDataRoot(), 'drive', slug, file.id));
        let statement;
        try {
          statement = getBrokerAdapter(conn.broker_id).parseToStatement(
            { kind: conn.broker_id === 'ibkr' ? 'xml' : 'json', body: raw }, conn.channel);
        } catch { continue; }
        if (conn.account_id && statement.account_id !== conn.account_id) continue;
        const lots = new Map(statement.lots.map(lot => [buildHoldingKey(lot.ticker, conn.channel), lot]));
        if (lots.size !== wanted.length || wanted.some(([key, h]) => {
          const lot = lots.get(key);
          return !lot || h.units !== lot.holding.units ||
            toMinor(h.avg_price * h.units) !== toMinor(lot.holding.avg_price * lot.holding.units);
        })) continue;
        matched = { file, raw, lots };
        break;
      }
      if (!matched) throw new Error(`${slug}/${connectionId}: no single archived broker statement exactly matches every current position; refusing currency guess.`);
      const hash = createHash('sha256').update(matched.raw).digest('hex');
      for (const [key] of wanted) {
        const currency = matched.lots.get(key).currency;
        if (portfolio[key].currency && portfolio[key].currency !== currency) {
          throw new Error(`${slug}/${connectionId}/${key}: stored currency conflicts with broker archive.`);
        }
        portfolio[key].currency = currency;
        positionSources[key] = `broker-archive:${conn.broker_id}:${matched.file.id}:sha256:${hash}`;
      }
      summary.brokerPositions += wanted.length;
      summary.sources.push({ slug, connectionId, broker: conn.broker_id,
        channel: conn.channel, positions: wanted.length, archive: matched.file.id });
    }
    for (const [key, holding] of Object.entries(portfolio)) {
      if (connectedChannels.has(holding.channel)) continue;
      if (holding.currency == null) holding.currency = 'USD'; // legacy manual portfolio was USD-notional
      summary.legacyPositions++;
      if (!Number.isFinite(holding.avg_price * holding.units)) throw new Error(`${slug}/${key}: invalid legacy cost.`);
    }
    const expectedCash = getCashes(state).filter(row => toMinor(row.amount) !== 0n);
    const expectedDeposits = getDeposits(state);
    const expectedPositions = Object.entries(portfolio);
    summary.users++;
    summary.cashSlots += expectedCash.length;
    summary.deposits += expectedDeposits.length;
    if (mode === 'plan') continue;
    if (mode === 'apply') {
      const exists = await books.withHouseholdTx(state.user.id, async client => {
        const found = await client.query('SELECT 1 FROM households WHERE id=$1::uuid', [state.user.id]);
        return found.rowCount !== 0;
      });
      if (exists) throw new Error(`Refusing opening import: ${slug} already has a books household.`);
      await books.booksImportState(state, { positionSources });
    }
    await books.withHouseholdTx(state.user.id, async client => {
      const household = await client.query('SELECT 1 FROM households WHERE id=$1::uuid', [state.user.id]);
      if (household.rowCount !== 1) throw new Error(`Missing books household for ${slug}`);
      const cash = await client.query(
        `SELECT a.channel, a.currency, b.balance_minor::text AS amount
         FROM accounts a JOIN account_balances b ON b.account_id = a.id
         WHERE a.household_id=$1::uuid AND a.kind='cash' AND b.balance_minor<>0`, [state.user.id]);
      const actualCash = cash.rows.map(r => `${r.channel}|${r.currency}|${r.amount}`).sort();
      const wantedCash = expectedCash.map(r => `${r.channel ?? ''}|${r.currency}|${toMinor(r.amount)}`).sort();
      if (JSON.stringify(actualCash) !== JSON.stringify(wantedCash)) throw new Error(`Cash opening mismatch for ${slug}`);
      const deposits = await client.query(
        `SELECT a.external_key, a.channel, a.currency, b.balance_minor::text AS amount,
                m.interest_minor::text AS interest, m.start_date::text, m.end_date::text
         FROM accounts a JOIN account_balances b ON b.account_id=a.id
         JOIN deposit_meta m ON m.account_id=a.id
         WHERE a.household_id=$1::uuid AND a.kind='deposit' AND b.balance_minor>0`, [state.user.id]);
      const actualDeposits = deposits.rows.map(r => `${r.external_key}|${r.channel}|${r.currency}|${r.amount}|${r.interest}|${r.start_date}|${r.end_date}`).sort();
      const wantedDeposits = expectedDeposits.map(r => `${r.id}|${r.channel ?? ''}|${r.currency}|${toMinor(r.amount)}|${toMinor(r.interest)}|${r.start_date}|${r.end_date}`).sort();
      if (JSON.stringify(actualDeposits) !== JSON.stringify(wantedDeposits)) throw new Error(`Deposit opening mismatch for ${slug}`);
      const positions = await client.query(
        `SELECT a.external_key, a.currency, b.balance_minor::text AS cost, b.quantity::text AS quantity
         FROM accounts a JOIN account_balances b ON b.account_id=a.id
         WHERE a.household_id=$1::uuid AND a.kind='position' AND b.quantity<>0`, [state.user.id]);
      const actualPositions = positions.rows.map(r => `${r.external_key}|${r.currency}|${r.cost}|${Number(r.quantity)}`).sort();
      const wantedPositions = expectedPositions.map(([key, h]) => {
        const signed = toMinor(h.avg_price * h.units) * (h.instrument === 'option' && h.option?.side === 'short' ? -1n : 1n);
        return `${key}|${h.currency ?? 'USD'}|${signed}|${h.units}`;
      }).sort();
      if (JSON.stringify(actualPositions) !== JSON.stringify(wantedPositions)) throw new Error(`Position opening mismatch for ${slug}`);
      const sourceCount = await client.query(
        `SELECT count(*)::int AS n FROM journal_entries WHERE household_id=$1::uuid AND external_ref LIKE 'broker-archive:%'`, [state.user.id]);
      if (Number(sourceCount.rows[0].n) !== Object.keys(positionSources).length) throw new Error(`Broker provenance mismatch for ${slug}`);
      const count = await client.query('SELECT count(*)::int AS n FROM journal_entries WHERE household_id=$1::uuid', [state.user.id]);
      summary.journalEntries += Number(count.rows[0].n);
    });
  }
  console.log(JSON.stringify(summary));
} finally {
  if (mode !== 'plan') {
    const { closePool } = await import('../src/books/db.js');
    await closePool();
  }
  await users.end();
  release();
  await runtime.close();
}
