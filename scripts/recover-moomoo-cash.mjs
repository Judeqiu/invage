/** API-only repair. <user UUID> <evidence directory> --receipt-sha256=HEX [--apply]
 * Requires a complete immutable API collection and a valid saved projection.
 * Run under the service environment with absolute UTARUS_DATA_ROOT; dry run by default.
 */
import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
const [user,directory,...flags]=process.argv.slice(2);
const expected=flags.find(f=>f.startsWith('--receipt-sha256='))?.slice(17);
if(!user||!directory||!/^[a-f0-9]{64}$/.test(expected??'')||flags.some(f=>f!=='--apply'&&!/^--receipt-sha256=[a-f0-9]{64}$/.test(f))||!process.env.UTARUS_DATA_ROOT?.startsWith('/'))throw Error('Explicit account, API evidence receipt SHA256 and data root required');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function verifySources() {
 const receiptBytes=readFileSync(join(directory,'receipt.json'));
 if(hash(receiptBytes)!==expected)throw Error('API collection receipt changed');
 const receipt=JSON.parse(receiptBytes);
 if(receipt.source!=='moomoo_api_only'||receipt.user!==user||receipt.channel!=='moomoo'||receipt.status!=='fetched'||!receipt.complete||receipt.authentication!=='verified')throw Error('Incomplete or unbound API collection');
 const files=new Map();
 for(const file of receipt.files){if(basename(file.name)!==file.name||files.has(file.name))throw Error('Invalid source filename');const bytes=readFileSync(join(directory,file.name));if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error('API source checksum mismatch');files.set(file.name,JSON.parse(bytes));}
 const pages=prefix=>[...files].filter(([name])=>name.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).map(([,page])=>page);
 const begin=String(BigInt(Date.parse(receipt.requested.from))*1000n),end=String(BigInt(Date.parse(receipt.requested.through))*1000n);
 function rows(pages,key){if(!pages.length)throw Error('Missing source pages');return pages.flatMap((page,i)=>{if(page.account_id!==receipt.account_id||page.requested.begin!==begin||page.requested.end!==end||page.data.completed!==(i===pages.length-1)||!Array.isArray(page.data[key]))throw Error('Incomplete account-bound source pages');return page.data[key];});}
 const cashPages=pages('cash-page-'),us=pages('fills-US-'),hk=pages('fills-HK-');
 const cash=rows(cashPages,'cash_logs'),fills=[...rows(us,'order_fills'),...rows(hk,'order_fills')];
 if(cashPages.length!==receipt.cashPages||us.length+hk.length!==receipt.fillPages||cash.length!==receipt.cashRows||fills.length!==receipt.fillRows||new Set(fills.map(r=>r.deal_id)).size!==fills.length)throw Error('Source pagination/identity count mismatch');
 const source=files.get('retained-api-history.json');if(!source)throw Error('Missing original history');
 const codes=[...new Set(source.executions.filter(e=>e.instrument==='option'&&e.multiplier===null).map(e=>e.native_symbol))];
 const bundle={schema:'invage.moomoo.raw.v1',acc_id:receipt.account_id,fetched_at:receipt.completedAt,authorized:{s:'ok'},funds:{s:'ok'},positions:{s:'ok',d:[]},fills_history:{start:begin,end,rows:fills},cash_logs:codes.map(code=>({code,from:receipt.requested.from,through:receipt.requested.through,complete:true,rows:cash.filter(r=>r.symbol===code.slice(code.indexOf('.')+1))}))};
 return {receipt,source,bundle};
}
const evidence=verifySources();
process.env.UTARUS_LOADED_BY_HOST='1';
const database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(database);
try {
 const {resolveDataRoot}=await import('utarus');
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const {recoverRetainedMooMooCash}=await import('../src/moomoo/moomoo-cash-recovery.ts');
 const {optionExecutionsFromHistory}=await import('../src/brokers/history.ts');
 const {mergeOptionExecutions,addDecimals}=await import('../src/brokers/option-executions.ts');
 const {prepareExecutionImportProjection}=await import('../src/state/prepare-execution-import.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const initial=await loadInvestor(user);
 const matches=Object.entries(readBrokerAccountModel(initial.state).connections).filter(([,c])=>c.broker_id==='moomoo'&&c.channel===evidence.receipt.channel&&c.account_id===evidence.receipt.account_id);
 if(matches.length!==1)throw Error('Source has no unique configured moomoo account');
 const [connectionId,connection]=matches[0];
 await withBrokerSyncLease(user,connectionId,async()=>{
  const snapshot=await loadInvestor(user),before=snapshot.state.option_executions??[],oldHistory=snapshot.state.broker_history?.[connectionId];
  if(!oldHistory)throw Error('Missing retained broker history');
  const result=recoverRetainedMooMooCash(oldHistory,evidence.source,evidence.bundle);
  const merged=mergeOptionExecutions(before,optionExecutionsFromHistory(result.history));
  for(const row of before)if(!isDeepStrictEqual(row,merged.find(m=>m.channel===row.channel&&m.account_id===row.account_id&&m.execution_id===row.execution_id)))throw Error('Repair modifies an existing projected trade');
  const histories={...snapshot.state.broker_history,[connectionId]:result.history};
  const prepared=result.recovered.length?await prepareExecutionImportProjection(snapshot.state,merged,'moomoo',histories):readPortfolioProjection(snapshot.state);
  if(!prepared)throw Error('Saved projection unavailable');
  if(recoverRetainedMooMooCash(result.history,evidence.source,evidence.bundle).recovered.length)throw Error('Repair is not idempotent');
  const sum=rows=>addDecimals('0',...rows.map(e=>e.gross_premium));
  const options=merged.filter(e=>e.channel===connection.channel&&e.account_id===connection.account_id);
  const receipt={apply:flags.includes('--apply'),source_receipt_sha256:expected,recovered:result.recovered.length,added:merged.length-before.length,contracts:Object.keys(result.multipliers).length,optionExecutions:options.length,unknownFees:options.filter(e=>e.commission===null).length,idempotent:true,monthly:Object.fromEntries([...new Set(options.map(e=>e.executed_at.slice(0,7)))].sort().map(month=>[month,sum(options.filter(e=>e.executed_at.startsWith(month)))]))};
  if(flags.includes('--apply')&&result.recovered.length){
   verifySources();
   const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(snapshot.state))throw Error('Account changed during preparation');
   const root=resolveDataRoot(),repair=join(root,'repairs','moomoo-cash',randomUUID());mkdirSync(repair,{recursive:true,mode:0o700});
   writeFileSync(join(repair,'before.json'),JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
   writeFileSync(join(repair,'prepared-projection.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
   const archive=join(root,'drive',user,'moomoo-cash-recovery',expected);mkdirSync(archive,{recursive:true,mode:0o700});
   for(const name of ['receipt.json',...evidence.receipt.files.map(f=>f.name)]){const target=join(archive,name);if(existsSync(target)){if(hash(readFileSync(target))!==hash(readFileSync(join(directory,name))))throw Error('Archive conflicts with source');}else cpSync(join(directory,name),target,{errorOnExist:true,force:false});}
   verifySources();
   snapshot.state.option_executions=merged;snapshot.state.broker_history=histories;
   snapshot.state.log.push({ts:new Date().toISOString().slice(0,10),action:'moomoo_cash_recovery',reason:'Exact account-bound broker API fills and complete cash ledger reconcile contract sizes independently; preserved all existing fees and broker cash.',source_receipt_sha256:expected,recovered:result.recovered.length,source_file_id:`moomoo-cash-recovery/${expected}/receipt.json`});
   await saveInvestor(snapshot);
   const actual=await loadInvestor(user);
   if(!isDeepStrictEqual(actual.state,snapshot.state))throw Error('Persisted state differs; retain staged recovery artifacts');
   prepared.fingerprint=portfolioFingerprint(actual.state);
   const current=readPortfolioProjection(actual.state);if(!current||current.calculatedAt<prepared.calculatedAt)writePortfolioProjection(prepared);
   receipt.projection_ready=Boolean(readPortfolioProjection(actual.state));receipt.saved_revision=actual.revision;receipt.backup=repair;receipt.archive=archive;
   if(!receipt.projection_ready)throw Error('Persisted repair has no valid projection');
   writeFileSync(join(repair,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify(receipt));
 });
}catch(error){console.error(error);process.exitCode=1;}
finally{const {closePool}=await import('../src/books/db.ts');await closePool();release();await database.close();}
