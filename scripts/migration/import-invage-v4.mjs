/** Offline, transactional migration for Invage's inspected beta.42 personal layout. */
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseDocument, visit, isScalar, isAlias } from 'yaml';
import { createDatabasePool, readDatabaseConfig, createSecretCodec, assertDatabaseReady, UserRepository, UsageRepository, withTransaction } from 'utarus/database';
import { DemoModeRepository } from '../../node_modules/utarus/dist/database/repositories/demo-mode.js';
import { readHistoricalInvites } from '../../node_modules/utarus/dist/database/historical-invites.js';
import { recomputeCreditsFromRaw } from '../../node_modules/utarus/dist/usage/credit-rates.js';
import { INVAGE_CREDIT_RATES } from '../../dist/credit-rates.js';

import { importInvitesInTransaction } from './legacy-invites.mjs';

const POLICY = 'invage-beta42-personal-to-v4-1';
const TARGET = '4.0.0-beta.13';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function requireValue(ok, message) { if (!ok) throw new Error(message); }
export function decodeYaml(bytes) {
  const doc = parseDocument(bytes.toString('utf8'), { uniqueKeys: true });
  requireValue(doc.errors.length === 0 && doc.warnings.length === 0, 'Invalid source YAML');
  visit(doc, {
    Map(_key, node) {
      const keys = new Set();
      for (const pair of node.items) {
        const key = isAlias(pair.key) ? pair.key.resolve(doc) : pair.key;
        requireValue(isScalar(key) && typeof key.value === 'string' && !keys.has(key.value), 'Invalid source mapping key');
        keys.add(key.value);
      }
    },
    Scalar(_key, node) {
      if (typeof node.value === 'number') requireValue(Number.isFinite(node.value) && !Object.is(node.value, -0) && (!Number.isInteger(node.value) || Number.isSafeInteger(node.value)), 'Source numeric precision would be lost');
    },
  });
  return doc.toJS({ maxAliasCount: 100 });
}
export function normalizeUsage(source) {
  requireValue(source.version === 1 || source.version === 3, 'Unsupported source usage version');
  if (source.version === 3) return structuredClone(source);
  requireValue(!Object.hasOwn(source, 'period_credits') && !Object.hasOwn(source, 'lifetime_credits'), 'Ambiguous legacy usage credits');
  // Same raw-counter conversion used by v3 readUsageState. Preserve all original
  // telemetry (including video), unknown fields, periods and both timestamps.
  const result = { ...structuredClone(source), version: 3 };
  for (const scope of ['period', 'lifetime']) {
    const counters = source[`${scope}_llm`];
    requireValue(counters && Number.isSafeInteger(counters.total_tokens) && Number.isSafeInteger(counters.cache_read), 'Missing source LLM counters');
    result[`${scope}_credits`] = recomputeCreditsFromRaw(counters, source[`${scope}_tools`], source[`${scope}_llm_by_profile`], INVAGE_CREDIT_RATES);
    requireValue(Number.isSafeInteger(result[`${scope}_credits`]), 'Converted credits require safe integers');
  }
  return result;
}
export function inventory(root) {
  requireValue(isAbsolute(root), 'Snapshot root must be absolute');
  const files = [];
  const retained = new Set(['chats', 'sessions', 'drive', 'reports', 'kb', 'backups']);
  const imported = new Set(['invites.yaml', 'demo_mode.yaml']);
  const invalidated = new Set(['.sessions.json', '.link-tokens.json', '.telegram-link-codes.json']);
  function walk(dir, relative) {
    for (const name of readdirSync(dir).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const absolute = join(dir, name);
      const stat = lstatSync(absolute);
      requireValue(!stat.isSymbolicLink(), 'Snapshot contains a symlink');
      if (stat.isDirectory()) { walk(absolute, path); continue; }
      requireValue(stat.isFile(), 'Snapshot contains a nonordinary file');
      const [family, leaf, ...extra] = path.split('/');
      let disposition;
      if ((family === 'users' || family === 'usage') && leaf?.endsWith('.yaml') && extra.length === 0) disposition = 'imported';
      else if (imported.has(path)) disposition = 'imported';
      else if (invalidated.has(path)) disposition = 'invalidated';
      else if (retained.has(family) || path === 'onboard_tokens.yaml') disposition = 'retained';
      else if (path === 'share-links.json') {
        const shares = JSON.parse(readFileSync(absolute, 'utf8'));
        requireValue(shares && !Array.isArray(shares) && Object.keys(shares).length === 0, 'Nonempty legacy shares require an adapter');
        disposition = 'retained';
      } else throw new Error(`Unsupported source family: ${family}`);
      requireValue(!path.split('/').includes('_utarus'), 'Widget artifacts require a separate migration adapter');
      files.push({ path, disposition, bytes: stat.size, sha256: hash(readFileSync(absolute)) });
    }
  }
  walk(root, '');
  return files;
}
function equal(actual, expected, family) { requireValue(isDeepStrictEqual(actual, expected), `${family} reconciliation failed`); }
export async function migrate(root, importId, sourceVersion) {
  requireValue(sourceVersion === '3.0.0-beta.42', 'Unexpected source release');
  requireValue(importId && /^[a-zA-Z0-9_-]+$/.test(importId), 'Explicit safe import identity required');
  const pkg = JSON.parse(readFileSync(new URL('../../node_modules/utarus/package.json', import.meta.url), 'utf8'));
  requireValue(pkg.version === TARGET, 'Migration must run with its verified target release');
  const files = inventory(root);
  const manifest = { policy: POLICY, sourceVersion, targetVersion: TARGET, creditRates: INVAGE_CREDIT_RATES, files };
  const manifestSha256 = hash(JSON.stringify(manifest));
  const users = files.filter(f => f.path.startsWith('users/')).map(f => {
    const state = decodeYaml(readFileSync(join(root, f.path)));
    requireValue(f.path === `users/${state.user.slug}.yaml`, 'User identity does not match its path');
    return state;
  });
  requireValue(users.length > 0, 'Snapshot has no users');
  const usageSources = files.filter(f => f.path.startsWith('usage/')).map(f => {
    const state = decodeYaml(readFileSync(join(root, f.path)));
    requireValue(f.path === `usage/${state.user_slug}.yaml`, 'Usage ownership does not match path');
    return state;
  });
  equal(users.map(u => u.user.slug).sort(), usageSources.map(u => u.user_slug).sort(), 'Usage coverage');
  const usage = usageSources.map(normalizeUsage);
  const invites = decodeYaml(readFileSync(join(root, 'invites.yaml')));
  const demo = decodeYaml(readFileSync(join(root, 'demo_mode.yaml')));
  const codec = createSecretCodec({ keyId: process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID, keyBase64: process.env.UTARUS_DATABASE_ENCRYPTION_KEY });
  const pool = createDatabasePool(readDatabaseConfig(process.env), error => { throw error; });
  try {
    await assertDatabaseReady(pool, 'personal', codec);
    return await withTransaction(pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('invage-v4-import'))");
      const prior = await client.query('SELECT manifest_sha256,report FROM utarus.historical_imports WHERE import_id=$1', [importId]);
      if (prior.rowCount) {
        requireValue(prior.rows[0].manifest_sha256 === manifestSha256, 'Import identity source/policy mismatch');
        equal(inventory(root), files, 'Source stability');
        return { ...prior.rows[0].report, applied: false };
      }
      const existing = await client.query('SELECT count(*)::int AS count FROM utarus.users');
      requireValue(existing.rows[0].count === 0, 'Import requires an empty user target');
      const userRepo = new UserRepository(pool, codec);
      const usageRepo = new UsageRepository(pool);
      const demoRepo = new DemoModeRepository(pool);
      for (const state of users) await userRepo.createInTransaction(client, state);
      for (const state of usage) await usageRepo.createInTransaction(client, state);
      await importInvitesInTransaction(client, codec, invites);
      const demoBefore = await demoRepo.readInTransaction(client);
      await demoRepo.saveInTransaction(client, demo, demoBefore.revision);
      for (const state of users) equal((await userRepo.readInTransaction(client, state.user.slug)).state, state, 'Full user/domain/credential');
      for (const state of usage) {
        const actual = await client.query('SELECT state,opening_state FROM utarus.usage_accounts JOIN utarus.users ON users.id=user_id WHERE slug=$1', [state.user_slug]);
        requireValue(actual.rowCount === 1, 'Usage account missing');
        equal(actual.rows[0].state, state, 'Usage');
        equal(actual.rows[0].opening_state, state, 'Opening usage');
      }
      equal(await readHistoricalInvites(client, codec, invites), invites, 'Invitations');
      equal((await demoRepo.readInTransaction(client)).state, demo, 'Demo settings');
      equal(inventory(root), files, 'Source stability');
      const report = { applied: true, policy: POLICY, manifestSha256, users: users.length, usage: usage.length,
        convertedV1Usage: usageSources.filter(s => s.version === 1).length, invites: invites.length,
        retainedFiles: files.filter(f => f.disposition === 'retained').length,
        invalidatedFiles: files.filter(f => f.disposition === 'invalidated').length,
        domainReconciliation: 'Complete user documents including all custom fields, credentials and logs matched',
        usageConversion: 'v1 raw-counter conversion with recorded rates; timestamps and all original telemetry retained; v3 unchanged' };
      await client.query('INSERT INTO utarus.historical_imports(import_id,manifest_sha256,manifest,report) VALUES($1,$2,$3,$4)', [importId, manifestSha256, manifest, report]);
      return report;
    });
  } finally { await pool.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, id, version] = process.argv.slice(2);
  try { console.log(JSON.stringify(await migrate(root, id, version), null, 2)); }
  catch (error) { console.error(`[Migration failed] ${error instanceof Error ? error.message : 'Unknown failure'}`); process.exitCode = 1; }
}
