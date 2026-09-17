/** Read-only verification against an immutable legacy source after import/restore. */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {createDatabasePool,readDatabaseConfig,createSecretCodec,assertDatabaseReady,UserRepository} from 'utarus/database';
import {readHistoricalInvites} from '../../node_modules/utarus/dist/database/historical-invites.js';
import {DemoModeRepository} from '../../node_modules/utarus/dist/database/repositories/demo-mode.js';
import {inventory,decodeYaml,normalizeUsage} from './import-invage-v4.mjs';
async function main(){
 const [root]=process.argv.slice(2); const files=inventory(root);
 const pool=createDatabasePool(readDatabaseConfig(process.env),e=>{throw e;});
 const codec=createSecretCodec({keyId:process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID,keyBase64:process.env.UTARUS_DATABASE_ENCRYPTION_KEY});
 const equal=(a,b,label)=>{if(!isDeepStrictEqual(a,b))throw new Error(`Verification failed: ${label}`);};
 const read=p=>decodeYaml(readFileSync(join(root,p)));
 try{
  await assertDatabaseReady(pool,'personal',codec);
  const client=await pool.connect();
  try{
   await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const users=new UserRepository(pool,codec);let count=0;
   for(const f of files.filter(f=>f.path.startsWith('users/'))){const source=read(f.path);equal((await users.readInTransaction(client,source.user.slug)).state,source,'full user/domain/credentials');count++;}
   equal(Number((await client.query('SELECT count(*) FROM utarus.users')).rows[0].count),count,'user coverage');
   for(const f of files.filter(f=>f.path.startsWith('usage/'))){const source=normalizeUsage(read(f.path));const result=await client.query('SELECT state,opening_state FROM utarus.usage_accounts JOIN utarus.users ON users.id=user_id WHERE slug=$1',[source.user_slug]);equal(result.rows[0]?.state,source,'usage');equal(result.rows[0]?.opening_state,source,'opening usage');}
   const invites=read('invites.yaml');equal(await readHistoricalInvites(client,codec,invites),invites,'invitations');
   equal((await new DemoModeRepository(pool).readInTransaction(client)).state,read('demo_mode.yaml'),'demo settings');
   await client.query('COMMIT');
   console.log(JSON.stringify({verification:'passed',users:count,sourceFiles:files.length,checks:['full domain documents','credentials','usage','opening usage','invites','demo settings','schema readiness']}));
  }finally{client.release();}
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
