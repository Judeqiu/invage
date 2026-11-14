/** Preview/apply source-backed fund metadata from retained account archives.
 * Runs with the exact application environment as its service owner. No API calls.
 * Usage: node --import tsx scripts/repair-fund-metadata.mjs <user UUID> [--apply]
 */
import 'dotenv/config';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
process.env.UTARUS_LOADED_BY_HOST='1';
const [user,...flags]=process.argv.slice(2),apply=flags.includes('--apply');
if(!user||flags.some(f=>f!=='--apply'))throw Error('Usage: repair-fund-metadata.mjs <user UUID> [--apply]');
let database,release;
try{
 database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:error=>{throw error;}});release=bindDatabaseRuntime(database);
 const {resolveDataRoot}=await import('utarus');
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {latestSuccessfulBrokerSyncRun}=await import('../src/brokers/sync-history.ts');
 const {adapters}=await import('../src/brokers/adapter.ts');
 const {prepareFundMetadataProjection}=await import('../src/state/prepare-fund-metadata.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const {prepareDashboardWireFile}=await import('../src/state/dashboard-wire-store.ts');
 const {projectionLocation}=await import('../src/state/projection-files.ts');
 const {holdingBaseKey}=await import('../src/market/position-value.ts');
 const snapshot=await loadInvestor(user),before=structuredClone(snapshot.state),next=structuredClone(before),model=readBrokerAccountModel(before);
 const originalFingerprint=portfolioFingerprint(before),evidence=[],updates=[],unresolved=[];
 for(const c of Object.values(model.connections)){
  const funds=Object.entries(before.portfolio??{}).filter(([,h])=>h.channel===c.channel&&h.instrument==='fund');if(!funds.length)continue;
  const run=latestSuccessfulBrokerSyncRun(user,c.channel);if(!run?.raw_data_id)throw Error('Fund archive evidence unavailable');
  const path=join(resolveDataRoot(),'drive',user,run.raw_data_id),bytes=readFileSync(path),sha=createHash('sha256').update(bytes).digest('hex');
  const kind=run.raw_data_id.endsWith('.xml')?'xml':'json';
  const statement=adapters[c.broker_id].parseToStatement({kind,body:bytes},c.channel,false);
  if(statement.account_id!==c.account_id)throw Error('Fund archive account differs from connection');
  evidence.push({channel:c.channel,path,sha256:sha});
  for(const [key,h]of funds){
   const match=statement.lots.find(l=>l.holding.channel===c.channel&&l.ticker===holdingBaseKey(key)&&l.holding.instrument==='fund');
   if(!match?.holding.fund)throw Error('Retained fund missing from latest account archive');
   const candidate=match.holding;
   if(match.currency!==h.currency||candidate.units!==h.units||candidate.avg_price!==h.avg_price||candidate.fund.mark!==h.fund.mark||candidate.fund.quote_source!==h.fund.quote_source)throw Error('Fund economic evidence changed; metadata-only repair refused');
   if(h.fund.product_class&&candidate.fund.product_class&&h.fund.product_class!==candidate.fund.product_class)throw Error('Fund classification conflict needs review');
   const updated={...h,fund:{...h.fund,...candidate.fund},broker_ref:{...h.broker_ref,...candidate.broker_ref}};
   if(!updated.fund.product_class)unresolved.push({key,reason:'No exact source-backed classification reference is recorded.'});
   if(!isDeepStrictEqual(h,updated)){next.portfolio[key]=updated;updates.push({key,name:updated.fund.name,isin:updated.fund.isin??null,product_class:updated.fund.product_class??null});}
  }
 }
 const receipt={apply,updates,unresolved,source_documents:evidence.map(({path,...e})=>e),completed:false};
 if(updates.length){
  const prepared=prepareFundMetadataProjection(before,next);
  for(const e of evidence)if(createHash('sha256').update(readFileSync(e.path)).digest('hex')!==e.sha256)throw Error('Fund source changed during preparation');
  const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==originalFingerprint)throw Error('Account changed during metadata preparation');
  if(apply){
   const directory=join(resolveDataRoot(),'repairs','fund-metadata',user,new Date().toISOString().replaceAll(':','-'));mkdirSync(directory,{recursive:true,mode:0o700});
   writeFileSync(join(directory,'before.json'),JSON.stringify({portfolio:before.portfolio,projection:readPortfolioProjection(before)}),{mode:0o600,flag:'wx'});
   snapshot.state=next;await saveInvestor(snapshot);const saved=await loadInvestor(user);
   if(!isDeepStrictEqual(saved.state.portfolio,next.portfolio))throw Error('Persisted fund metadata differs from prepared state');
   const existing=readPortfolioProjection(saved.state);
   if(!existing){prepared.fingerprint=portfolioFingerprint(saved.state);const check=await loadInvestor(user);if(check.revision!==saved.revision||portfolioFingerprint(check.state)!==prepared.fingerprint)throw Error('Account changed before projection publication');writePortfolioProjection(prepared);}
   await prepareDashboardWireFile(projectionLocation(user).file);
   receipt.retained_newer_generation=Boolean(existing);receipt.repair_directory=directory;
   const actual=readPortfolioProjection((await loadInvestor(user)).state);if(!actual)throw Error('Saved fund query projection unavailable after repair');
   receipt.valuation_time=actual.calculatedAt;receipt.original_valuation_time=prepared.calculatedAt;
   writeFileSync(join(directory,'receipt.json'),JSON.stringify({...receipt,completed:true},null,2),{mode:0o600});
  }
 }
 receipt.completed=true;console.log(JSON.stringify(receipt));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}finally{release?.();await database?.close();}
