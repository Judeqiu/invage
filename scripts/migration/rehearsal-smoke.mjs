/** Run only against the explicit rehearsal DB, without external integrations. */
import { readdirSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import request from 'supertest';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';
async function main() {
const url = new URL(process.env.UTARUS_DATABASE_URL);
if (url.pathname !== '/invage_v4_rehearsal_20260915') throw new Error('Rehearsal DB required');
Object.assign(process.env, {
 UTARUS_LOADED_BY_HOST:'1', UTARUS_DATA_ROOT:'/opt/invage-v4-rehearsal/data',
 DEEPSEEK_API_KEY:'rehearsal-placeholder-no-network', UTARUS_AGENT_NAME:'Invage',
 INVAGE_PRODUCT_PROFILE:'full', INVAGE_ONBOARD_TOKEN_TTL_MIN:'15', INVAGE_PUBLIC_LANDING_URL:'https://rehearsal.invalid', INVAGE_SLACK_WORKSPACE_INVITE_URL:'https://rehearsal.invalid/invite', SESSION_SECRET:randomBytes(32).toString('hex'),
 UTARUS_MCP_ENABLED:'false', UTARUS_BILLING_ENABLED:'false', UTARUS_DYNAMIC_WORKFLOWS:'false',
 UTARUS_LIFECYCLE_MAIL_ENABLED:'false', UTARUS_LLM_PROVIDER:'deepseek',
 UTARUS_LLM_PROFILES:JSON.stringify({daily:{provider:'deepseek'},heavy:{provider:'deepseek'},vision:{provider:'deepseek'}}),
 UTARUS_LLM_ROUTING:JSON.stringify({default:'daily',utility:'daily',heavy:'heavy'}),
});
for(const name of ['TELEGRAM_BOT_TOKEN','SLACK_BOT_TOKEN','SLACK_APP_TOKEN','SLACK_SIGNING_SECRET','INVAGE_BOOKS_DATABASE_URL']) {
 if(process.env[name]) throw new Error('External integration present in rehearsal');
}
const db=await openDatabaseRuntime({mode:'personal',env:process.env,onError:e=>{throw e;}});
const release=bindDatabaseRuntime(db);
let framework;
function check(ok,label){if(!ok)throw new Error(`Rehearsal failed: ${label}`);}
try {
 const {createFramework}=await import('utarus');
 const {buildFrameworkAgentList}=await import('../../src/agents/framework-agents.ts');
 framework=await createFramework({database:db,defaultAgentId:'invage',agents:buildFrameworkAgentList('full'),startTaskScheduler:false,startWorkflowRuntime:false,startLifecycleMailScheduler:false});
 const app=framework.buildWebApp();
 const {resolveByToken,createSession,destroySession}=await import('../../node_modules/utarus/dist/webapp/auth.js');
 check((await request(app).get('/login')).status===200,'login page');
 const root='/opt/invage-v4-rehearsal/source-snapshot/users';
 let users=0;
 for(const file of readdirSync(root)) {
  const source=YAML.parse(readFileSync(`${root}/${file}`,'utf8'));
  const actual=await db.users.findBySlug(source.user.slug);
  check(isDeepStrictEqual(actual.state,source),'full aggregate');
  const identity=await resolveByToken(source.user.auth_token);
  check(identity?.slug===source.user.slug,'existing credential identity');
  const session=await createSession(identity);
  const result=await request(app).get('/api/webui/manifest').set('Cookie',`bindrive_session=${session}`);
  await destroySession(session);
  check(result.status===200,'existing credential authentication');
  const brokers=await request(app).get('/api/domain/invage/broker-connections').set('Authorization',`Bearer ${source.user.auth_token}`);
  check(brokers.status===200,`domain broker API status ${brokers.status}`);
  users++;
 }
 check((await request(app).get('/api/webui/manifest')).status===401,'anonymous access denied');
 console.log(JSON.stringify({smoke:'passed',users,checks:['framework boot','login','all existing auth tokens','full aggregates','domain broker API','anonymous denial','graceful stop']}));
} finally {try {if(framework)await framework.stop();}finally{release();await db.close();}}

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
