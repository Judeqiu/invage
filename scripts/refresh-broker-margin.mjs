/** Fetch only Cloud account funds, optionally save margin metrics and rebuild the read model.
 * Run with the full service environment and explicit UTARUS_DATA_ROOT:
 * node --import tsx scripts/refresh-broker-margin.mjs <user> <connection> [--apply]
 * Never changes holdings, cash, orders, history or sync checkpoints.
 */
import 'dotenv/config';
import {isAbsolute,join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openDatabaseRuntime,bindDatabaseRuntime} from 'utarus/database';
const [user,connectionId,flag]=process.argv.slice(2);
if(!user||!connectionId||flag&&flag!=='--apply'||process.argv.length>5) throw Error('Usage: refresh-broker-margin.mjs <user> <connection> [--apply]');
if(!process.env.UTARUS_DATA_ROOT||!isAbsolute(process.env.UTARUS_DATA_ROOT)) throw Error('Set an explicit absolute UTARUS_DATA_ROOT matching the live service.');
process.env.UTARUS_LOADED_BY_HOST='1';
const db=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e;}}),release=bindDatabaseRuntime(db);
try {
  const {saveState}=await import('utarus');
  const {loadInvestor}=await import('../src/state/investor-store.ts');
  const {readBrokerAccountModel}=await import('../src/brokers/accounts.ts');
  const {withBrokerSyncLease}=await import('../src/brokers/sync-lease.ts');
  const {fetchMooMooFundsSnapshot}=await import('../src/moomoo/moomoo-client.ts');
  const {parseSignAlg}=await import('../src/moomoo/moomoo-sign.ts');
  const {mapMooMooMarginMetrics,parseNum}=await import('../src/moomoo/moomoo-map.ts');
  const {assertBrokerConnectionMetrics}=await import('../src/state/portfolio-state.ts');
  const initial=await loadInvestor(user);
  await withBrokerSyncLease(initial.state.user.id,connectionId,async()=>{
    const snapshot=await loadInvestor(user),model=readBrokerAccountModel(snapshot.state),conn=model.connections[connectionId];
    if(!conn||!conn.enabled||!['futubull','moomoo'].includes(conn.broker_id)||!conn.account_id) throw Error('An enabled, bound FUTU/Moomoo Cloud account is required.');
    const source=model.sources[conn.source_id].credentials;
    if(!source.app_key||!source.private_key) throw Error('This account does not have Cloud API credentials.');
    const funds=await fetchMooMooFundsSnapshot({broker:conn.broker_id,app_key:source.app_key,private_key:source.private_key,sign_alg:parseSignAlg(source.sign_alg),acc_id:conn.account_id});
    const metrics=mapMooMooMarginMetrics(funds.funds.d,funds.fetched_at.slice(0,10));
    if(metrics?.excess_liquidity==null) throw Error('The broker did not return net assets, valid maintenance margin and an explicit currency. No metrics were saved.');
    const fundAssets=parseNum(funds.funds.d?.funds_assets);
    if(fundAssets!=null&&fundAssets>=0) metrics.fund_assets=fundAssets;
    assertBrokerConnectionMetrics(metrics);
    const directory=join(process.env.UTARUS_DATA_ROOT,'ops','excess-liquidity',randomUUID());
    mkdirSync(directory,{recursive:true,mode:0o700});
    writeFileSync(join(directory,'evidence.json'),JSON.stringify({userId:snapshot.state.user.id,connectionId,accountId:conn.account_id,previousMetrics:conn.metrics??null,funds,metrics}),{flag:'wx',mode:0o600});
    if(flag==='--apply') {
      snapshot.state.broker_connections[connectionId].metrics=metrics;
      snapshot.state.log.push({ts:funds.fetched_at.slice(0,10),action:'broker_margin_refreshed',connector_id:connectionId,
        reason:'Operator refreshed broker funds and calculated excess liquidity from broker net assets minus maintenance margin; holdings, cash and history unchanged.',evidence:directory});
      await saveState(snapshot.state,snapshot.revision);
    }
    console.log(JSON.stringify({connectionId,fetchedAt:funds.fetched_at,saved:flag==='--apply',metrics,evidence:directory}));
  });
  if(flag==='--apply') {
    const {createPortfolioProjectionRefresher}=await import('../src/state/portfolio-projections.ts');
    await createPortfolioProjectionRefresher()(initial.state.user.id);
    console.log(JSON.stringify({projection:'ready'}));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Margin refresh failed.');
  process.exitCode=1;
} finally {
  const {closePool}=await import('../src/books/db.ts');
  await closePool();release();await db.close();
}
