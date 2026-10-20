/** Additive option identity backfill. Run using the service environment.
 * node --import tsx scripts/migration/option-identities.mjs <user UUID or alias> [...] [--apply]
 * Default: read-only plan. Uses the same CAS repository and identity function as future imports.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';
process.env.UTARUS_LOADED_BY_HOST = '1';
const args = process.argv.slice(2), apply = args.includes('--apply');
const users = args.filter(a => a !== '--apply');
if (!users.length || users.some(a => a.startsWith('-'))) throw new Error('Usage: option-identities.mjs <user UUID or alias> [...] [--apply]');
const db = await openDatabaseRuntime({ env:process.env, mode:'personal', onError:error => { throw error; } });
const release = bindDatabaseRuntime(db);
try {
  const { loadInvestor, saveOptionJournalMetadata } = await import('../../src/state/investor-store.ts');
  const { buildOptionIdentityIndex } = await import('../../src/brokers/option-identities.ts');
  const { optionHistoryForState } = await import('../../src/webapp/option-history-data.ts');
  const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const seen = new Set();
  for (const user of users) {
    const snapshot = await loadInvestor(user);
    if (seen.has(snapshot.state.user.id)) continue;
    seen.add(snapshot.state.user.id);
    const history = optionHistoryForState(snapshot.state);
    const prior = snapshot.state.option_identities, next = buildOptionIdentityIndex({...snapshot.state,option_observations:history.observations,option_events:history.events});
    const changed = !isDeepStrictEqual(prior,next);
    const { option_identities, ...evidence } = snapshot.state;
    const before = hash(evidence), revision = snapshot.revision;
    if (apply && changed) {
      snapshot.state.option_identities = next;
      await saveOptionJournalMetadata(snapshot);
      const { option_identities: saved, ...after } = snapshot.state;
      if (hash(after) !== before) throw new Error('Unexpected non-identity state mutation');
    }
    console.log(JSON.stringify({ owner:snapshot.state.user.id, apply, changed,
      revision_before:revision, revision_after:snapshot.revision,
      options_before:Object.keys(prior?.options ?? {}).length, options_after:Object.keys(next.options).length,
      executions_before:Object.keys(prior?.executions ?? {}).length, executions_after:Object.keys(next.executions).length,
      archive_gaps:history.gaps.length,
      evidence_sha256:before }));
  }
} finally { release(); await db.close(); }
