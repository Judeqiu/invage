/** Read-only research fetch, never deploys or imports state.
 * node --import tsx scripts/fetch-broker-history.mjs <UUID|all> <absolute-output-dir>
 * Run with the account host's environment. Output is sensitive, mode 0700/0600.
 * An isolated committed script may use INVAGE_RESEARCH_MODULE_ROOT for installed clients.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';
import { collectPages, assertAccountRows, flexYearWindows, summarizeFlex } from './lib/broker-history-research.mjs';
const [user, output] = process.argv.slice(2);
if (!user || !output || !isAbsolute(output) || process.argv.length !== 4) throw new Error('Usage: fetch-broker-history.mjs <UUID|all> <absolute-output-dir>');
mkdirSync(output,{recursive:true,mode:0o700});
if (statSync(output).mode & 0o077) throw new Error('Research output directory must be private (0700)');
const root = resolve(process.env.INVAGE_RESEARCH_MODULE_ROOT ?? new URL('../',import.meta.url).pathname);
const module = path => import(pathToFileURL(join(root,path)).href);
process.env.UTARUS_LOADED_BY_HOST='1';
const {readBrokerAccountModel, combinedCredentials}=await module('src/brokers/accounts.ts');
const {redactSecrets}=await module('src/brokers/connections.ts');
process.env.UTARUS_LOADED_BY_HOST='1';
const database=await openDatabaseRuntime({env:process.env,mode:'personal',onError:e=>{throw e}});
const release=bindDatabaseRuntime(database);const reports=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Bound every HTTP request; do not allow broker hangs to stall the whole research job.
const timedFetch=(url,opts={})=>fetch(url,{...opts,signal:AbortSignal.timeout(30000)});
try {
 for(const id of user==='all'?await database.users.listIds('active'):[user]) {
  const snapshot=await database.users.readById(id);const model=readBrokerAccountModel(snapshot.state);
  for(const [connectionId,c] of Object.entries(model.connections)) {
   if(!c.enabled||!c.account_id||!['tiger','webull','ibkr'].includes(c.broker_id))continue;
   const credentials=combinedCredentials(model,c);const dir=join(output,id,c.channel);mkdirSync(dir,{recursive:true,mode:0o700});
   const report={user:id,name:snapshot.state.profile?.display_name,broker:c.broker_id,channel:c.channel,connection:connectionId,requestedAt:new Date().toISOString(),status:'partial',files:[],gaps:[],stateModified:false};
   const safeError=e=>redactSecrets(e instanceof Error?e.message:String(e),Object.values(credentials));
   function save(name,data){const body=typeof data==='string'?data:JSON.stringify(data);writeFileSync(join(dir,name),body,{mode:0o600,flag:'wx'});report.files.push({name,sha256:createHash('sha256').update(body).digest('hex')});}
   const section=async(name,run)=>{try{return await run();}catch(e){report.gaps.push({section:name,reason:safeError(e)});return null;}};
   try {
    if(c.broker_id==='tiger') {
     const {resolveTigerGateway,tigerExecute,isPaperAccountId}=await module('src/tiger/tiger-client.ts');
     const gateway=await resolveTigerGateway({license:credentials.license,paper:isPaperAccountId(c.account_id),fetchImpl:timedFetch});
     const start=Date.parse('2000-01-01T00:00:00Z'),end=Date.now();report.requested={from:new Date(start).toISOString(),through:new Date(end).toISOString()};report.counts={};
     async function pages(method,secType,limit){return collectPages(async token=>{
      const env=await tigerExecute({gateway,credentials,method,fetchImpl:timedFetch,biz:{account:c.account_id,sec_type:secType,start_date:start,end_date:end,limit,...(token?{page_token:token}:{})}});
      if(![0,'0'].includes(env.code))throw new Error(`Tiger ${method} rejected history (${env.code}): ${env.message??''}`);
      return env.data;
     },{rows:r=>assertAccountRows(r?.items,c.account_id,method==='orders'?['account','accountId']:['accountId'],true),cursor:r=>r?.nextPageToken,
      onPage:async(rows,page)=>save(`${method}-${secType}-${page}.json`,rows),pause:()=>sleep(method==='orders'?550:1100)});}
     const orders=await section('orders',()=>pages('orders','ALL',300));report.counts.orders=orders?.length??null;
     if(c.account_id.toUpperCase().startsWith('U'))report.gaps.push({section:'executions',reason:'Tiger order_transactions supports Prime/Paper accounts, not Global accounts.'});
     else for(const type of ['STK','OPT']){const rows=await section(`executions-${type}`,()=>pages('order_transactions',type,100));report.counts[type]=rows?.length??null;if(rows?.some(row=>row.secType!==type))throw new Error('Tiger transaction security filter was not respected');}
     report.gaps.push({section:'coverage',reason:'Stock and option transactions requested since 2000; broker retention/account inception is not proven. Other asset classes and cash/lifecycle activity require separate endpoints.'});
    } else if(c.broker_id==='webull') {
     const {webullGet,parseWebullRegion}=await module('src/webull/webull-client.ts');const {WEBULL_API_HOSTS}=await module('src/webull/webull-types.ts');
     const host=WEBULL_API_HOSTS[parseWebullRegion(credentials.region)];const from='2018-05-21T00:00:00.000Z',through=new Date().toISOString();report.requested={from,through};
     const groups=await collectPages(token=>webullGet({host,path:'/trading/orders/historical-orders/list',credentials,fetchImpl:timedFetch,query:{account_id:c.account_id,start_time:from,end_time:through,...(token?{pagination_key:token}:{})}}),
      {rows:r=>assertAccountRows(r?.data,c.account_id,['account_id']),cursor:r=>r?.pagination_key,onPage:async(rows,page)=>save(`orders-${page}.json`,rows),pause:()=>sleep(1100)});
     const orders=groups.flatMap(group=>Array.isArray(group.orders)?group.orders:[group]);assertAccountRows(orders,c.account_id,['account_id']);
     report.counts={groups:groups.length,orders:orders.length,options:orders.filter(o=>o.instrument_type==='OPTION').length,securities:orders.filter(o=>o.instrument_type==='STOCK').length};
     report.gaps.push({section:'executions',reason:'Trading API order history contains cumulative fills, not verified individual executions. Broker API List Order Executions uses a separate API/product; access not assumed.'});
    } else {
     const {createFlexTransport,fetchFlexStatement}=await module('src/ibkr/flex-client.ts');const {parseXmlAttrs}=await module('src/ibkr/flex-parse.ts');
     const transport=createFlexTransport();report.periods=[];
     const queries=[...new Map(['activity_query_id','tradeconf_query_id'].filter(k=>credentials[k]).map(k=>[credentials[k],k])).entries()];
     if(!queries.length)throw new Error('No IBKR Flex query configured');
     for(const [queryId,kind] of queries)for(const window of flexYearWindows())await section(`${kind}-${window.from}`,async()=>{
      const xml=(await fetchFlexStatement({token:credentials.token,queryId},{...transport,get:(path,params)=>transport.get(path,path==='SendRequest'?{...params,fd:window.from,td:window.through}:params)})).toString('utf8');
      const summary=summarizeFlex(xml,c.account_id,parseXmlAttrs);save(`${kind}-${window.from}-${window.through}.xml`,xml);report.periods.push({kind,requested:window,...summary});
      const actual=summary.periods;
      if(actual.some(p=>p.from?.replaceAll('-','')!==window.from||p.through?.replaceAll('-','')!==window.through))report.gaps.push({section:`coverage-${window.from}`,reason:'Returned Flex statement dates differ from the requested year. Coverage must use returned dates.'});
      if(!summary.sections.includes('Trades')&&!summary.sections.includes('TradeConfirms'))report.gaps.push({section:`trades-${window.from}`,reason:'Flex query has no trade section; query template must include execution-level trades.'});
     });
     report.gaps.push({section:'coverage',reason:'Requested current and four previous calendar years per IBKR retention guidance; earlier records require separately available statements.'});
    }
   } catch(e){report.gaps.push({section:'fetch',reason:safeError(e)});}
   report.status=report.files.length?'fetched_with_gaps':'blocked';report.completedAt=new Date().toISOString();save('report.json',{...report});reports.push(report);
   console.log(JSON.stringify({name:report.name,broker:report.broker,channel:report.channel,status:report.status,files:report.files.length,counts:report.counts,periods:report.periods?.length,gaps:report.gaps}));
  }
 }
 writeFileSync(join(output,'summary.json'),JSON.stringify(reports,null,2),{mode:0o600,flag:'wx'});
} finally {release();await database.close();}
process.exit(0);
