/** Import approved offline journal rows. Never fetches quotes or changes holdings/cash.
 * <user UUID> <journal.json> <original.xlsx> --year=YYYY --multiplier=N --journal-sha256=HEX [--apply]
 * Use the verified service environment and an absolute UTARUS_DATA_ROOT. Dry run by default.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

const [user, journalFile, originalFile, ...flags] = process.argv.slice(2);
const year = Number(flags.find(f=>f.startsWith('--year='))?.slice(7));
const multiplier = flags.find(f=>f.startsWith('--multiplier='))?.slice(13);
const expected = flags.find(f=>f.startsWith('--journal-sha256='))?.slice(17);
if (!user || !journalFile || !originalFile || !year || !multiplier || !/^[a-f0-9]{64}$/.test(expected ?? '') ||
 flags.some(f=>f!=='--apply'&&!/^--year=\d{4}$/.test(f)&&!/^--multiplier=\d+(?:\.\d+)?$/.test(f)&&!/^--journal-sha256=[a-f0-9]{64}$/.test(f)) ||
 !process.env.UTARUS_DATA_ROOT?.startsWith('/')) throw Error('Explicit source files, year, approved multiplier, journal SHA256 and data root are required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const journalBytes = readFileSync(journalFile), originalBytes = readFileSync(originalFile);
if (hash(journalBytes) !== expected) throw Error('Extracted journal SHA256 mismatch');
const rows = JSON.parse(journalBytes.toString());
const manifest = JSON.parse(readFileSync(join(resolve(journalFile,'..'),'manifest.json'),'utf8'));
if (manifest.scope?.user_id!==user || hash(originalBytes)!==manifest.source?.sha256) throw Error('Source account or workbook SHA256 mismatch');
process.env.UTARUS_LOADED_BY_HOST='1';
const database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}}), release=bindDatabaseRuntime(database);
try {
 const {resolveDataRoot}=await import('utarus');
 const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.ts');
 const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
 const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
 const {reconstructSpreadsheetTrades}=await import('../src/brokers/spreadsheet-trades.ts');
 const {mergeOptionExecutions,addDecimals}=await import('../src/brokers/option-executions.ts');
 const {prepareExecutionImportProjection}=await import('../src/state/prepare-execution-import.ts');
 const {portfolioFingerprint,readPortfolioProjection,writePortfolioProjection}=await import('../src/state/projection-store.ts');
 const initial=await loadInvestor(user);
 const matches=Object.entries(readBrokerAccountModel(initial.state).connections).filter(([,c])=>c.broker_id==='ibkr'&&c.channel===manifest.scope.channel&&c.account_id===manifest.scope.account_id);
 if(matches.length!==1)throw Error('Source has no unique configured IBKR account');
 const [connectionId,connection]=matches[0];
 await withBrokerSyncLease(user,connectionId,async()=>{
  const snapshot=await loadInvestor(user), before=snapshot.state.option_executions??[];
  const sourceId=relative(join(resolveDataRoot(),'drive',user),resolve(originalFile)).split('\\').join('/');
  if(sourceId.startsWith('../')||sourceId.startsWith('/'))throw Error('Original workbook must be retained in the target account Drive');
  const result=reconstructSpreadsheetTrades(rows,{channel:connection.channel,account_id:connection.account_id,source_sha256:manifest.source.sha256,source_file_id:sourceId,sheet:manifest.source.sheet,year,approved_multiplier:multiplier});
  const incomingIds=new Set(result.executions.map(e=>e.execution_id));
  if(before.some(e=>e.channel===connection.channel&&e.account_id===connection.account_id&&e.executed_at.startsWith(String(year))&&!incomingIds.has(e.execution_id)))throw Error('Existing year records require overlap review');
  const merged=mergeOptionExecutions(before,result.executions);
  const sameMoney=(a,b)=>isDeepStrictEqual(a,b);
  for(const e of before)if(!sameMoney(e,merged.find(m=>m.channel===e.channel&&m.account_id===e.account_id&&m.execution_id===e.execution_id)))throw Error('Import changes an existing trade');
  const added=merged.length-before.length;
  const prepared=added?await prepareExecutionImportProjection(snapshot.state,merged,'ibkr'):readPortfolioProjection(snapshot.state);
  if(!prepared)throw Error('Saved projection unavailable');
  const sum=values=>addDecimals('0',...values);
  const receipt={apply:flags.includes('--apply'),added,source_sha256:manifest.source.sha256,journal_sha256:expected,multiplier,
   accepted_rows:result.executions.map(e=>e.spreadsheet_source.row),review_rows:result.review.map(r=>({row:r.row,reasons:r.reasons})),
   gross_cash:sum(result.executions.map(e=>e.gross_premium)),fee_cash:sum(result.executions.map(e=>e.commission)),
   monthly:Object.fromEntries([...new Set(result.executions.map(e=>e.executed_at.slice(0,7)))].sort().map(month=>[month,sum(result.executions.filter(e=>e.executed_at.startsWith(month)).map(e=>e.gross_premium))]))};
  if(flags.includes('--apply')&&added){
   if(hash(readFileSync(journalFile))!==expected||hash(readFileSync(originalFile))!==manifest.source.sha256)throw Error('Source changed during preparation');
   const latest=await loadInvestor(user);if(latest.revision!==snapshot.revision||portfolioFingerprint(latest.state)!==portfolioFingerprint(snapshot.state))throw Error('Account changed during preparation');
   const directory=join(resolveDataRoot(),'repairs','spreadsheet-trades',randomUUID());mkdirSync(directory,{recursive:true,mode:0o700});
   writeFileSync(join(directory,'before.json'),JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
   writeFileSync(join(directory,'prepared-projection.json'),JSON.stringify(prepared),{mode:0o600,flag:'wx'});
   const preserved=structuredClone({portfolio:snapshot.state.portfolio,cash:snapshot.state.cash,broker_history:snapshot.state.broker_history,option_events:snapshot.state.option_events});
   snapshot.state.option_executions=merged;
   snapshot.state.log.push({ts:new Date().toISOString().slice(0,10),action:'spreadsheet_trade_import',reason:'User-approved manual date-only trades; credit=sell, debit=buy, quantities=contracts, approved multiplier, unknown position effect; ambiguous rows retained for review.',source_sha256:manifest.source.sha256,source_file_id:sourceId,added,approved_multiplier:multiplier});
   await saveInvestor(snapshot);
   const actual=await loadInvestor(user);
   if(!isDeepStrictEqual(actual.state,snapshot.state)||!isDeepStrictEqual(preserved,{portfolio:actual.state.portfolio,cash:actual.state.cash,broker_history:actual.state.broker_history,option_events:actual.state.option_events}))throw Error('Saved state differs; retain staged artifacts for recovery');
   prepared.fingerprint=portfolioFingerprint(actual.state);
   const current=readPortfolioProjection(actual.state);
   if(!current||current.calculatedAt<prepared.calculatedAt)writePortfolioProjection(prepared);
   receipt.projection_ready=Boolean(readPortfolioProjection(actual.state));receipt.saved_revision=actual.revision;receipt.backup=directory;
   if(!receipt.projection_ready)throw Error('Saved import has no valid projection; retain staged artifacts for recovery');
   writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600,flag:'wx'});
  }
  console.log(JSON.stringify(receipt));
 });
} catch(error) { console.error(error); process.exitCode=1; }
finally { const {closePool}=await import('../src/books/db.ts');await closePool();release();await database.close(); }
