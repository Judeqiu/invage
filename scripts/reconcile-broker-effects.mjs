/** Reconcile every archived contract for an account; never edits holdings/cash.
 * node --import tsx scripts/reconcile-broker-effects.mjs <user> <connection> [--apply]
 * Run with the service environment. Default: read-only evidence report.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';
process.env.UTARUS_LOADED_BY_HOST = '1';
const [user, connectionId, flag] = process.argv.slice(2);
if (!user || !connectionId || flag && flag !== '--apply' || process.argv.length > 5) throw new Error('Usage: reconcile-broker-effects.mjs <user> <connection> [--apply]');
const db = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
const release = bindDatabaseRuntime(db);
try {
  const { resolveDataRoot } = await import('utarus');
  const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.ts');
  const { readBrokerAccountModel } = await import('../src/brokers/accounts.ts');
  const { getBrokerAdapter } = await import('../src/brokers/adapter.ts');
  const { mergeBrokerHistory, optionExecutionsFromHistory } = await import('../src/brokers/history.ts');
  const { mergeOptionExecutions } = await import('../src/brokers/option-executions.ts');
  const { optionObservationFromStatement } = await import('../src/brokers/option-history.ts');
  const { reconcileExecutionEffects } = await import('../src/brokers/execution-effects.ts');
  const snapshot = await loadInvestor(user), state = snapshot.state;
  const connection = readBrokerAccountModel(state).connections[connectionId];
  if (!connection?.account_id) throw new Error('Bound account required');
  const scope = { brokerId: connection.broker_id, channel: connection.channel, connectionId };
  const root = join(resolveDataRoot(), 'drive', state.user.id);
  const directory = join(root, 'broker-sync', connection.channel);
  const adapter = getBrokerAdapter(connection.broker_id);
  const observations = [...(state.option_observations ?? [])];
  const evidence = [], rejected = [], statements = [];
  for (const name of readdirSync(directory).sort()) {
    if (!/\.(json|xml)$/.test(name)) continue;
    const rawDataId = `broker-sync/${connection.channel}/${name}`;
    const body = readFileSync(join(directory, name));
    try {
      const statement = adapter.parseToStatement({ body, kind: name.endsWith('.xml') ? 'xml' : 'json' }, connection.channel);
      if (statement.account_id !== connection.account_id) throw new Error('Archive account mismatch');
      // Only a broker timestamp embedded in the immutable payload is an anchor;
      // a filename or filesystem mtime does not prove when positions were fetched.
      const raw = name.endsWith('.json') ? JSON.parse(body.toString()) : null;
      if (raw?.fetched_at && Number.isFinite(Date.parse(raw.fetched_at))) {
        observations.push(optionObservationFromStatement({ ...scope, statement, observedAt: raw.fetched_at,
          rawDataId, syncId: `archive:${createHash('sha256').update(body).digest('hex')}` }));
      }
      if (statement.history) statements.push(statement.history);
      evidence.push({ rawDataId, sha256: createHash('sha256').update(body).digest('hex') });
    } catch (error) { rejected.push({ rawDataId, error: error.message }); }
  }
  let history;
  const sources = [...statements, ...(state.broker_history?.[connection.channel] ? [state.broker_history[connection.channel]] : [])]
    .sort((a,b) => a.sync.through.localeCompare(b.sync.through));
  for (const source of sources) history = mergeBrokerHistory(history, source);
  if (!history) throw new Error('No broker execution evidence');
  const reconciled = reconcileExecutionEffects(history, observations, state.option_events ?? []);
  const changes = reconciled.executions.flatMap((row, i) => row.effect !== history.executions[i].effect ? [{ id: row.id, before: history.executions[i].effect, after: row.effect }] : []);
  const executions = mergeOptionExecutions(state.option_executions ?? [], optionExecutionsFromHistory(reconciled));
  const byId = new Map(executions.filter(e => e.channel === connection.channel && e.account_id === connection.account_id).map(e => [e.execution_id,e]));
  reconciled.executions = reconciled.executions.map(e => byId.has(e.id) ? { ...e, effect: byId.get(e.id).effect } : e);
  const unresolved = reconciled.executions.filter(e => e.instrument === 'option' && e.effect === 'unknown').map(e => e.id);
  console.log(JSON.stringify({ user: state.user.id, connectionId, apply: flag === '--apply', archives: evidence.length, rejected, changes, unresolved }));
  if (flag === '--apply') {
    const id = randomUUID(), dir = join(resolveDataRoot(), 'ops', 'broker-reconciliation', id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, 'before.json'), JSON.stringify({ revision: snapshot.revision, broker_history: state.broker_history,
      option_executions: state.option_executions, option_observations: state.option_observations }), { flag: 'wx', mode: 0o600 });
    writeFileSync(join(dir, 'evidence.json'), JSON.stringify({ scope, evidence, rejected, changes, unresolved }), { flag: 'wx', mode: 0o600 });
    state.broker_history = { ...state.broker_history, [connection.channel]: reconciled };
    state.option_executions = executions;
    // Preserve old observation IDs; archive content hashes deduplicate repeated repairs.
    state.option_observations = [...new Map(observations.map(o => [o.id, o])).values()];
    state.log.push({ ts: new Date().toISOString().slice(0,10), action: 'broker_effects_reconciled',
      connector_id: connectionId, account_id: connection.account_id, reason: 'Reconciled contract quantities between archived broker position snapshots using retained execution evidence.',
      evidence_id: id, classified: changes.length, unresolved: unresolved.length });
    await saveInvestor(snapshot);
    console.log(JSON.stringify({ saved: true, evidenceDirectory: dir }));
  }
} finally { release(); await db.close(); }
