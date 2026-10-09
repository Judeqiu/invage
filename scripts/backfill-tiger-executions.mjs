/** Tiger history repair. Run with the service's environment and `node --import tsx`.
 * Usage: node --import tsx scripts/backfill-tiger-executions.mjs <user> [--apply] [--sync]
 * Default is read-only; --apply archives evidence and merges executions.
 * Add --sync to apply the matching Tiger positions/cash snapshot as well. Optimistic revisions prevent concurrent overwrites.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

process.env.UTARUS_LOADED_BY_HOST = '1';
const args = process.argv.slice(2);
const user = args[0];
if (!user || args.slice(1).some(arg => !['--apply', '--sync'].includes(arg))) throw new Error('Usage: backfill-tiger-executions.mjs <user> [--apply] [--sync]');
const database = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
const release = bindDatabaseRuntime(database);
try {
  const { resolveDataRoot } = await import('utarus');
  const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.ts');
  const { readBrokerAccountModel, combinedCredentials } = await import('../src/brokers/accounts.ts');
  const { fetchTigerRawBundle } = await import('../src/tiger/tiger-client.ts');
  const { mapTigerBundleToStatement } = await import('../src/tiger/tiger-map.ts');
  const { mergeOptionLifecycleEvents } = await import('../src/brokers/option-events.ts');
  const { applyBrokerStatement } = await import('../src/brokers/apply-statement.ts');
  const { recordBrokerSyncRun } = await import('../src/brokers/sync-history.ts');
  const { buildHoldingKey } = await import('../src/market/position-value.ts');
  const { persistBrokerAccountModel } = await import('../src/brokers/accounts.ts');
  const { formatBrokerSkip } = await import('../src/brokers/statement.ts');
  const { randomUUID } = await import('node:crypto');
  const { mergeOptionExecutions } = await import('../src/brokers/option-executions.ts');
  const { openOptionTradeDetails } = await import('../src/webapp/option-dashboard-data.ts');
  const snapshot = await loadInvestor(user);
  const model = readBrokerAccountModel(snapshot.state);
  let merged = snapshot.state.option_executions ?? [];
  let events = snapshot.state.option_events ?? [];
  const sync = args.includes('--sync');
  const projected = { ...(snapshot.state.portfolio ?? {}) };
  const evidence = [];
  const accounts = {};
  for (const [id, connection] of Object.entries(model.connections)) {
    if (connection.broker_id !== 'tiger' || !connection.enabled || !connection.account_id) continue;
    const credentials = combinedCredentials(model, connection);
    const raw = await fetchTigerRawBundle(credentials);
    if (raw.account !== connection.account_id) throw new Error('Tiger history account differs from the connection');
    const statement = mapTigerBundleToStatement(raw, connection.channel);
    merged = mergeOptionExecutions(merged, statement.option_executions ?? []);
    events = mergeOptionLifecycleEvents(events, statement.option_events ?? []);
    if (sync) {
      for (const [key, holding] of Object.entries(projected)) if (holding.channel === connection.channel) delete projected[key];
      for (const lot of statement.lots) projected[buildHoldingKey(lot.ticker, connection.channel)] = lot.holding;
    }
    accounts[connection.channel] = connection.account_id;
    evidence.push({ id, connection, raw, statement });
  }
  if (!evidence.length) throw new Error('No enabled Tiger account found');
  const portfolio = sync ? projected : snapshot.state.portfolio ?? {};
  const details = openOptionTradeDetails(portfolio, merged, accounts, events);
  const options = Object.entries(portfolio).filter(([, h]) => accounts[h.channel] && h.instrument === 'option');
  const verified = options.filter(([key]) => details[key]);
  const added = merged.length - (snapshot.state.option_executions?.length ?? 0);
  console.log(JSON.stringify({ user, apply: args.includes('--apply'), added,
    open_options: options.length, matched_options: verified.length,
    net_credits: verified.filter(([key]) => details[key].stoNetPremium !== null).length,
    before_fees: verified.filter(([key]) => details[key].stoGrossPremium != null).length,
    unknown_options: options.filter(([key]) => !details[key]).map(([key]) => key) }));
  if (args.includes('--apply') && (added > 0 || sync)) {
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const dir = join(resolveDataRoot(), 'drive', snapshot.state.user.id, 'broker-sync', 'tiger');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${stamp}-before.json`), JSON.stringify({ executions: snapshot.state.option_executions ?? [], events: snapshot.state.option_events ?? [], portfolio: snapshot.state.portfolio, cash: snapshot.state.cash }), { mode: 0o600, flag: 'wx' });
    for (const { id, raw } of evidence) writeFileSync(join(dir, `${stamp}-${id}.json`), JSON.stringify(raw), { mode: 0o600, flag: 'wx' });
    if (sync) {
      persistBrokerAccountModel(snapshot.state, model);
      for (const { id, connection, raw, statement } of evidence) {
        const at = new Date().toISOString();
        const syncId = randomUUID();
        const rawDataId = `broker-sync/tiger/${stamp}-${id}.json`;
        const result = await applyBrokerStatement(snapshot, id, statement, Buffer.from(JSON.stringify(raw)), result => {
          const current = readBrokerAccountModel(snapshot.state);
          current.connections[id].last_sync = { at, ok: true, as_of: result.asOf, account_id: result.accountId,
            lots_upserted: result.lotsUpserted, lots_removed: result.lotsRemoved,
            ...(result.skipped.length ? { not_imported: result.skipped.map(formatBrokerSkip) } : {}) };
          persistBrokerAccountModel(snapshot.state, current);
        }, { brokerId: 'tiger', channel: connection.channel }, { syncId, observedAt: at, rawDataId });
        recordBrokerSyncRun(snapshot.state.user.id, connection.channel, { id: syncId, at, trigger: 'manual', ok: true,
          as_of: result.asOf, account_id: result.accountId, lots_upserted: result.lotsUpserted, lots_removed: result.lotsRemoved, raw_data_id: rawDataId });
      }
    } else {
      snapshot.state.option_executions = merged;
      snapshot.state.option_events = events;
      snapshot.state.log.push({ ts: new Date().toISOString().slice(0, 10), action: 'tiger_execution_backfill',
        reason: 'Operator requested historical opening fills to populate option dashboard dates and gross credits; single-contract fees include GST; combo fees remain unallocated.',
        execution_count: added });
      await saveInvestor(snapshot);
    }
    console.log('Tiger history saved; holdings and cash refreshed only with --sync.');
  }
} finally {
  release();
  await database.close();
}
