import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { addBrokerAccount, addBrokerSource, readBrokerAccountModel, syncBrokerAccount } from '../src/brokers/accounts.js';
import * as adapter from '../src/brokers/adapter.js';
import { loadInvestor } from '../src/state/investor-store.js';
import { applyBrokerStatement } from '../src/brokers/apply-statement.js';
import { brokerSyncBinding, brokerSyncRetry } from '../src/brokers/sync-retries.js';
import { HISTORY_PENDING_REASON, HISTORY_REVIEW_REASON, type BrokerApplyResult } from '../src/brokers/statement.js';
import type { InvestorState } from '../src/state/portfolio-state.js';

vi.mock('../src/state/investor-store.js',()=>({loadInvestor:vi.fn(),saveInvestor:vi.fn()}));
vi.mock('../src/brokers/apply-statement.js',()=>({applyBrokerStatement:vi.fn()}));
vi.mock('../src/state/projection-events.js',()=>({refreshPortfolioAfterSync:async()=>({status:'ready'})}));
vi.mock('../src/brokers/sync-notification.js',()=>({captureBrokerSyncSnapshot:()=>({positions:{},cash:{},execution_count:0}),
  brokerSyncFacts:()=>({}),publishBrokerSyncSuccess:vi.fn(),publishBrokerSyncFailure:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());

it.each([false,true])('clears a saved snapshot history conflict but retains a transient fetch retry (transient=%s)',async transient=>{
  const state={user:{id:'11111111-2222-4333-8444-555555555555',created_at:'2026-01-01'},
    profile:{display_name:'Test',contact_email:''},log:[]} as InvestorState;
  const source=addBrokerSource(state,'tiger',{tiger_id:'test',license:'TBSG',
    private_key:readFileSync('tests/fixtures/tiger/test-private.pem','utf8')});
  const id=addBrokerAccount(state,{source_id:source,account_id:'A',label:'Main',config:{}});
  const connection=readBrokerAccountModel(state).connections[id];
  const snapshot={state,revision:1};vi.mocked(loadInvestor).mockResolvedValue(snapshot);
  vi.spyOn(adapter.adapters.tiger,'fetchRaw').mockResolvedValue({kind:'json',body:Buffer.from('{}')});
  vi.spyOn(adapter,'parseBrokerSnapshot').mockReturnValue({account_id:'A',as_of:'2026-10-27',cash:[],lots:[],skipped:[]});
  const result:BrokerApplyResult={accountId:'A',asOf:'2026-10-27',channel:connection.channel,lotsUpserted:0,lotsRemoved:0,cash:[],
    skipped:[{kind:'event',reason:transient?HISTORY_PENDING_REASON:HISTORY_REVIEW_REASON}],
    ...(transient?{}:{historyReconciliationDeferred:true})};
  vi.mocked(applyBrokerStatement).mockResolvedValue(result);
  await syncBrokerAccount(snapshot,id,undefined,'scheduled',true);
  const retry=brokerSyncRetry(state.user.id,id,brokerSyncBinding(connection));
  if(transient)expect(retry).toMatchObject({attempts:1});
  else expect(retry).toBeNull();
});
