import {beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
const mocks=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}));
vi.mock('../src/state/investor-store.js',()=>({loadInvestor:mocks.load,saveInvestor:mocks.save}));
vi.mock('../src/brokers/sync-notification.js',async original=>({...await original<object>(),publishBrokerSyncSuccess:vi.fn(),publishBrokerSyncFailure:vi.fn()}));
const {syncBrokerConnection,readBrokerConnections}=await import('../src/brokers/connections.js');
const {adapters}=await import('../src/brokers/adapter.js');
const {dueBrokerSyncs,finishBrokerSync}=await import('../src/brokers/sync-retries.js');
let stored:any,revision:number;
const xml=Buffer.from('<FlexQueryResponse><FlexStatement accountId="A" fromDate="20261023" toDate="20261023"><OpenPositions/><CashReport><CashReportCurrency accountId="A" currency="USD" endingCash="100"/></CashReport></FlexStatement></FlexQueryResponse>');
beforeEach(()=>{
 vi.restoreAllMocks();mocks.load.mockReset();mocks.save.mockReset();
 stored={user:{id:randomUUID(),created_at:'2026-10-01'},profile:{display_name:'Legacy',contact_email:''},log:[],broker_connections:{ibkr:{enabled:true,credentials:{token:'test',activity_query_id:'q'}}}};revision=1;
 mocks.load.mockImplementation(async()=>({state:structuredClone(stored),revision}));
 mocks.save.mockImplementation(async s=>{stored=structuredClone(s.state);s.revision=++revision});
});
it('legacy connector routes also save a valid current snapshot and queue unavailable history',async()=>{
 vi.spyOn(adapters.ibkr,'fetchRaw').mockResolvedValue({kind:'xml',body:xml,historyDeferred:{reason:'Backfill unavailable'}});
 const result=await syncBrokerConnection({state:structuredClone(stored),revision},'ibkr');
 expect(result.applied.cash).toEqual([{currency:'USD',amount:100}]);
 expect(readBrokerConnections(stored).ibkr.last_sync?.ok).toBe(true);
 const jobs=dueBrokerSyncs(new Date(Date.now()+60_000));
 expect(jobs).toContainEqual(expect.objectContaining({userId:stored.user.id,connectionId:'ibkr'}));
 finishBrokerSync(jobs.find(j=>j.userId===stored.user.id)!,true);
});
it('legacy revision conflicts reapply retained evidence while preserving concurrent profile edits',async()=>{
 const fetch=vi.spyOn(adapters.ibkr,'fetchRaw').mockResolvedValue({kind:'xml',body:xml});
 mocks.save.mockImplementationOnce(async()=>{stored.profile.display_name='Concurrent';revision++;throw new Error('Investor state changed during this update; reload before saving.')});
 await syncBrokerConnection({state:structuredClone(stored),revision},'ibkr');
 expect(fetch).toHaveBeenCalledOnce();expect(stored.profile.display_name).toBe('Concurrent');
 expect(readBrokerConnections(stored).ibkr.last_sync?.ok).toBe(true);
});
