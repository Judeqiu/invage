/** Replay retained broker evidence into the additive source tables, never books
 * balances or portfolio projections. Default: read-only plan.
 * Run with the full service environment after books:migrate:
 * node --import tsx scripts/capture-broker-activity.mjs <user> <connection> [--apply]
 */
import 'dotenv/config';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';
process.env.UTARUS_LOADED_BY_HOST = '1';
const [user,connectionId,flag] = process.argv.slice(2);
if (!user || !connectionId || flag && flag !== '--apply' || process.argv.length > 5) {
  throw new Error('Usage: capture-broker-activity.mjs <user> <connection> [--apply]');
}
const runtime = await openDatabaseRuntime({env:process.env,mode:'personal',onError(error){throw error;}});
const release = bindDatabaseRuntime(runtime);
try {
  const {loadInvestor} = await import('../src/state/investor-store.ts');
  const {readBrokerAccountModel} = await import('../src/brokers/accounts.ts');
  const {listRawData,fetchRawData} = await import('../src/raw-data/store.ts');
  const {extractBrokerActivity,parseBrokerJsonExact} = await import('../src/brokers/activity.ts');
  const {captureBrokerActivity} = await import('../src/brokers/activity-store.ts');
  const {state} = await loadInvestor(user);
  const conn = readBrokerAccountModel(state).connections[connectionId];
  if (!conn?.account_id) throw new Error('Select a bound broker account connection.');
  const scope = {brokerId:conn.broker_id,channel:conn.channel,accountId:conn.account_id};
  const summary = {apply:flag==='--apply',channel:conn.channel,files:0,records:0,statuses:{},skipped:[],gaps:[]};
  let offset=0;
  for (;;) {
    const page = listRawData(state.user.id,offset,100,conn.channel);
    for (const file of page.files) {
      if (file.source_kind !== 'broker-sync' || !/\.(xml|json)$/.test(file.id) || /before|backup/i.test(file.id)) continue;
      const chunks=[];let byteOffset=0;
      for (;;) {
        const part=fetchRawData(state.user.id,file.id,file.version,byteOffset,65536,'base64');
        chunks.push(Buffer.from(part.content,'base64'));
        if (part.next_offset===null) break;
        byteOffset=part.next_offset;
      }
      const body=Buffer.concat(chunks),kind=file.id.endsWith('.xml')?'xml':'json';
      if(kind==='json') {
        let schema;
        try{schema=parseBrokerJsonExact(body.toString('utf8')).schema;}catch{ /* not a broker payload */ }
        if(![`invage.${conn.broker_id}.raw.v1`,`invage.${conn.broker_id}.cloud.raw.v1`].includes(schema)) {
          summary.skipped.push({file:file.id,reason:'Unrecognized broker bundle; not copied into source tables.'});continue;
        }
      }
      const extracted=extractBrokerActivity(body,kind,scope);
      if(flag==='--apply') await captureBrokerActivity(state.user.id,scope,{body,kind},file.id);
      summary.files++;summary.records+=extracted.records.length;
      summary.statuses[extracted.status]=(summary.statuses[extracted.status]??0)+1;
      summary.gaps=[...new Set([...summary.gaps,...extracted.gaps])];
    }
    if(page.next_offset===null) break;
    offset=page.next_offset;
  }
  console.log(JSON.stringify(summary));
} finally {
  release();await runtime.close();
  const {closePool}=await import('../src/books/db.ts');await closePool();
}
