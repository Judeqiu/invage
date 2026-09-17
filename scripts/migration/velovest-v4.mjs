/** Explicit adapter for inspected Velovest 3.12.0 personal data, not the 3.15 importer. */
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createDatabasePool,readDatabaseConfig,createSecretCodec,assertDatabaseReady,UserRepository,UsageRepository,withTransaction} from 'utarus/database';
import {initialUsageAccount} from '../../node_modules/utarus/dist/database/initial-usage.js';
import {decodeYaml} from './import-invage-v4.mjs';
const POLICY='velovest-3.12.0-personal-v4-1';
function check(ok,label){if(!ok)throw new Error(label);}
const hash=v=>createHash('sha256').update(v).digest('hex');
const equal=(a,b,label)=>check(isDeepStrictEqual(a,b),`Reconciliation failed: ${label}`);
export function prepare(root,initializedAt){
 check(isAbsolute(root),'Absolute source required');
 const files=[];
 function walk(dir,prefix){for(const name of readdirSync(dir).sort()){
  const path=prefix?`${prefix}/${name}`:name;const full=join(dir,name);const stat=lstatSync(full);
  check(!stat.isSymbolicLink(),'Symlink rejected');
  check(name!=='_utarus','Widget adapter required');
  if(stat.isDirectory()){walk(full,path);continue;}
  check(stat.isFile(),'Nonordinary source rejected');
  const parts=path.split('/');let disposition;
  if(['users','usage'].includes(parts[0])&&parts.length===2&&name.endsWith('.yaml'))disposition='imported';
  else if(parts[0]==='users'&&parts.length===2&&name.endsWith('.yaml.bak-20260822-demo')){
   const backup=decodeYaml(readFileSync(full));
   check(name===`${backup.user.slug}.yaml.bak-20260822-demo`,'Historical backup owner mismatch');
   const current=decodeYaml(readFileSync(join(root,'users',`${backup.user.slug}.yaml`)));
   check(current.user.id===backup.user.id,'Historical backup identity mismatch');
   disposition='retained';
  }
  else if(['drive','chats','sessions','ops'].includes(parts[0]))disposition='retained';
  else if(['.sessions.json','.link-tokens.json','.telegram-link-codes.json'].includes(path))disposition='invalidated';
  else throw new Error(`Unsupported Velovest source family: ${parts[0]}`);
  files.push({path,disposition,bytes:stat.size,sha256:hash(readFileSync(full))});
 }}walk(root,'');
 const read=p=>decodeYaml(readFileSync(join(root,p)));
 const users=files.filter(f=>f.disposition==='imported'&&f.path.startsWith('users/')).map(f=>{const s=read(f.path);check(f.path===`users/${s.user.slug}.yaml`,'User filename mismatch');return s;});
 check(users.length>0,'No users');
 const existing=new Map();
 for(const f of files.filter(f=>f.path.startsWith('usage/'))){const s=read(f.path);check(s.version===3&&f.path===`usage/${s.user_slug}.yaml`,'Invalid usage source');check(users.some(u=>u.user.slug===s.user_slug),'Orphan usage');existing.set(s.user_slug,s);}
 const usage=users.map(u=>existing.has(u.user.slug)?existing.get(u.user.slug):initialUsageAccount(u.user.slug,initializedAt));
 const manifest={policy:POLICY,sourceVersion:'3.12.0',targetVersion:'4.0.0-beta.13',initializedAt,files};
 return {users,usage,initializedUsageAccounts:users.length-existing.size,manifest,manifestSha256:hash(JSON.stringify(manifest))};
}
async function reconcile(client,pool,codec,source){
 const repo=new UserRepository(pool,codec);
 for(const state of source.users)equal((await repo.readInTransaction(client,state.user.slug)).state,state,'complete user/domain/credentials');
 equal(Number((await client.query('SELECT count(*) FROM utarus.users')).rows[0].count),source.users.length,'user count');
 for(const state of source.usage){const r=await client.query('SELECT state,opening_state FROM utarus.usage_accounts JOIN utarus.users ON users.id=user_id WHERE slug=$1',[state.user_slug]);equal(r.rows[0]?.state,state,'usage');equal(r.rows[0]?.opening_state,state,'opening usage');}
 equal(Number((await client.query('SELECT count(*) FROM utarus.invites')).rows[0].count),0,'no source invitations');
}
export async function run(operation,root,importId,initializedAt){
 check(['import','verify'].includes(operation),'Operation required');
 check(/^[a-zA-Z0-9_-]+$/.test(importId),'Explicit import identity required');
 check(JSON.parse(readFileSync(new URL('../../node_modules/utarus/package.json',import.meta.url))).version==='4.0.0-beta.13','Target mismatch');
 const source=prepare(root,initializedAt);
 const pool=createDatabasePool(readDatabaseConfig(process.env),e=>{throw e;});
 const codec=createSecretCodec({keyId:process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID,keyBase64:process.env.UTARUS_DATABASE_ENCRYPTION_KEY});
 try{
  await assertDatabaseReady(pool,'personal',codec);
  return await withTransaction(pool,async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext('velovest-v4-import'))");
   const prior=await client.query('SELECT manifest_sha256 FROM utarus.historical_imports WHERE import_id=$1',[importId]);
   if(prior.rowCount){equal(prior.rows[0].manifest_sha256,source.manifestSha256,'manifest identity');await reconcile(client,pool,codec,source);return {verified:true,applied:false,users:source.users.length};}
   check(operation==='import','No prior import');
   equal(Number((await client.query('SELECT count(*) FROM utarus.users')).rows[0].count),0,'empty target');
   const userRepo=new UserRepository(pool,codec),usageRepo=new UsageRepository(pool);
   for(const state of source.users)await userRepo.createInTransaction(client,state);
   for(const state of source.usage)await usageRepo.createInTransaction(client,state);
   await reconcile(client,pool,codec,source);
   equal(prepare(root,initializedAt).manifest,source.manifest,'source stability');
   const report={applied:true,verified:true,users:source.users.length,usage:source.usage.length,initializedUsageAccounts:source.initializedUsageAccounts,initializedAt,sourceVersion:'3.12.0',manifestSha256:source.manifestSha256,files:source.manifest.files.length,retainedFiles:source.manifest.files.filter(f=>f.disposition==='retained').length,usagePolicy:'Existing usage unchanged; absent accounts explicitly initialized with zero history at the recorded timestamp'};
   await client.query('INSERT INTO utarus.historical_imports(import_id,manifest_sha256,manifest,report) VALUES($1,$2,$3,$4)',[importId,source.manifestSha256,source.manifest,report]);
   return report;
  });
 }finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run(...process.argv.slice(2)).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
