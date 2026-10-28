import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect,it,vi } from 'vitest';
import { useTestDatabase,createInvestorFixture } from './helpers/database.js';
vi.mock('../src/brokers/sync-notification.js',async original=>({...await original<object>(),publishBrokerSyncSuccess:vi.fn(),publishBrokerSyncFailure:vi.fn()}));
await useTestDatabase({books:true});
const {migrateBooks,booksListJournals}=await import('../src/books/index.js');
const {loadInvestor,saveInvestor}=await import('../src/state/investor-store.js');
const {addBrokerSource,addBrokerAccount,readBrokerAccountModel,syncBrokerAccount}=await import('../src/brokers/accounts.js');
const {getCashes}=await import('../src/state/portfolio-state.js');
const {adapters}=await import('../src/brokers/adapter.js');
const {withHouseholdTx}=await import('../src/books/db.js');
const activityStore=await import('../src/brokers/activity-store.js');
const user=randomUUID();
it('full sync persists historical data, latest sync retains gaps without backfilling, and explicit full sync can enrich it',async()=>{
  await migrateBooks();
  await createInvestorFixture({user:{id:user,created_at:'2026-10-01',auth_token:randomUUID()},profile:{display_name:'History test',contact_email:'history@test.local'},log:[]});
  let snap=await loadInvestor(user);
  const source=addBrokerSource(snap.state,'moomoo',{app_key:'test',private_key:readFileSync('tests/fixtures/moomoo/ed25519-private.pem','utf8'),sign_alg:'Ed25519'});
  const id=addBrokerAccount(snap.state,{source_id:source,account_id:'A',label:'A',config:{}});
  const model=readBrokerAccountModel(snap.state),channel=model.connections[id].channel;
  model.connections[id].last_sync={at:'2026-10-13T00:00:00Z',as_of:'2026-10-13',ok:true,account_id:'A'};
  snap.state.broker_connections![id]={...model.connections[id]};await saveInvestor(snap);
  let includeMetadata=false,includeFill=true;
  const fetch=vi.spyOn(adapters.moomoo,'fetchRaw').mockImplementation(async(_credentials,opts)=>{
    const plan=opts!.history!;
    return {kind:'json',body:Buffer.from(JSON.stringify({schema:'invage.moomoo.raw.v1',acc_id:'A',fetched_at:plan.through,authorized:{s:'ok'},funds:{s:'ok',d:{us_cash:'1000'}},positions:{s:'ok',d:[]},
      option_basicinfo:includeMetadata?[{code:'US.AVGO261218C400000',stock_type:'DRVT',contract_size:100}]:[],
      fills_history:{start:String(Date.parse(plan.from)*1000),end:String(Date.parse(plan.through)*1000),rows:includeFill?[{deal_id:'e',code:'US.AVGO261218C400000',trd_side:'SELL_SHORT',qty:'1',price:'19.50',status:'OK',create_time:'1791384391000000'}]:[]},
      orders_history:{start:String(Date.parse(plan.from)*1000),end:String(Date.parse(plan.through)*1000),rows:[]},orders_details:[],history_mode:plan.mode
    }))};
  });
  try{
    await syncBrokerAccount(await loadInvestor(user),id,undefined,'manual',true);
    await withHouseholdTx(user,async client=>{
      const sources=await client.query('SELECT status,body FROM broker_source_documents WHERE household_id=$1',[user]);
      expect(sources.rows).toHaveLength(1);expect(sources.rows[0].status).toBe('indexed');
      expect(JSON.parse(sources.rows[0].body.toString()).fills_history.rows[0].deal_id).toBe('e');
      expect((await client.query('SELECT source_id FROM broker_source_records WHERE household_id=$1 AND category=$2',[user,'execution'])).rows).toEqual([{source_id:'e'}]);
    });
    expect(fetch.mock.calls[0][1]!.history!.mode).toBe('full');
    snap=await loadInvestor(user);expect(snap.state.broker_history![channel].executions[0].gross_cash).toBeNull();expect(snap.state.option_executions).toEqual([]);
    expect(snap.state.broker_history![channel].sync).toMatchObject({status:'partial',full_history_synced:false});
    expect(readBrokerAccountModel(snap.state).connections[id].last_sync!.ok).toBe(true);
    const journals=(await booksListJournals(snap.state,100)).length;
    includeFill=false;await syncBrokerAccount(snap,id);expect(fetch.mock.calls[1][1]!.history!.mode).toBe('incremental');
    snap=await loadInvestor(user);expect(snap.state.broker_history![channel].sync).toMatchObject({historical_imported:true,status:'partial'});
    expect(snap.state.broker_history![channel].sync.gaps).not.toHaveLength(0);
    includeMetadata=true;includeFill=true;
    await syncBrokerAccount(snap,id,undefined,'manual',true);expect(fetch.mock.calls[2][1]!.history!.mode).toBe('full');
    snap=await loadInvestor(user);expect(snap.state.broker_history![channel].sync).toMatchObject({status:'complete',full_history_synced:true});
    expect(snap.state.option_executions![0].gross_premium).toBe('1950.00');
    expect((await booksListJournals(snap.state,100)).length).toBe(journals);
    includeFill=false;
    await syncBrokerAccount(snap,id);expect(fetch.mock.calls[3][1]!.history!.mode).toBe('incremental');
    snap=await loadInvestor(user);expect(snap.state.broker_history![channel].executions).toHaveLength(1);expect(snap.state.option_executions).toHaveLength(1);
    expect(getCashes(snap.state)).toEqual(expect.arrayContaining([expect.objectContaining({amount:1000,channel})]));
    const beforeFailure=structuredClone({cash:snap.state.cash,portfolio:snap.state.portfolio,history:snap.state.broker_history,executions:snap.state.option_executions});
    const capture=vi.spyOn(activityStore,'captureFetchedBrokerActivity').mockRejectedValueOnce(new Error('Injected evidence database outage'));
    try {
      await expect(syncBrokerAccount(snap,id)).rejects.toThrow(/evidence database outage/);
      snap=await loadInvestor(user);
      expect({cash:snap.state.cash,portfolio:snap.state.portfolio,history:snap.state.broker_history,executions:snap.state.option_executions}).toEqual(beforeFailure);
      expect(readBrokerAccountModel(snap.state).connections[id].last_sync!.ok).toBe(false);
    } finally { capture.mockRestore(); }
  }finally{fetch.mockRestore();}
});
