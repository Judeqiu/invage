/** Recover terminal single-leg option cash from a retained, account-bound Webull archive.
 * Run with the host's verified environment and absolute UTARUS_DATA_ROOT.
 * node --import tsx scripts/repair-webull-history.mjs <user> <channel> <raw-id> [--apply]
 * Dry run by default. Never fetches the broker or replaces holdings/cash/history checkpoints.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

process.env.UTARUS_LOADED_BY_HOST = '1';
const [user, channel, rawId, ...flags] = process.argv.slice(2);
if (!user || !channel || !rawId || flags.some(flag => flag !== '--apply')) {
  throw new Error('Usage: repair-webull-history.mjs <user> <channel> <raw-id> [--apply]');
}
if (!process.env.UTARUS_DATA_ROOT?.startsWith('/')) throw new Error('An absolute host UTARUS_DATA_ROOT is required');
const database = await openDatabaseRuntime({env:process.env, mode:'personal', onError:error => {throw error;}});
const release = bindDatabaseRuntime(database);
try {
  const { resolveDataRoot } = await import('utarus');
  const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.ts');
  const { readBrokerAccountModel } = await import('../src/brokers/accounts.ts');
  const { brokerRawDataFile, fetchRawData } = await import('../src/raw-data/store.ts');
  const { mapWebullOptionHistory } = await import('../src/webull/webull-executions.ts');
  const { mergeOptionExecutions, addDecimals, buildExecutionJournal } = await import('../src/brokers/option-executions.ts');
  const { buildOptionIdentityIndex } = await import('../src/brokers/option-identities.ts');
  const { portfolioFingerprint, readPortfolioProjection, writePortfolioProjection } = await import('../src/state/projection-store.ts');
  const snapshot = await loadInvestor(user);
  const connection = Object.values(readBrokerAccountModel(snapshot.state).connections)
    .find(c => c.channel === channel && c.broker_id === 'webull');
  if (!connection?.account_id) throw new Error('The selected channel is not an account-bound Webull connection');
  const file = brokerRawDataFile(snapshot.state.user.id, channel, rawId);
  if (!file || file.source_kind !== 'broker-sync') throw new Error('Select a retained broker-sync archive in this Webull channel');
  const chunks = [];
  for (let offset = 0;;) {
    const page = fetchRawData(snapshot.state.user.id, file.id, file.version, offset, 65536, 'base64');
    chunks.push(Buffer.from(page.content, 'base64'));
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  const bytes = Buffer.concat(chunks);
  const raw = JSON.parse(bytes.toString('utf8'));
  if (raw.schema !== 'invage.webull.raw.v1' || raw.account_id !== connection.account_id || raw.history_error || !raw.option_history) {
    throw new Error('Archive schema, account binding or historical retrieval is invalid');
  }
  const incoming = mapWebullOptionHistory(raw, [], channel);
  const before = snapshot.state.option_executions ?? [];
  const merged = mergeOptionExecutions(before, incoming);
  const owns = row => row.channel === channel && row.account_id === connection.account_id;
  if (!isDeepStrictEqual(before.filter(row => !owns(row)), merged.filter(row => !owns(row)))) {
    throw new Error('Repair would change unrelated account records');
  }
  const monthly = records => Object.fromEntries([...new Set(records.filter(owns).map(row => row.executed_at.slice(0, 7)))].sort()
    .map(month => [month, addDecimals(...records.filter(row => owns(row) && row.executed_at.startsWith(month)).map(row => row.gross_premium))]));
  const changed = !isDeepStrictEqual(mergeOptionExecutions([], before), merged);
  // Calculate against the saved valuation evidence while old services run.
  // No market refresh, snapshot replacement or daily-history reset is involved.
  let prepared;
  if (changed) {
    const prior = readPortfolioProjection(snapshot.state);
    if (!prior) throw new Error('A valid saved portfolio projection is required before this repair');
    const { prepareOptionRelationships } = await import('../src/webapp/option-relationships-data.ts');
    const { openOptionTradeDetails, attachLatestRollPremium, attachOpenVerticalSpreads } = await import('../src/webapp/option-dashboard-data.ts');
    const { buildRecordedOptionAnalytics } = await import('../src/webapp/option-analytics.ts');
    const { optionHistoryForState } = await import('../src/webapp/option-history-data.ts');
    const { tradesOpenBook, tradesHistory } = await import('../src/webapp/trades-v2-data.ts');
    const { buildPageProjections, buildTradeProjections } = await import('../src/report/page-projections.ts');
    const { buildBrokerProjections } = await import('../src/report/broker-projections.ts');
    const { attachDailyChanges } = await import('../src/report/daily-changes.ts');
    const projectedState = {...snapshot.state, option_executions:merged};
    projectedState.option_identities = buildOptionIdentityIndex(projectedState);
    const relationships = await prepareOptionRelationships(projectedState);
    const journal = buildExecutionJournal(merged);
    const dashboard = structuredClone(prior.dashboard);
    dashboard.premiumJournal = {available:journal.available, daily:journal.daily,
      channels:[...new Set(merged.map(row => row.channel))]};
    dashboard.optionAnalytics = buildRecordedOptionAnalytics(merged, projectedState.option_events);
    const accounts = Object.fromEntries(Object.values(readBrokerAccountModel(projectedState).connections)
      .filter(c => c.account_id).map(c => [c.channel,c.account_id]));
    dashboard.optionTradeDetails = openOptionTradeDetails(projectedState.portfolio ?? {}, merged, accounts, projectedState.option_events);
    const links = relationships.groups.flatMap(group => group.relationships);
    attachLatestRollPremium(projectedState.portfolio ?? {}, dashboard.optionTradeDetails, links, accounts);
    attachOpenVerticalSpreads(projectedState.portfolio ?? {}, dashboard.optionTradeDetails, relationships.spreads, accounts);
    dashboard.optionHistoryGaps = relationships.historyGaps;
    const conflicts = new Set(relationships.historyGaps.filter(gap => gap.blocksTotals).map(gap => gap.channel));
    for (const key of Object.keys(dashboard.optionTradeDetails)) if (conflicts.has(projectedState.portfolio[key].channel)) delete dashboard.optionTradeDetails[key];
    const optionHistory = optionHistoryForState(projectedState);
    const tradeHistory = tradesHistory({...projectedState, option_observations:optionHistory.observations,
      option_events:optionHistory.events}, links);
    for (const row of tradeHistory.rows) if (conflicts.has(row.channel)) {
      row.premium = row.netCash = row.realizedPnl = row.returnsPct = null;
      row.notes.push('Conflicting archived execution evidence needs reconciliation. Cash and profit figures are withheld.');
    }
    const openTrades = tradesOpenBook(projectedState);
    const pages = buildPageProjections(dashboard);
    dashboard.pageProjections = {positions:pages.positions, insights:pages.insights};
    dashboard.aggregatedViews = pages.dashboard;
    prepared = {...prior, fingerprint:portfolioFingerprint(projectedState), calculatedAt:new Date().toISOString(),
      dashboard, journal, relationships, optionHistory,
      openTrades:{...openTrades, aggregates:buildTradeProjections(openTrades.rows)},
      tradeHistory:{...tradeHistory, aggregates:buildTradeProjections(tradeHistory.rows,true),
        gaps:[...optionHistory.gaps,...relationships.historyGaps]},
      brokers:buildBrokerProjections(projectedState,dashboard,openTrades.rows,tradeHistory.rows)};
    attachDailyChanges(prepared, prior.dailyAggregateHistory ?? {});
    for (const [broker, projection] of Object.entries(prior.brokers)) {
      if (broker === 'webull') continue;
      if (!isDeepStrictEqual(projection.journal, prepared.brokers[broker]?.journal) ||
          !isDeepStrictEqual(projection.totals, prepared.brokers[broker]?.totals)) {
        throw new Error(`Repair would change unrelated ${broker} valuation or journal`);
      }
      prepared.brokers[broker] = projection;
    }
  }
  const receipt = {user_id:snapshot.state.user.id, channel, account_id:connection.account_id,
    source:{id:file.id, version:file.version, sha256:createHash('sha256').update(bytes).digest('hex')},
    source_revision:snapshot.revision, apply:flags.includes('--apply'), changed,
    before_count:before.filter(owns).length, after_count:merged.filter(owns).length,
    before_months:monthly(before), after_months:monthly(merged),
    unknown_effects:merged.filter(row => owns(row) && row.effect === 'unknown').length,
    unknown_fees:merged.filter(row => owns(row) && row.commission === null).length};
  if (flags.includes('--apply') && changed) {
    const directory = join(resolveDataRoot(), 'repairs', 'webull-history', randomUUID());
    mkdirSync(directory, {recursive:true, mode:0o700});
    writeFileSync(join(directory, 'before.json'), JSON.stringify({revision:snapshot.revision,
      option_executions:before, option_identities:snapshot.state.option_identities}), {mode:0o600, flag:'wx'});
    // Re-read the immutable source version before the optimistic database save.
    fetchRawData(snapshot.state.user.id, file.id, file.version, 0, 4, 'base64');
    const preserved = structuredClone({portfolio:snapshot.state.portfolio, cash:snapshot.state.cash, broker_history:snapshot.state.broker_history});
    writeFileSync(join(directory, 'prepared-projection.json'), JSON.stringify(prepared), {mode:0o600, flag:'wx'});
    snapshot.state.option_executions = merged;
    snapshot.state.log.push({ts:new Date().toISOString().slice(0,10), action:'webull_order_cash_repair',
      reason:'Restore approved terminal single-leg cumulative order cash independently of current holdings; USD for omitted US-option currency; missing intent and fee evidence stay unknown.',
      channel, raw_data_id:file.id, source_sha256:receipt.source.sha256});
    await saveInvestor(snapshot);
    const actual = await loadInvestor(user);
    if (!isDeepStrictEqual(preserved, {portfolio:actual.state.portfolio, cash:actual.state.cash, broker_history:actual.state.broker_history}) ||
        !isDeepStrictEqual(merged, actual.state.option_executions)) {
      throw new Error('State changed concurrently after repair; inspect the saved revision before continuing');
    }
    receipt.saved_revision = actual.revision;
    if (portfolioFingerprint(actual.state) !== prepared.fingerprint) throw new Error('Projection source changed; retain the staged generation for review');
    const current = readPortfolioProjection(actual.state);
    // A background worker may already have installed a newer valid generation.
    if (!current || current.calculatedAt < prepared.calculatedAt) writePortfolioProjection(prepared);
    receipt.projection_ready = Boolean(readPortfolioProjection(actual.state));
    receipt.backup = directory;
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), {mode:0o600, flag:'wx'});
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await (await import('../src/books/db.ts')).closePool();
  release();
  await database.close();
}
