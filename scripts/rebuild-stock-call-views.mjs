/** Stage/publish stock-table quantity comparisons using saved valuations only.
 * stage|publish <runtime root> <private staging directory>
 * Run from a clean committed repair checkout with the service environment and data root.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
import {buildPageProjections} from '../src/report/page-projections.ts';
import {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection} from '../src/state/projection-store.ts';
const [phase,runtimeRoot,stage]=process.argv.slice(2);
if(!['stage','publish'].includes(phase)||![runtimeRoot,stage,process.env.UTARUS_DATA_ROOT].every(p=>p&&isAbsolute(p)))throw Error('Explicit phase, runtime, private staging directory and data root required');
process.env.UTARUS_LOADED_BY_HOST='1';
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try{
 const {listUserIds}=await import('utarus');
 const {loadInvestor}=await import(pathToFileURL(resolve(runtimeRoot,'src/state/investor-store.ts')).href);
 const old=await import(pathToFileURL(resolve(runtimeRoot,'src/state/projection-store.ts')).href);
 if(phase==='stage'){
  mkdirSync(stage,{recursive:true,mode:0o700});const manifest={prepared:[],unavailable:[]};
  for(const user of await listUserIds()){
   const snapshot=await loadInvestor(user),prior=old.readPortfolioProjection(snapshot.state);
   if(!prior){manifest.unavailable.push(user);continue;}
   const key=createHash('sha256').update(user).digest('hex');
   writeFileSync(join(stage,key+'.before.json'),JSON.stringify(prior),{mode:0o600,flag:'wx'});
   const update=dashboard=>{
    const calculated=buildPageProjections(dashboard).positions;
    const views=dashboard.pageProjections?.positions;
    return {calculated,views};
   };
   const replace=(saved,calculated)=>{
    for(const [channel,view] of Object.entries(saved)){
     const next=calculated[channel];if(!next)throw Error('Saved stock scope missing');
     const strip=v=>{const copy=structuredClone(v);for(const s of [...copy.stocks,...copy.funds])delete s.callShares;delete copy.totals.callShares;return copy;};
     if(!isDeepStrictEqual(strip(view),strip(next)))throw Error('Repair changes values outside the stock/call comparison');
     for(const row of [...view.stocks,...view.funds])row.callShares=[...next.stocks,...next.funds].find(r=>r.ticker===row.ticker)?.callShares??null;
     view.totals.callShares=next.totals.callShares;
    }
   };
   const main=update(prior.dashboard);replace(main.views,main.calculated);
   for(const b of Object.values(prior.brokers))replace(b.pages.positions,buildPageProjections(b.dashboard).positions);
   const sourceFingerprint=old.portfolioFingerprint(snapshot.state);
   prior.fingerprint=portfolioFingerprint(snapshot.state);prior.calculatedAt=new Date().toISOString();
   const latest=await loadInvestor(user);if(old.portfolioFingerprint(latest.state)!==sourceFingerprint)throw Error('Account changed during staging');
   writeFileSync(join(stage,key+'.prepared.json'),JSON.stringify(prior),{mode:0o600,flag:'wx'});
   manifest.prepared.push({user,key,sourceFingerprint,fingerprint:prior.fingerprint,calculatedAt:prior.calculatedAt});
  }
  writeFileSync(join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({prepared:manifest.prepared.length,unavailable:manifest.unavailable.length}));
 }else{
  const manifest=JSON.parse(readFileSync(join(stage,'manifest.json'),'utf8')),published=[],retained=[];
  for(const item of manifest.prepared){
   const snapshot=await loadInvestor(item.user);if(portfolioFingerprint(snapshot.state)!==item.fingerprint)throw Error('Account changed before publication; retain staged evidence and refresh from current state');
   const current=readPortfolioProjection(snapshot.state);
   if(current&&current.calculatedAt>=item.calculatedAt){retained.push(item.user);continue;}
   const prepared=JSON.parse(readFileSync(join(stage,item.key+'.prepared.json'),'utf8'));
   if(prepared.fingerprint!==item.fingerprint||prepared.userId!==item.user)throw Error('Staged projection identity mismatch');
   writePortfolioProjection(prepared);
   if(!readPortfolioProjection(snapshot.state))throw Error('Published projection failed readback');
   published.push(item.user);
  }
  const receipt={published,retained};writeFileSync(join(stage,'publication.json'),JSON.stringify(receipt),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({published:published.length,retained:retained.length}));
 }
}catch(error){console.error(error);process.exitCode=1;}finally{const {closePool}=await import('../src/books/db.ts');await closePool();release();await db.close();}
process.exit(process.exitCode??0);
