/** Replace only the designated synthetic demo with a user-approved workbook snapshot.
 * node --import tsx scripts/import-demo-workbook.mjs <source.json> <original.xlsx> [--apply]
 * Requires the complete service environment and absolute UTARUS_DATA_ROOT.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
const [sourceFile,originalFile,...flags]=process.argv.slice(2);
if(!sourceFile||!originalFile||flags.some(f=>f!=='--apply')||!isAbsolute(process.env.UTARUS_DATA_ROOT??''))throw Error('Explicit files and absolute service data root required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync(sourceFile),original=readFileSync(originalFile),book=JSON.parse(bytes);
const {assertDemoWorkbook,demoWorkbookForState,workbookJournal}=await import('../src/demo/workbook.ts');
assertDemoWorkbook(book);
if(hash(original)!==book.source.sha256)throw Error('Workbook source hash mismatch');
const {readAccountConfiguration}=await import('../src/accounts.ts');
const {configureSharedAccountRuntime}=await import('../node_modules/utarus/dist/accounts/shared-runtime.js');
await configureSharedAccountRuntime(readAccountConfiguration(process.env));
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try {
 const {getAccountAuthority,resolveDataRoot}=await import('utarus');
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {isSyntheticDemo}=await import('../src/demo/showcase.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection,PROJECTION_VERSION}=await import('../src/state/projection-store.ts');
 const {projectionLocation}=await import('../src/state/projection-files.ts');
 const {loadDashboardForSlug}=await import('../src/webapp/dashboard-data.ts');
 const {buildPageProjections,buildTradeProjections}=await import('../src/report/page-projections.ts');
 const {buildBrokerProjections}=await import('../src/report/broker-projections.ts');
 const {prepareOptionRelationships}=await import('../src/webapp/option-relationships-data.ts');
 const {optionHistoryForState}=await import('../src/webapp/option-history-data.ts');
 const {tradesOpenBook,tradesHistory}=await import('../src/webapp/trades-v2-data.ts');
 const {prepareDashboardWireFile}=await import('../src/state/dashboard-wire-store.ts');
 const user=await getAccountAuthority().users.findByEmail('demo@velovest.ai');
 if(!user)throw Error('Demo account not found');
 const before=await loadInvestor(user.state.user.id);
 if(!isSyntheticDemo(before.state)||Object.keys(before.state.broker_connections??{}).length)throw Error('Target is not an isolated synthetic demo');
 if(demoWorkbookForState(before.state)){
  if(!isDeepStrictEqual(before.state.demo_workbook,book))throw Error('Demo already contains a different workbook; review before replacement');
  const saved=readPortfolioProjection(before.state);
  if(!saved)throw Error('Existing workbook requires projection recovery');
  console.log(JSON.stringify({status:'already_imported',userId:before.state.user.id,sourceSha256:book.source.sha256,positions:saved.openTrades.rows.length}));
 }else{
  const candidate=structuredClone(before),state=candidate.state;
  state.portfolio={};state.cash=[{amount:Number(book.summary.cash),currency:book.currency,updated_at:book.asOf}];
  state.option_executions=[];
  // These optional synthetic financial derivatives must not survive a replacement.
  for(const field of ['option_identities','option_journal','option_events','option_observations','broker_history','deposits'])delete state[field];
  state.demo_workbook=book;
  state.log.push({ts:new Date().toISOString().slice(0,10),action:'demo_workbook_import',reason:'User approved replacing synthetic demo with workbook snapshot, USD, worksheet multiplier and current short-put interpretation. Row cash is retained without fabricated roll executions.',source_sha256:book.source.sha256,source_file_id:book.source.fileId});
  const relationships=await prepareOptionRelationships(state);
  const dashboard=await loadDashboardForSlug(state.user.id,undefined,undefined,undefined,{snapshot:candidate,relationships});
  const pages=buildPageProjections(dashboard);dashboard.pageProjections={positions:pages.positions,insights:pages.insights};dashboard.aggregatedViews=pages.dashboard;
  const optionHistory=optionHistoryForState(state),openTrades=tradesOpenBook(state),history=tradesHistory(state,[]);
  const prepared={version:PROJECTION_VERSION,userId:state.user.id,fingerprint:portfolioFingerprint(state),calculatedAt:dashboard.generatedAt,
   dashboard,brokers:buildBrokerProjections(state,dashboard,openTrades.rows,history.rows),journal:workbookJournal(book),
   openTrades:{...openTrades,aggregates:buildTradeProjections(openTrades.rows)},tradeHistory:{...history,aggregates:buildTradeProjections(history.rows,true),gaps:[]},optionHistory,relationships};
  const scope=dashboard.aggregatedViews.live.merged;
  if(scope.view.totalValue!==Number(book.summary.nav)||scope.premium.total!==Number(book.summary.premiumTotal)||
   openTrades.rows.length!==book.rows.length||history.rows.length||prepared.journal.executions.length)throw Error('Prepared demo source reconciliation failed');
  const receipt={status:flags.includes('--apply')?'imported':'dry_run',userId:state.user.id,sourceSha256:book.source.sha256,sourceJsonSha256:hash(bytes),
   positions:openTrades.rows.length,brokerScopes:Object.keys(prepared.brokers),syntheticExecutionsRemoved:before.state.option_executions?.length??0,
   asOf:book.asOf,summary:book.summary,brokerConnections:0};
  if(flags.includes('--apply')){
   const latest=await loadInvestor(state.user.id);
   if(latest.revision!==before.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(before.state)||hash(readFileSync(sourceFile))!==hash(bytes)||hash(readFileSync(originalFile))!==book.source.sha256)throw Error('Source changed during preparation');
   const directory=join(resolveDataRoot(),'repairs','demo-workbook',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
   writeFileSync(join(directory,'before.json'),JSON.stringify(before),{mode:0o600,flag:'wx'});
   const old=readPortfolioProjection(before.state);if(!old)throw Error('Valid prior saved view required for backup');
   writeFileSync(join(directory,'before-projection.json'),JSON.stringify(old),{mode:0o600,flag:'wx'});
   writeFileSync(join(directory,'source.json'),bytes,{mode:0o600,flag:'wx'});
   writeFileSync(join(directory,'prepared-projection.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
   if(!isDeepStrictEqual(JSON.parse(readFileSync(join(directory,'before.json'))),before))throw Error('Backup readback failed');
   const driveFile=join(resolveDataRoot(),'drive',state.user.id,book.source.fileId);mkdirSync(join(driveFile,'..'),{recursive:true,mode:0o700});
   if(existsSync(driveFile)){if(hash(readFileSync(driveFile))!==book.source.sha256)throw Error('Original source path occupied');}
   else writeFileSync(driveFile,original,{mode:0o600,flag:'wx'});
   if(hash(readFileSync(driveFile))!==book.source.sha256)throw Error('Retained workbook verification failed');
   await saveInvestor(candidate);
   const actual=await loadInvestor(state.user.id);
   if(!isDeepStrictEqual(actual.state,state)||!isDeepStrictEqual(actual.state.user,before.state.user)||!isDeepStrictEqual(actual.state.profile,before.state.profile))throw Error('Account readback differs; retain backup for recovery');
   prepared.fingerprint=portfolioFingerprint(actual.state);writePortfolioProjection(prepared);
   await prepareDashboardWireFile(projectionLocation(state.user.id).file);
   if(!readPortfolioProjection(actual.state))throw Error('Saved projection readback failed');
   receipt.backup=directory;receipt.savedRevision=actual.revision;receipt.backupVerified=true;receipt.sourceRetained=true;
   writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify(receipt));
 }
}catch(error){console.error(error);process.exitCode=1;}
finally{const{closePool}=await import('../src/books/db.ts');await closePool();release();await db.close();}
process.exit(process.exitCode??0);
