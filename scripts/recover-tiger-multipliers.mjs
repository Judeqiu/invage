/** <user UUID> <complete API fills.json.gz> --sha256=HEX [--apply]
 * Preview by default. Uses the service environment and saved valuations; no broker or quote calls.
 */
import 'dotenv/config';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
import {recoverTigerHistoryMultipliers} from '../src/tiger/tiger-cash-metadata.ts';
import {mergeBrokerHistory,optionExecutionsFromHistory} from '../src/brokers/history.ts';
import {mergeOptionExecutions,addDecimals,negateDecimal} from '../src/brokers/option-executions.ts';
import {scaledHistoryQuantity} from '../src/brokers/history-values.ts';
import {tigerHistoryTime} from '../src/tiger/tiger-markets.ts';
const [user,file,...flags]=process.argv.slice(2),expected=flags.find(f=>f.startsWith('--sha256='))?.slice(9);
if(!user||!file||!/^[a-f0-9]{64}$/.test(expected??'')||flags.some(f=>f!=='--apply'&&!/^--sha256=[a-f0-9]{64}$/.test(f))||!process.env.UTARUS_DATA_ROOT?.startsWith('/'))throw Error('Explicit user, API source checksum and absolute data root required');
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>addDecimals(v,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
function readEvidence(){
 const bytes=readFileSync(file);if(hash(bytes)!==expected)throw Error('API evidence checksum mismatch');
 const data=JSON.parse(gunzipSync(bytes));
 if(data.complete!==true||data.from!=='2000-01-01T00:00:00.000Z'||!Number.isFinite(Date.parse(data.through))||!data.pages?.length||!Array.isArray(data.rows))throw Error('Incomplete API collection');
 const rows=data.pages.flatMap((page,i)=>{
  if(![0,'0'].includes(page.code)||!Array.isArray(page.data?.items)||Boolean(page.data.nextPageToken)!==(i<data.pages.length-1))throw Error('Incomplete API pagination');
  return page.data.items;
 });
 if(!isDeepStrictEqual(rows,data.rows)||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>String(r.accountId)!==data.account||r.secType!=='OPT'))throw Error('API account/identity mismatch');
 return data;
}
const source=readEvidence();process.env.UTARUS_LOADED_BY_HOST='1';
const database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}),release=bindDatabaseRuntime(database);
try{
 const {resolveDataRoot}=await import('utarus');
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const {prepareExecutionImportProjection}=await import('../src/state/prepare-execution-import.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const initial=await loadInvestor(user);
 const matches=Object.entries(readBrokerAccountModel(initial.state).connections).filter(([,c])=>c.broker_id==='tiger'&&c.account_id===source.account);
 if(matches.length!==1)throw Error('API source has no unique Tiger connection');const [id,connection]=matches[0];
 await withBrokerSyncLease(user,id,async()=>{
  const snapshot=await loadInvestor(user),current=snapshot.state.broker_history?.[id];
  if(!current||current.broker_id!=='tiger'||current.account_id!==source.account||current.channel!==connection.channel)throw Error('Retained history scope mismatch');
  const fresh=new Map(source.rows.map(r=>[r.id,r]));
  const options=current.executions.filter(e=>e.instrument==='option');
  if(options.length!==fresh.size)throw Error('Fresh and retained fill sets differ; reconcile before applying');
  for(const e of options){
   const r=fresh.get(e.id),o=e.option;
   if(!r||!o||!e.symbol||e.price===null||e.gross_cash===null||r.orderId!==e.order_id||r.symbol!==e.symbol||r.currency!==e.currency||r.action.toLowerCase()!==e.side||
      canonical(scaledHistoryQuantity(r.filledQuantity,r.filledQuantityScale??0))!==canonical(e.quantity)||canonical(r.filledPrice)!==canonical(e.price)||
      canonical(e.side==='buy'?negateDecimal(r.filledAmount):r.filledAmount)!==canonical(e.gross_cash)||r.right.toLowerCase()!==o.right||canonical(r.strike)!==canonical(o.strike)||
      r.expiry.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')!==o.expiry||tigerHistoryTime(r.transactionTime,e.clock)!==e.executed_at)throw Error('Fresh API fill conflicts with retained evidence');
  }
  const result=recoverTigerHistoryMultipliers(current.executions);
  if(result.gaps.length)throw Error('Conflicting contract evidence remains; no repair applied');
  const history=mergeBrokerHistory(current,{...current,executions:result.executions});
  for(const before of current.executions){const after=history.executions.find(e=>e.id===before.id);if(!after||!isDeepStrictEqual({...after,multiplier:before.multiplier},before))throw Error('Repair modifies broker evidence other than missing multiplier');}
  const before=snapshot.state.option_executions??[],merged=mergeOptionExecutions(before,optionExecutionsFromHistory(history));
  for(const row of before)if(!isDeepStrictEqual(row,merged.find(e=>e.channel===row.channel&&e.account_id===row.account_id&&e.execution_id===row.execution_id)))throw Error('Repair changes an existing projected execution');
  if(recoverTigerHistoryMultipliers(history.executions).recovered.length)throw Error('Repair is not idempotent');
  const histories={...snapshot.state.broker_history,[id]:history};
  const prepared=result.recovered.length?await prepareExecutionImportProjection(snapshot.state,merged,'tiger',histories):readPortfolioProjection(snapshot.state);
  if(!prepared)throw Error('No saved projection available');
  const scoped=merged.filter(e=>e.channel===connection.channel&&e.account_id===source.account);
  const receipt={apply:flags.includes('--apply'),source_sha256:expected,sourceThrough:source.through,recovered:result.recovered.length,added:merged.length-before.length,
   optionExecutions:scoped.length,unknownFees:scoped.filter(e=>e.commission===null).length,idempotent:true,
   monthly:Object.fromEntries([...new Set(scoped.map(e=>e.executed_at.slice(0,7)))].sort().map(month=>[month,addDecimals('0',...scoped.filter(e=>e.executed_at.startsWith(month)).map(e=>e.gross_premium))]))};
  if(flags.includes('--apply')&&result.recovered.length){
   readEvidence();const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(snapshot.state))throw Error('Account changed during preparation');
   const repair=join(resolveDataRoot(),'repairs','tiger-multipliers',randomUUID());mkdirSync(repair,{recursive:true,mode:0o700});
   writeFileSync(join(repair,'before.json'),JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
   writeFileSync(join(repair,'prepared-projection.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
   copyFileSync(file,join(repair,'api-fills.json.gz'));
   snapshot.state.broker_history=histories;snapshot.state.option_executions=merged;
   snapshot.state.log.push({ts:new Date().toISOString().slice(0,10),action:'tiger_multiplier_recovery',reason:'User approved exact cash-derived contract sizes; all fresh account-bound API fills agree with retained broker cash, quantities and prices. Existing cash, fees and trade intent preserved.',source_sha256:expected,recovered:result.recovered.length,added:receipt.added});
   await saveInvestor(snapshot);const actual=await loadInvestor(user);
   if(!isDeepStrictEqual(actual.state,snapshot.state))throw Error('Persisted state differs; retain staged recovery artifacts');
   prepared.fingerprint=portfolioFingerprint(actual.state);const newer=readPortfolioProjection(actual.state);
   if(!newer||newer.calculatedAt<prepared.calculatedAt)writePortfolioProjection(prepared);
   receipt.projection_ready=Boolean(readPortfolioProjection(actual.state));receipt.saved_revision=actual.revision;receipt.backup=repair;
   if(!receipt.projection_ready)throw Error('Persisted repair has no valid projection');
   writeFileSync(join(repair,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify(receipt));
 });
}catch(error){console.error(error);process.exitCode=1;}
finally{const {closePool}=await import('../src/books/db.ts');await closePool();release();await database.close();}
