/** Evidence-backed position-effect recovery. Preview by default.
 * node --import tsx scripts/recover-execution-effects.mjs <user> <statement-directory-relative-to-user-drive> [--apply]
 * Run as the service owner with all service EnvironmentFiles and absolute UTARUS_DATA_ROOT.
 * Fetches broker evidence; never changes holdings, cash, execution money or source dates.
 */
import 'dotenv/config';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';

const [user,directory,flag]=process.argv.slice(2);
if(!user||!directory||flag&&flag!=='--apply'||!process.env.UTARUS_DATA_ROOT?.startsWith('/'))throw Error('Provide user, retained statement directory, optional --apply, and an absolute data root');
process.env.UTARUS_LOADED_BY_HOST='1';
const database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),unbind=bindDatabaseRuntime(database);
try {
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel,combinedCredentials}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const {recoverStatementEffects,recoverSnapshotEffects,applyEffectRecovery,evidenceHash,executionScopeKey}=await import('../src/brokers/execution-effect-recovery.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const {prepareExecutionImportProjection}=await import('../src/state/prepare-execution-import.ts');
 const {prepareDashboardWireFile}=await import('../src/state/dashboard-wire-store.ts');
 const {projectionLocation}=await import('../src/state/projection-files.ts');
 const initial=await loadInvestor(user),model=readBrokerAccountModel(initial.state);
 const ids=Object.keys(model.connections).sort();
 const lock=async i=>i<ids.length?withBrokerSyncLease(initial.state.user.id,ids[i],()=>lock(i+1)):work();
 async function work() {
  const snapshot=await loadInvestor(user),state=snapshot.state,connections=Object.values(readBrokerAccountModel(state).connections);
  const root=realpathSync(join(process.env.UTARUS_DATA_ROOT,'drive',state.user.id)),sourceDir=realpathSync(resolve(root,directory));
  if(!sourceDir.startsWith(root+'/'))throw Error('Statement directory is outside the selected user drive');
  const prior=readPortfolioProjection(state);if(!prior)throw Error('Wait for a valid saved portfolio generation before recovery');
  const fingerprint=portfolioFingerprint(state),artifacts=[],sourceFiles=[];
  const artifact=(data,kind,reference)=>{
   const bytes=Buffer.from(JSON.stringify(data)),sha=evidenceHash(bytes),id='broker-effect-recovery/'+sha+'.json';
   artifacts.push({id,bytes});return {kind,source_sha256:sha,source_file_id:id,reference};
  };
  const changes=[],report={statement:{},tiger:{},webull:{checked:0,recovered:0,missingIntent:0,failed:0}};
  const ibkr=connections.filter(c=>c.broker_id==='ibkr');
  if(ibkr.length!==1)throw Error('Statement recovery requires one explicit IBKR account');
  const sources=readdirSync(sourceDir).filter(f=>f.endsWith('.csv')).sort().map(name=>{
   const path=join(sourceDir,name),bytes=readFileSync(path);sourceFiles.push({path,sha:evidenceHash(bytes)});
   return {file_id:relative(root,path),bytes};
  });
  const statement=recoverStatementEffects(state,sources,{channel:ibkr[0].channel,account_id:ibkr[0].account_id});
  changes.push(...statement.changes);report.statement={recovered:statement.changes.length,unresolved:statement.unresolved.length,feeDifferencesPreserved:statement.feeDifferences};

  const archives=broker=>{
   const result=[];
   for(const directory of ['broker-sync/'+broker,broker+'-raw']){
    const dir=join(root,directory);if(!existsSync(dir))continue;
    for(const file of readdirSync(dir).filter(f=>f.endsWith('.json')).sort().reverse())result.push(JSON.parse(readFileSync(join(dir,file),'utf8')));
   }
   return result;
  };
  for(const connection of connections.filter(c=>c.broker_id==='tiger'&&c.enabled)){
   try {
   const history=Object.values(state.broker_history??{}).find(h=>h.channel===connection.channel&&h.account_id===connection.account_id);
   if(!history?.executions.some(e=>e.effect==='unknown'))continue;
   const raw=archives('tiger').find(r=>r.account===connection.account_id&&r.gateway);
   if(!raw)throw Error('No account-bound Tiger archive');
   const credentials=combinedCredentials(readBrokerAccountModel(state),connection),through=new Date().toISOString();
   const {tigerExecute}=await import('../src/tiger/tiger-client.ts');
   const responses=[],transactions=[],seen=new Set();let token='';
   for(;;){
    if(responses.length)await new Promise(r=>setTimeout(r,1000));
    const response=await tigerExecute({gateway:raw.gateway,credentials,method:'order_transactions',fetchImpl:fetch,signal:AbortSignal.timeout(15000),
     biz:{account:connection.account_id,sec_type:'OPT',start_date:Date.parse(history.sync.through),end_date:Date.parse(through),limit:100,page_token:token}});
    if(![0,'0'].includes(response.code)||!Array.isArray(response.data?.items))throw Error('Tiger tail coverage unavailable');
    responses.push(response);transactions.push(...response.data.items);
    const next=response.data.nextPageToken;if(!next)break;if(seen.has(next))throw Error('Tiger tail pagination repeated');seen.add(next);token=next;
   }
   const tail={channel:connection.channel,account_id:connection.account_id,from:history.sync.through,through,complete:true,transactions};
   const evidence=artifact({schema:'invage.effect-proof.v1',scope:{channel:connection.channel,account_id:connection.account_id},tail,responses,
    retainedHistorySha256:evidenceHash(JSON.stringify(history)),observations:state.option_observations??[]},'broker_positions','Complete option-history tail and retained before/after broker observations');
   const found=recoverSnapshotEffects(state,history,tail,evidence);changes.push(...found);report.tiger={recovered:found.length,tailPages:responses.length};
   } catch(error) {report.tiger={deferred:true,reason:error.message};}
  }
  for(const connection of connections.filter(c=>c.broker_id==='webull'&&c.enabled)){
   const unknown=(state.option_executions??[]).filter(e=>e.channel===connection.channel&&e.account_id===connection.account_id&&e.effect==='unknown');
   const rawArchives=archives('webull').filter(r=>r.account_id===connection.account_id),orders=new Map();
   for(const raw of rawArchives)for(const group of raw.option_history??[])for(const o of group.orders??[]){if(!orders.has(String(o.order_id)))orders.set(String(o.order_id),{raw,group,order:o});}
   const credentials=combinedCredentials(readBrokerAccountModel(state),connection);
   const {webullGet}=await import('../src/webull/webull-client.ts');
   for(const e of unknown){
    const source=orders.get(e.execution_id.replace(/^order:/,''));if(!source){report.webull.failed++;continue;}
    if(report.webull.checked)await new Promise(r=>setTimeout(r,1000));
    report.webull.checked++;
    try{
     const {raw,group,order}=source,clientId=order.client_order_id??group.client_order_id;
     if(typeof clientId!=='string'||!clientId)throw Error('Original Webull client order ID unavailable');
     const response=await webullGet({host:raw.host,path:'/trading/orders/get',query:{account_id:connection.account_id,order_id:String(order.order_id),client_order_id:clientId},credentials,fetchImpl:fetch,signal:AbortSignal.timeout(15000)});
     const detail=response.data??response;
     if(detail.account_id!=null&&String(detail.account_id)!==connection.account_id||detail.client_order_id!==clientId||!Array.isArray(detail.orders))throw Error('Webull detail binding unavailable');
     const exact=detail.orders.filter(o=>String(o.order_id)===String(order.order_id));if(exact.length!==1)throw Error('Webull exact child order unavailable');
     const intent=exact[0].position_intent;
     const evidence=artifact({schema:'invage.effect-proof.v1',scope:{channel:connection.channel,account_id:connection.account_id},request:{order_id:order.order_id,client_order_id:clientId},response},'broker_order','Exact child order position_intent');
     if(intent==null){report.webull.missingIntent++;continue;}
     if(!['BUY_TO_OPEN','BUY_TO_CLOSE','SELL_TO_OPEN','SELL_TO_CLOSE'].includes(intent)||!intent.startsWith(e.side.toUpperCase()+'_'))throw Error('Webull position intent contradicts recorded side');
     changes.push({channel:e.channel,account_id:e.account_id,execution_id:e.execution_id,effect:intent.endsWith('_OPEN')?'open':'close',evidence:[evidence]});report.webull.recovered++;
    }catch(error){report.webull.failed++;if(String(error.code)==='401'||/HTTP 401/.test(error.message)){report.webull.authenticationUnavailable=true;break;}}
   }
  }
  const next=applyEffectRecovery(state,changes),byKey=new Map((state.option_executions??[]).map(e=>[executionScopeKey(e),e]));
  const changed=next.option_executions.filter(e=>e.effect!==byKey.get(executionScopeKey(e)).effect).length;
  const receipt={apply:flag==='--apply',changed,...report,unknownBefore:(state.option_executions??[]).filter(e=>e.effect==='unknown').length,unknownAfter:next.option_executions.filter(e=>e.effect==='unknown').length};
  if(!changed||flag!=='--apply'){console.log(JSON.stringify({...receipt,completed:true}));return;}
  // Archive the evidence before calculation so archive inventories remain stable.
  for(const {id,bytes} of artifacts){const path=join(root,id);mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});
   if(existsSync(path)){if(!readFileSync(path).equals(bytes))throw Error('Recovery evidence archive conflict');}
   else writeFileSync(path,bytes,{mode:0o600,flag:'wx'});
  }
  const brokers=[...new Set(changes.map(c=>connections.find(x=>x.channel===c.channel&&x.account_id===c.account_id).broker_id))];
  const prepared=await prepareExecutionImportProjection(state,next.option_executions,brokers,next.broker_history,state.option_events,{preserveDailyHistory:true});
  if(!isDeepStrictEqual(prior.dailyAggregateHistory,prepared.dailyAggregateHistory))throw Error('Recovery would rewrite daily checkpoints');
  const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==fingerprint)throw Error('Source changed during recovery preparation');
  for(const source of sourceFiles)if(evidenceHash(readFileSync(source.path))!==source.sha)throw Error('Statement changed during recovery preparation');
  const backup=join(process.env.UTARUS_DATA_ROOT,'repairs','execution-effects',randomUUID());mkdirSync(backup,{recursive:true,mode:0o700});
  writeFileSync(join(backup,'before.json'),JSON.stringify({revision:snapshot.revision,option_executions:state.option_executions,broker_history:state.broker_history,option_identities:state.option_identities}),{mode:0o600,flag:'wx'});
  writeFileSync(join(backup,'prepared-projection.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
  next.log=[...state.log,{ts:new Date().toISOString().slice(0,10),action:'execution_effects_recovered',reason:'User-authorized position-effect recovery from account-bound broker statements, explicit order intent and reconciled broker snapshots; original cash, fees, dates and holdings preserved.',changed}];
  snapshot.state=next;await saveInvestor(snapshot);
  const actual=await loadInvestor(user);if(!isDeepStrictEqual(actual.state,snapshot.state))throw Error('Persisted state differs; keep recovery artifacts');
  prepared.fingerprint=portfolioFingerprint(actual.state);
  const current=readPortfolioProjection(actual.state);if(!current||current.calculatedAt<prepared.calculatedAt)writePortfolioProjection(prepared);
  await prepareDashboardWireFile(projectionLocation(actual.state.user.id).file);
  if(!readPortfolioProjection(actual.state))throw Error('Recovery has no valid saved projection');
  receipt.savedRevision=actual.revision;receipt.backup=backup;receipt.completed=true;
  writeFileSync(join(backup,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(receipt));
 }
 await lock(0);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{const {closePool}=await import('../src/books/db.ts');await closePool();unbind();await database.close();}
