/** Preview/apply exact statement facts. Never changes cash or current holdings.
 * node --import tsx scripts/import-statement-evidence.mjs <user UUID> <evidence.json> <source-file> [--apply]
 * Run as the service user with the complete service environment and explicit data root.
 */
import 'dotenv/config';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,basename,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
const [user,file,source,flag]=process.argv.slice(2);
if(!user||!file||!source||flag&&flag!=='--apply'||!isAbsolute(process.env.UTARUS_DATA_ROOT??''))throw Error('Usage: <user UUID> <evidence.json> <source-file> [--apply]; set absolute UTARUS_DATA_ROOT');
const bytes=readFileSync(source),doc=JSON.parse(readFileSync(file,'utf8'));
if(createHash('sha256').update(bytes).digest('hex')!==doc.source?.sha256)throw Error('Source file SHA256 does not match evidence');
process.env.UTARUS_LOADED_BY_HOST='1';
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try{
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {reconcileStatementEvidence}=await import('../src/brokers/statement-evidence.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const initial=await loadInvestor(user);const connection=Object.entries(readBrokerAccountModel(initial.state).connections).find(([id,c])=>c.channel===doc.channel&&c.account_id===doc.account_id&&c.broker_id===doc.broker_id);
 if(!connection)throw Error('No matching configured account');
 await withBrokerSyncLease(initial.state.user.id,connection[0],async()=>{
  const snapshot=await loadInvestor(user),next=reconcileStatementEvidence(snapshot.state,doc);
  const changed=!isDeepStrictEqual(next,snapshot.state);
  if(flag==='--apply'&&changed){
   const dir=join(process.env.UTARUS_DATA_ROOT,'drive',snapshot.state.user.id,'statement-evidence',doc.source.sha256);mkdirSync(dir,{recursive:true,mode:0o700});
   for(const [name,data] of [['source-'+basename(source),bytes],['evidence-'+createHash('sha256').update(JSON.stringify(doc)).digest('hex')+'.json',JSON.stringify(doc,null,2)]]){const path=join(dir,name);if(existsSync(path)){if(!readFileSync(path).equals(Buffer.from(data)))throw Error('Archived source evidence conflicts');}else writeFileSync(path,data,{flag:'wx',mode:0o600});}
   next.log.push({ts:new Date().toISOString().slice(0,10),action:'statement_evidence_imported',reason:`Operator imported explicit contract metadata, execution fees, lifecycle links and annotations from ${doc.source.name}; source SHA256 ${doc.source.sha256}.`,source:doc.source});
   snapshot.state=next;await saveInvestor(snapshot);
  }
  console.log(JSON.stringify({applied:flag==='--apply'&&changed,changed,contracts:doc.contracts.length,lifecycleEvents:doc.lifecycle.length,annotations:doc.annotations.length,executionFees:doc.execution_fees?.length??0,sourceSha256:doc.source.sha256}));
 });
 if(flag==='--apply'){const {createPortfolioProjectionRefresher}=await import('../src/state/portfolio-projections.ts');await createPortfolioProjectionRefresher()(initial.state.user.id,true);}
}finally{const {closePool}=await import('../src/books/db.ts');await closePool();release();await db.close();}
process.exit(0);
