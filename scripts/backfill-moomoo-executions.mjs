/** Execution-only repair. Run with the service's environment and `node --import tsx`.
 * Usage: node --import tsx scripts/backfill-moomoo-executions.mjs <user> [--apply]
 * Default is read-only; --apply archives evidence and merges executions without
 * replacing cash or holdings. Optimistic revisions prevent concurrent overwrites.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

process.env.UTARUS_LOADED_BY_HOST = '1';
const args = process.argv.slice(2);
const user = args[0];
if (!user || args.slice(1).some(arg => arg !== '--apply')) throw new Error('Usage: backfill-moomoo-executions.mjs <user> [--apply]');
const database = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
const release = bindDatabaseRuntime(database);
try {
  const { resolveDataRoot } = await import('utarus');
  const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.ts');
  const { readBrokerAccountModel, combinedCredentials } = await import('../src/brokers/accounts.ts');
  const { fetchMooMooRawBundle } = await import('../src/moomoo/moomoo-client.ts');
  const { parseSignAlg } = await import('../src/moomoo/moomoo-sign.ts');
  const { mapMooMooBundleToStatement } = await import('../src/moomoo/moomoo-map.ts');
  const { mergeOptionExecutions } = await import('../src/brokers/option-executions.ts');
  const { openOptionTradeDetails } = await import('../src/webapp/option-dashboard-data.ts');
  const snapshot = await loadInvestor(user);
  const model = readBrokerAccountModel(snapshot.state);
  let merged = snapshot.state.option_executions ?? [];
  const evidence = [];
  const accounts = {};
  for (const [id, connection] of Object.entries(model.connections)) {
    if (connection.broker_id !== 'moomoo' || !connection.enabled || !connection.account_id) continue;
    const credentials = combinedCredentials(model, connection);
    const raw = await fetchMooMooRawBundle({ ...credentials, sign_alg: parseSignAlg(credentials.sign_alg) });
    if (raw.acc_id !== connection.account_id) throw new Error('Moomoo history account differs from the connection');
    const statement = mapMooMooBundleToStatement(raw, connection.channel);
    merged = mergeOptionExecutions(merged, statement.option_executions ?? []);
    accounts[connection.channel] = connection.account_id;
    evidence.push({ id, connection, raw });
  }
  if (!evidence.length) throw new Error('No enabled Moomoo account found');
  const portfolio = snapshot.state.portfolio ?? {};
  const details = openOptionTradeDetails(portfolio, merged, accounts);
  const options = Object.entries(portfolio).filter(([, h]) => accounts[h.channel] && h.instrument === 'option');
  const verified = options.filter(([key]) => details[key]);
  const added = merged.length - (snapshot.state.option_executions?.length ?? 0);
  console.log(JSON.stringify({ user, apply: args.includes('--apply'), added,
    open_options: options.length, matched_options: verified.length,
    unknown_options: options.filter(([key]) => !details[key]).map(([key]) => key) }));
  if (args.includes('--apply') && added > 0) {
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const dir = join(resolveDataRoot(), 'drive', snapshot.state.user.id, 'moomoo-executions');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${stamp}-before.json`), JSON.stringify(snapshot.state.option_executions ?? []), { mode: 0o600, flag: 'wx' });
    for (const { id, raw } of evidence) writeFileSync(join(dir, `${stamp}-${id}.json`), JSON.stringify(raw), { mode: 0o600, flag: 'wx' });
    snapshot.state.option_executions = merged;
    snapshot.state.log.push({ ts: new Date().toISOString().slice(0, 10), action: 'moomoo_execution_backfill',
      reason: 'Operator requested historical opening fills to populate option dashboard dates and gross credits; fees remain unreported.',
      execution_count: added });
    await saveInvestor(snapshot);
    console.log('Execution history saved; cash and holdings retained.');
  }
} finally {
  release();
  await database.close();
}
