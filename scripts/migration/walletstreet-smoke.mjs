/** Isolated v4 boot/auth smoke; never starts channels, task scheduler or workflows. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import request from 'supertest';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

const root = process.argv[2];
if (new URL(process.env.UTARUS_DATABASE_URL).pathname !== '/walletstreet_v4_rehearsal') throw new Error('Rehearsal database required');
if (!root?.startsWith('/tmp/walletstreet-migration-') || process.env.INVAGE_BOOKS_DATABASE_URL) throw new Error('Isolated source required');
Object.assign(process.env, {
  UTARUS_LOADED_BY_HOST: '1', UTARUS_DATA_ROOT: root,
  DEEPSEEK_API_KEY: 'rehearsal-placeholder-no-network', UTARUS_AGENT_NAME: 'Wallet Street',
  INVAGE_PRODUCT_PROFILE: 'full', INVAGE_ONBOARD_TOKEN_TTL_MIN: '15',
  INVAGE_PUBLIC_LANDING_URL: 'https://rehearsal.invalid',
  INVAGE_SLACK_WORKSPACE_INVITE_URL: 'https://rehearsal.invalid/invite',
  SESSION_SECRET: randomBytes(32).toString('hex'), UTARUS_MCP_ENABLED: 'false',
  UTARUS_BILLING_ENABLED: 'false', UTARUS_DYNAMIC_WORKFLOWS: 'false',
  UTARUS_LIFECYCLE_MAIL_ENABLED: 'false', UTARUS_LLM_PROVIDER: 'deepseek',
  UTARUS_LLM_PROFILES: JSON.stringify({daily:{provider:'deepseek'},heavy:{provider:'deepseek'},vision:{provider:'deepseek'}}),
  UTARUS_LLM_ROUTING: JSON.stringify({default:'daily',utility:'daily',heavy:'heavy'}),
});
for (const name of ['TELEGRAM_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'])
  if (process.env[name]) throw new Error('External integration present in rehearsal');
const check = (condition, label) => { if (!condition) throw new Error(`Rehearsal failed: ${label}`); };
const db = await openDatabaseRuntime({mode:'personal',env:process.env,onError:error=>{throw error;}});
console.error('[smoke] database ready');
const release = bindDatabaseRuntime(db);
let framework;
try {
  const { createFramework } = await import('utarus');
  const { buildFrameworkAgentList } = await import('../../src/agents/framework-agents.ts');
  framework = await createFramework({database:db,defaultAgentId:'invage',agents:buildFrameworkAgentList('full'),startTaskScheduler:false,startWorkflowRuntime:false,startLifecycleMailScheduler:false});
  console.error('[smoke] framework ready');
  const app = framework.buildWebApp();
  console.error('[smoke] web app ready');
  const { resolveByToken, createSession, destroySession } = await import('../../node_modules/utarus/dist/webapp/auth.js');
  check((await request(app).get('/login')).status === 200, 'login');
  console.error('[smoke] login ready');
  let users = 0;
  for (const file of readdirSync(join(root, 'users')).filter(name => name.endsWith('.yaml'))) {
    const source = YAML.parse(readFileSync(join(root, 'users', file), 'utf8'));
    console.error('[smoke] checking user', users + 1);
    check(isDeepStrictEqual((await db.users.findBySlug(source.user.slug)).state, source), 'full user document');
    const identity = await resolveByToken(source.user.auth_token);
    check(identity?.slug === source.user.slug, 'existing credential');
    const session = await createSession(identity);
    check((await request(app).get('/api/webui/manifest').set('Cookie', `bindrive_session=${session}`)).status === 200, 'session');
    await destroySession(session);
    check((await request(app).get('/api/domain/invage/broker-connections').set('Authorization', `Bearer ${source.user.auth_token}`)).status === 200, 'broker API');
    users++;
  }
  check((await request(app).get('/api/webui/manifest')).status === 401, 'anonymous denial');
  console.log(JSON.stringify({smoke:'passed',users}));
} finally { try { if (framework) await framework.stop(); } finally { release(); await db.close(); } }
