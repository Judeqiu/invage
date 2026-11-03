/** Provision the explicitly approved fictional showcase, using existing account APIs.
 * Run from a clean committed export with its dependencies available.
 * node --import tsx scripts/seed-showcase.mjs <absolute-data-root> <env-file>...
 * stdin: {"password":"..."}. Never prints or persists the password.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import dotenv from 'dotenv';
const [dataRoot, ...envFiles] = process.argv.slice(2);
if (!dataRoot || !isAbsolute(dataRoot) || !envFiles.length || !envFiles.every(isAbsolute)) throw Error('Explicit data root and verified environment files required');
for (const file of envFiles) Object.assign(process.env, dotenv.parse(readFileSync(file)));
process.env.UTARUS_DATA_ROOT = dataRoot;
process.env.UTARUS_LOADED_BY_HOST = '1';
let text = ''; for await (const part of process.stdin) text += part;
const { password } = JSON.parse(text);
if (typeof password !== 'string' || !password) throw Error('Password must be supplied through stdin');
const { readAccountConfiguration } = await import('../src/accounts.ts');
const deployment = readAccountConfiguration(process.env);
const { configureSharedAccountRuntime, getSharedAccountClient } = await import('../node_modules/utarus/dist/accounts/shared-runtime.js');
await configureSharedAccountRuntime(deployment);
const { openDatabaseRuntime, bindDatabaseRuntime } = await import('utarus/database');
const database = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: e => { throw e; } });
const release = bindDatabaseRuntime(database);
try {
  const { blankState, hashPassword, getAccountAuthority } = await import('utarus');
  const { DEMO_EMAIL, DEMO_NAME, seedSyntheticPortfolio } = await import('../src/demo/showcase.ts');
  const authority = getAccountAuthority();
  if (await authority.users.findByEmail(DEMO_EMAIL)) throw Error('Demo account already exists. Refusing to overwrite it or reset its password.');
  const state = blankState({ displayName: DEMO_NAME, contactEmail: DEMO_EMAIL, language: 'en' });
  seedSyntheticPortfolio(state);
  const shared = getSharedAccountClient();
  if (shared) await shared.register({ localUserId: state.user.id, email: DEMO_EMAIL, password,
    displayName: DEMO_NAME, language: 'en', location: null, profile: {} });
  else state.user.password_hash = await hashPassword(password);
  await authority.registration.register({ state, mail: null, invitation: null });
  const { loadInvestor, saveInvestor } = await import('../src/state/investor-store.ts');
  // Reconcile the fictional holdings through the same books path as other portfolios.
  await saveInvestor(await loadInvestor(state.user.id));
  const { createPortfolioProjectionRefresher } = await import('../src/state/portfolio-projections.ts');
  await createPortfolioProjectionRefresher()(state.user.id, true);
  const { readPortfolioProjection } = await import('../src/state/projection-store.ts');
  const savedState = (await loadInvestor(state.user.id)).state;
  const saved = readPortfolioProjection(savedState);
  if (!saved || saved.dashboard.model?.live.positions.length !== 5 || Object.keys(savedState.broker_connections ?? {}).length) throw Error('Demo readback failed');
  const receipt = { userId: state.user.id, email: DEMO_EMAIL, identityMode: deployment.mode,
    labelledSynthetic: saved.dashboard.displayName === DEMO_NAME, positions: saved.dashboard.model.live.positions.length,
    brokerConnections: 0, generatedAt: saved.dashboard.generatedAt, projectionReady: true, emailSent: false };
  await new Promise(resolve => process.stdout.write(JSON.stringify(receipt) + '\n', resolve));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  const { closePool } = await import('../src/books/db.ts'); await closePool();
  release(); await database.close();
}
process.exit(process.exitCode ?? 0);
