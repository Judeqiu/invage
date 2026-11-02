/** Resolve held worksheet rows from account-bound IBKR Activity CSVs.
 * <user UUID> <journal.json> <original.xlsx> <source-directory> --sources-sha256=HEX [--apply]
 * source-directory/sources.json lists immutable {name,sha256} CSVs and review document.
 * Uses saved valuations, never changes current cash/holdings or claims order rows are fills.
 */
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve,relative,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
import {reconstructSpreadsheetTrades} from '../src/brokers/spreadsheet-trades.ts';
import {readIBKRReviewStatement,planIBKRWorksheetReview} from '../src/brokers/ibkr-worksheet-review.ts';
import {addDecimals,negateDecimal,mergeOptionExecutions} from '../src/brokers/option-executions.ts';
import {mergeOptionLifecycleEvents} from '../src/brokers/option-events.ts';
const [user,journal,original,directory,...flags]=process.argv.slice(2);
const expected=flags.find(f=>f.startsWith('--sources-sha256='))?.slice(17);
if(!user||!journal||!original||!directory||!process.env.UTARUS_DATA_ROOT?.startsWith('/')||!/^[a-f0-9]{64}$/.test(expected??'')||
 flags.some(f=>f!=='--apply'&&!/^--sources-sha256=[a-f0-9]{64}$/.test(f)))throw Error('Explicit source files, source manifest checksum and absolute data root required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=new Map();
const capture=path=>{const bytes=readFileSync(path);files.set(path,bytes);return bytes;};
const sourceBytes=capture(join(directory,'sources.json'));
if(hash(sourceBytes)!==expected)throw Error('Source manifest checksum mismatch');
const sources=JSON.parse(sourceBytes),manifest=JSON.parse(capture(join(resolve(journal,'..'),'manifest.json')));
const rows=JSON.parse(capture(journal));
if(manifest.scope?.user_id!==user||manifest.scope?.channel!=='ibkr'||hash(capture(original))!==manifest.source?.sha256)throw Error('Workbook scope or checksum mismatch');
if(!Array.isArray(sources)||!sources.length)throw Error('Source list required');
for(const s of sources){if(basename(s.name)!==s.name||!/^[a-f0-9]{64}$/.test(s.sha256)||hash(capture(join(directory,s.name)))!==s.sha256)throw Error('Source filename or checksum mismatch');}
const statements=sources.filter(s=>s.name.endsWith('.csv')).map(s=>readIBKRReviewStatement(s.name,files.get(join(directory,s.name)),manifest.scope.account_id));
process.env.UTARUS_LOADED_BY_HOST='1';
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try{
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const {prepareExecutionImportProjection}=await import('../src/state/prepare-execution-import.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const initial=await loadInvestor(user);
 const connections=Object.entries(readBrokerAccountModel(initial.state).connections).filter(([,c])=>c.broker_id==='ibkr'&&c.channel===manifest.scope.channel&&c.account_id===manifest.scope.account_id);
 if(connections.length!==1)throw Error('Unique matching configured IBKR account required');
 await withBrokerSyncLease(user,connections[0][0],async()=>{
  const snapshot=await loadInvestor(user),before=snapshot.state;
  const fileId=relative(join(process.env.UTARUS_DATA_ROOT,'drive',user),resolve(original));
  if(fileId.startsWith('../')||fileId.startsWith('/'))throw Error('Workbook must be retained in account Drive');
  const reconstructed=reconstructSpreadsheetTrades(rows,{channel:manifest.scope.channel,account_id:manifest.scope.account_id,source_sha256:manifest.source.sha256,
   source_file_id:fileId,sheet:manifest.source.sheet,year:Number(manifest.source.year??rows[0].date.slice(0,4)),approved_multiplier:'100'});
  // The previous approved import establishes this multiplier; verify every accepted row without alteration.
  for(const e of reconstructed.executions){const saved=before.option_executions?.find(p=>p.channel===e.channel&&p.account_id===e.account_id&&p.execution_id===e.execution_id);
   if(!saved||!isDeepStrictEqual(saved,e))throw Error('Prior approved worksheet reconstruction differs; review before proceeding');}
  const plan=planIBKRWorksheetReview(reconstructed.review.map(r=>r.source),statements,{channel:manifest.scope.channel,account_id:manifest.scope.account_id});
  const oldExecutions=before.option_executions??[],oldEvents=before.option_events??[];
  for(const e of plan.executions)if(oldExecutions.some(p=>p.channel===e.channel&&p.account_id===e.account_id&&p.execution_id!==e.execution_id&&p.executed_at.slice(0,10)===e.executed_at.slice(0,10)&&p.underlying===e.underlying&&p.expiry===e.expiry&&p.right===e.right&&p.strike===e.strike&&p.side===e.side&&!/[1-9]/.test(addDecimals(p.contracts,negateDecimal(e.contracts)))&&!/[1-9]/.test(addDecimals(p.gross_premium,negateDecimal(e.gross_premium)))))throw Error('Statement trade overlaps existing execution; explicit deduplication review required');
  for(const e of plan.events)if(oldEvents.some(p=>p.channel===e.channel&&p.account_id===e.account_id&&p.id!==e.id&&p.date===e.date&&p.underlying===e.underlying&&p.expiry===e.expiry&&p.right===e.right&&p.strike===e.strike))throw Error('Statement event overlaps existing lifecycle evidence');
  const executions=mergeOptionExecutions(oldExecutions,plan.executions),events=mergeOptionLifecycleEvents(oldEvents,plan.events);
  const added=executions.length-oldExecutions.length,addedEvents=events.length-oldEvents.length;
  for(const e of oldExecutions)if(!isDeepStrictEqual(e,executions.find(p=>p.channel===e.channel&&p.account_id===e.account_id&&p.execution_id===e.execution_id)))throw Error('Repair changes an existing execution');
  for(const e of oldEvents)if(!isDeepStrictEqual(e,events.find(p=>p.channel===e.channel&&p.account_id===e.account_id&&p.id===e.id)))throw Error('Repair changes an existing event');
  const next={...before,option_executions:executions,option_events:events};
  const prior=readPortfolioProjection(before);if(!prior)throw Error('Valid saved portfolio view required');
  const prepared=added||addedEvents?await prepareExecutionImportProjection(before,executions,'ibkr',undefined,events):prior;
  const valuation=p=>({generatedAt:p.dashboard.generatedAt,model:p.dashboard.model,benchmark:p.dashboard.benchmark,equityPrices:p.dashboard.equityPrices,daily:p.dailyAggregateHistory});
  if(!isDeepStrictEqual(valuation(prior),valuation(prepared)))throw Error('Prepared view changes saved valuation evidence');
  const receipt={applied:false,added_executions:added,added_events:addedEvents,gross_cash:plan.gross_cash,fee_cash:plan.fee_cash,
   source_manifest_sha256:expected,source_files:sources,resolutions:plan.resolutions,prior_calculated_at:prior.calculatedAt,
   prior_ibkr_journal:prior.brokers.ibkr?.journal,prepared_ibkr_journal:prepared.brokers.ibkr?.journal};
  if(flags.includes('--apply')&&(added||addedEvents)){
   for(const [path,bytes] of files)if(!readFileSync(path).equals(bytes))throw Error('Source changed during preparation');
   const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(before))throw Error('Account changed during preparation');
   const backup=join(process.env.UTARUS_DATA_ROOT,'repairs','ibkr-worksheet-review',randomUUID());mkdirSync(backup,{recursive:true,mode:0o700});
   const archive=join(process.env.UTARUS_DATA_ROOT,'drive',user,'statement-evidence',expected);mkdirSync(archive,{recursive:true,mode:0o700});
   for(const s of [...sources,{name:'sources.json',sha256:expected}]){const path=join(archive,s.name),bytes=files.get(join(directory,s.name));if(existsSync(path)){if(!readFileSync(path).equals(bytes))throw Error('Archived source conflict');}else writeFileSync(path,bytes,{flag:'wx',mode:0o600});}
   writeFileSync(join(backup,'before.json'),JSON.stringify(snapshot),{flag:'wx',mode:0o600});
   writeFileSync(join(backup,'prepared-projection.json'),JSON.stringify(prepared),{flag:'wx',mode:0o600});
   next.log=[...before.log,{ts:new Date().toISOString().slice(0,10),action:'ibkr_worksheet_review_resolved',reason:'Resolved held worksheet rows using account-bound IBKR statement order cash, instrument metadata, explicit lifecycle codes and stock deliveries. Preserved previous manual trades, holdings, cash and raw broker history.',source_manifest_sha256:expected,sources,resolutions:plan.resolutions}];
   snapshot.state=next;await saveInvestor(snapshot);
   const actual=await loadInvestor(user);
   if(!isDeepStrictEqual(actual.state,snapshot.state))throw Error('State readback differs; retain recovery artifacts');
   const preserved=s=>{const {option_executions,option_events,option_identities,log,...rest}=s;return rest;};
   if(!isDeepStrictEqual(preserved(before),preserved(actual.state)))throw Error('Unrelated state changed');
   prepared.fingerprint=portfolioFingerprint(actual.state);
   const current=readPortfolioProjection(actual.state);if(!current||current.calculatedAt<prepared.calculatedAt)writePortfolioProjection(prepared);
   const published=readPortfolioProjection(actual.state);if(!published)throw Error('Saved repair has no valid published projection');
   if(!isDeepStrictEqual(valuation(prior),valuation(published)))throw Error('Saved valuation time or daily history changed');
   receipt.applied=true;receipt.revision=actual.revision;receipt.backup=backup;receipt.projection_ready=true;
   writeFileSync(join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
   writeFileSync(join(archive,'review-resolution.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({...receipt,resolutions:undefined,prior_ibkr_journal:undefined,prepared_ibkr_journal:undefined}));
 });
}catch(error){console.error(error);process.exitCode=1;}finally{const {closePool}=await import('../src/books/db.ts');await closePool();release();await db.close();}
process.exit(process.exitCode??0);
