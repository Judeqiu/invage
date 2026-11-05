/** Stage/publish broker-first NAV views from saved quote evidence, without market fetches.
 * stage|publish <current runtime root> <private staging directory> [user UUID]
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
import {buildLivePositions} from '../src/report/dashboard-model.ts';
import {applyBrokerNav} from '../src/report/broker-nav.ts';
import {buildPageProjections} from '../src/report/page-projections.ts';
import {buildBrokerProjections} from '../src/report/broker-projections.ts';
import {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection} from '../src/state/projection-store.ts';
import {prepareDashboardWireFile} from '../src/state/dashboard-wire-store.ts';
import {projectionLocation} from '../src/state/projection-files.ts';
import {readBrokerAccountModel} from '../src/brokers/accounts.ts';
import {getPortfolio} from '../src/state/portfolio-state.ts';
import {attachDailyChanges} from '../src/report/daily-changes.ts';
async function main(){
const [phase,runtimeRoot,stage,selected]=process.argv.slice(2);
if(!['stage','publish'].includes(phase)||![runtimeRoot,stage,process.env.UTARUS_DATA_ROOT].every(p=>p&&isAbsolute(p)))throw Error('Explicit phase, runtime, private staging directory and data root required');
process.env.UTARUS_LOADED_BY_HOST='1';
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(db);
try{
 const {listUserIds}=await import('utarus');
 const {loadInvestor}=await import(pathToFileURL(resolve(runtimeRoot,'src/state/investor-store.ts')).href);
 const old=await import(pathToFileURL(resolve(runtimeRoot,'src/state/projection-store.ts')).href);
 if(phase==='stage'){
  mkdirSync(stage,{recursive:true,mode:0o700});const manifest={prepared:[],unavailable:[]};
  for(const user of selected?[selected]:await listUserIds()){
   const snapshot=await loadInvestor(user),prior=old.readPortfolioProjection(snapshot.state);
   if(!prior?.dashboard.model){manifest.unavailable.push(user);continue;}
   const sourceFingerprint=old.portfolioFingerprint(snapshot.state),key=createHash('sha256').update(user).digest('hex');
   writeFileSync(join(stage,key+'.before.json'),JSON.stringify(prior),{mode:0o600,flag:'wx'});
   const dashboard=structuredClone(prior.dashboard),saved=dashboard.model.live,portfolio=structuredClone(getPortfolio(snapshot.state)),marks={};
   for(const p of saved.positions){
    if(!portfolio[p.ticker]?.option)continue;
    portfolio[p.ticker].option.mark=p.price;
    marks[p.ticker]={mark:p.price,source:p.markSource??'manual',...(p.contractSymbol?{contractSymbol:p.contractSymbol}:{}),...(p.probabilityQuote?{probabilityQuote:p.probabilityQuote}:{}),...(p.providerIv?{providerIv:p.providerIv}:{}),...(p.markNote?{note:p.markNote}:{})};
   }
   const live=buildLivePositions(portfolio,dashboard.equityPrices??{},marks,saved.cashBalances??null,saved.deposits,prior.calculatedAt.slice(0,10),saved.reportingCurrency?{reportingCurrency:saved.reportingCurrency,fxRates:saved.fxRates??{}}:undefined,{resilient:true,allowEmpty:true});
   for(const p of live.positions){
    const previous=saved.positions.find(row=>row.ticker===p.ticker);
    if(previous?.option){p.option=previous.option;if(previous.brokerMark!==undefined)p.brokerMark=previous.brokerMark;}
   }
   const missing=Object.keys(portfolio).filter(key=>!live.positions.some(row=>row.ticker===key));
   if(missing.length)throw Error('Staged valuation still omits source holdings; inspect retained issues');
   applyBrokerNav(live,dashboard.connectionMetrics??{});
   dashboard.model={...dashboard.model,live};
   const pages=buildPageProjections(dashboard);dashboard.pageProjections={positions:pages.positions,insights:pages.insights};dashboard.aggregatedViews=pages.dashboard;
   const prepared={...prior,dashboard,fingerprint:portfolioFingerprint(snapshot.state),brokers:buildBrokerProjections(snapshot.state,dashboard,prior.openTrades.rows,prior.tradeHistory.rows)};
   attachDailyChanges(prepared,prior.dailyAggregateHistory??{});
   const latest=await loadInvestor(user);if(old.portfolioFingerprint(latest.state)!==sourceFingerprint)throw Error('Source changed during staging; stage again from its current generation');
   writeFileSync(join(stage,key+'.prepared.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
   const navReceipt=live=>({totalValue:live.totalValue,positionsValue:live.positionsValue,totalCost:live.totalCost,totalPL:live.totalPL,cashAmount:live.cashAmount,cashBalances:live.cashBalances,fxRates:live.fxRates,navSources:live.navSources,itemizedTotalValue:live.itemizedTotalValue,issues:live.issues,positions:live.positions.map(p=>({ticker:p.ticker,units:p.units,price:p.price,value:p.value,cost:p.cost,pl:p.pl,brokerMark:p.brokerMark,markSource:p.markSource}))});
   writeFileSync(join(stage,key+'.receipt.json'),JSON.stringify({kind:'broker_nav_reconciliation',selected_calculated_at:prior.calculatedAt,source_fingerprint:sourceFingerprint,source_holdings:getPortfolio(snapshot.state),before:navReceipt(prior.dashboard.model.live),staged_replacement:navReceipt(live),broker_metrics:dashboard.connectionMetrics}),{mode:0o600,flag:'wx'});
   manifest.prepared.push({user,key,sourceFingerprint,fingerprint:prepared.fingerprint,calculatedAt:prepared.calculatedAt,before:prior.dashboard.model.live.totalValue,after:live.totalValue,positions:live.positionCount});
  }
  writeFileSync(join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({prepared:manifest.prepared.length,unavailable:manifest.unavailable.length,changes:manifest.prepared.map(({before,after,positions})=>({before,after,positions}))}));
 }else{
  const manifest=JSON.parse(readFileSync(join(stage,'manifest.json'),'utf8'));let published=0,retained=0,changed=0;
  for(const item of manifest.prepared){
   const snapshot=await loadInvestor(item.user);
   if(portfolioFingerprint(snapshot.state)!==item.fingerprint){changed++;continue;}
   const reportDirectory=join(process.env.UTARUS_DATA_ROOT,'drive',item.user);mkdirSync(reportDirectory,{recursive:true,mode:0o700});
   const receiptFile=join(reportDirectory,'nav-reconciliation-'+item.calculatedAt.replace(/[^0-9A-Za-z-]/g,'-')+'.json');
   try{writeFileSync(receiptFile,readFileSync(join(stage,item.key+'.receipt.json')),{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
   const current=readPortfolioProjection(snapshot.state);
   if(current&&current.calculatedAt>item.calculatedAt){retained++;continue;}
   const prepared=JSON.parse(readFileSync(join(stage,item.key+'.prepared.json'),'utf8'));
   if(prepared.fingerprint!==item.fingerprint||prepared.userId!==item.user)throw Error('Staged projection identity mismatch');
   const latest=await loadInvestor(item.user);if(portfolioFingerprint(latest.state)!==item.fingerprint){changed++;continue;}
   writePortfolioProjection(prepared);await prepareDashboardWireFile(projectionLocation(item.user).file);published++;
  }
  console.log(JSON.stringify({published,retainedNewer:retained,sourceChanged:changed}));
 }
}finally{release();await db.close();}

}
await main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
