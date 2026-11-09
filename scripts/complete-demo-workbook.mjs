/** Dry run by default. Run with the verified service environment, as its OS user.
 * node --import tsx scripts/complete-demo-workbook.mjs market.json plan.json [--apply]
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
const [marketFile,planFile,...flags]=process.argv.slice(2);
if(!marketFile||!planFile||flags.some(f=>f!=='--apply')||!isAbsolute(process.env.UTARUS_DATA_ROOT??''))throw Error('Explicit evidence, reviewed plan and absolute host data root required');
const hash=v=>createHash('sha256').update(v).digest('hex'),marketBytes=readFileSync(marketFile),planBytes=readFileSync(planFile);
const market=JSON.parse(marketBytes),plan=JSON.parse(planBytes);
const{readAccountConfiguration}=await import('../src/accounts.ts');
const{configureSharedAccountRuntime}=await import('../node_modules/utarus/dist/accounts/shared-runtime.js');await configureSharedAccountRuntime(readAccountConfiguration(process.env));
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try{
 const{getAccountAuthority,resolveDataRoot}=await import('utarus');
 const{loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const{prepareCompletedDemo,completedDemo}=await import('../src/demo/completion.ts');
 const{prepareDemoProjection}=await import('../src/demo/prepare-projection.ts');
 const{portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const{attachDailyChanges}=await import('../src/report/daily-changes.ts');
 const{prepareDashboardWireFile}=await import('../src/state/dashboard-wire-store.ts');
 const{projectionLocation}=await import('../src/state/projection-files.ts');
 const authority=getAccountAuthority(),user=await authority.users.findByEmail('demo@velovest.ai');if(!user)throw Error('Designated demo not found');
 const before=await loadInvestor(user.state.user.id),root=resolveDataRoot();
 if(before.state.profile.contact_email!=='demo@velovest.ai'||before.state.synthetic_demo?.version!==1||Object.keys(before.state.broker_connections??{}).length)throw Error('Target is not the isolated demo');
 const source=join(root,'drive',before.state.user.id,before.state.demo_workbook.source.fileId);
 if(hash(readFileSync(source))!==before.state.demo_workbook.source.sha256)throw Error('Original workbook checksum differs');
 const digest=value=>hash(JSON.stringify(value));
 if(completedDemo(before.state)){
  if(before.state.demo_completion.marketSha256!==digest(market)||before.state.demo_completion.planSha256!==digest(plan))throw Error('Different demo generation already exists; review before replacing');
  if(!readPortfolioProjection(before.state))throw Error('Completed demo needs projection recovery');
  console.log(JSON.stringify({status:'already_completed',userId:before.state.user.id,revision:before.revision}));
 }else{
  const candidate={...before,state:prepareCompletedDemo(before.state,market,plan)},prepared=await prepareDemoProjection(candidate.state),prior=readPortfolioProjection(before.state);
  if(!prior)throw Error('Verified prior generation required before replacement');
  const accountDigests=async()=>{
   const result={};for(const id of await authority.users.listIds('active'))if(id!==before.state.user.id){
    const s=await loadInvestor(id);const{portfolio,cash,deposits,broker_connections,broker_history,option_executions,option_events}=s.state;
    result[id]=hash(JSON.stringify({portfolio,cash,deposits,broker_connections,broker_history,option_executions,option_events}));
   }return result;
  };
  const otherBefore=await accountDigests(),scope=prepared.dashboard.aggregatedViews.live.merged;
  const receipt={status:flags.includes('--apply')?'completed':'dry_run',userId:before.state.user.id,asOf:market.asOf,
   marketSha256:candidate.state.demo_completion.marketSha256,marketFileSha256:hash(marketBytes),planFileSha256:hash(planBytes),
   currentOptions:prepared.openTrades.rows.length,modeledQuotes:Object.keys(candidate.state.demo_completion.quotes).length,
   generatedExecutions:prepared.journal.executions.length,closedResults:prepared.dashboard.optionAnalytics.profits.length,
   historyDates:prepared.dashboard.model.history.length,rollGroups:prepared.relationships.groups.length,
   nav:scope.view.totalValue,cash:scope.view.cashAmount,assignment:scope.assignmentObligation,premium:scope.premium,
   realized:scope.realized,brokerNav:Object.fromEntries(Object.entries(prepared.brokers).map(([id,b])=>[id,b.nav])),
   normalAccountsChecked:Object.keys(otherBefore).length};
  if(flags.includes('--apply')){
   const latest=await loadInvestor(before.state.user.id);
   if(latest.revision!==before.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(before.state)||hash(readFileSync(marketFile))!==hash(marketBytes)||hash(readFileSync(planFile))!==hash(planBytes))throw Error('Source changed during staging');
   const directory=join(root,'repairs','demo-completion',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
   for(const[name,value]of Object.entries({'before.json':before,'before-projection.json':prior,'prepared-projection.json':prepared,'normal-account-digests.json':otherBefore}))writeFileSync(join(directory,name),JSON.stringify(value),{mode:0o600,flag:'wx'});
   if(!isDeepStrictEqual(JSON.parse(readFileSync(join(directory,'before.json'))),before))throw Error('Before-state backup readback differs');
   writeFileSync(join(directory,'market.json'),marketBytes,{mode:0o600,flag:'wx'});writeFileSync(join(directory,'plan.json'),planBytes,{mode:0o600,flag:'wx'});
   candidate.state.log.push({ts:new Date().toISOString().slice(0,10),action:'demo_completed',reason:'User approved coherent generated demo at workbook date; script-generated costs, roll details, history and reserves; normal accounts excluded.',market_sha256:receipt.marketSha256,source_sha256:candidate.state.demo_workbook.source.sha256});
   await saveInvestor(candidate);const actual=await loadInvestor(before.state.user.id);
   if(!isDeepStrictEqual(actual.state,candidate.state)||!isDeepStrictEqual(actual.state.user,before.state.user)||!isDeepStrictEqual(actual.state.profile,before.state.profile)||!isDeepStrictEqual(actual.state.demo_workbook,before.state.demo_workbook))throw Error('Demo readback differs; inspect retained recovery files before retry');
   prepared.fingerprint=portfolioFingerprint(actual.state);attachDailyChanges(prepared,prior.dailyAggregateHistory??{});
   if(!readPortfolioProjection(actual.state))writePortfolioProjection(prepared);
   await prepareDashboardWireFile(projectionLocation(actual.state.user.id).file);
   if(!readPortfolioProjection(actual.state))throw Error('Prepared generation did not read back');
   const otherAfter=await accountDigests();
   if(!isDeepStrictEqual(otherBefore,otherAfter))throw Error('Normal-account financial digests changed; inspect before claiming isolation');
   Object.assign(receipt,{backup:directory,revision:actual.revision,credentialsPreserved:true,workbookPreserved:true,normalAccountsUnchanged:true});
   writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify(receipt));
 }
}catch(error){console.error(error);process.exitCode=1;}
finally{const{closePool}=await import('../src/books/db.ts');await closePool();release();await db.close();}process.exit(process.exitCode??0);
