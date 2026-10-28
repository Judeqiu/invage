import { readBrokerAccountModel } from './accounts.js';
import { isDeepStrictEqual } from 'node:util';
import type { InvestorState } from '../state/portfolio-state.js';
import { assertBrokerHistory, optionExecutionsFromHistory } from './history.js';
import { addDecimals, decimal, mergeOptionExecutions, negateDecimal } from './option-executions.js';
import { historyProduct } from './history-values.js';
import { assertOptionLifecycleEvent, mergeOptionLifecycleEvents, type OptionLifecycleEvent } from './option-events.js';

export interface StatementEvidence {
  version: 1; broker_id: string; channel: string; account_id: string;
  source: { name: string; sha256: string; reference: string };
  contracts: Array<{ native_symbol: string; multiplier: string; reference: string }>;
  lifecycle: Array<OptionLifecycleEvent>;
  annotations: Array<{ execution_id: string; kind: 'forced_liquidation'; reference: string }>;
}
const eq = (a:string,b:string) => !/[1-9]/.test(addDecimals(a,negateDecimal(b)));
const keys=(v:object,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Unknown statement evidence field');};
const text = (v:unknown):string => { if(typeof v!=='string'||!v.trim())throw Error('Statement evidence text is required');return v; };

/** Fill missing facts only. Original raw archives and all reported economic values remain intact. */
export function reconcileStatementEvidence(state: InvestorState, input: unknown): InvestorState {
  const doc = structuredClone(input) as StatementEvidence;
  if (!doc || doc.version!==1 || !Array.isArray(doc.contracts)||!Array.isArray(doc.lifecycle)||!Array.isArray(doc.annotations)) throw Error('Invalid statement evidence document');
  keys(doc,['version','broker_id','channel','account_id','source','contracts','lifecycle','annotations']);
  for(const field of ['broker_id','channel','account_id'] as const)text(doc[field]);
  if(!doc.source||!/^([a-f0-9]{64})$/.test(doc.source.sha256))throw Error('Statement source SHA256 is required');
  keys(doc.source,['name','sha256','reference']);
  text(doc.source.name);text(doc.source.reference);
  const connection=Object.values(readBrokerAccountModel(state).connections).find(c=>c.broker_id===doc.broker_id&&c.channel===doc.channel&&c.account_id===doc.account_id);
  if(!connection)throw Error('Statement evidence must match a configured broker account');
  const existing=state.broker_history?.[doc.channel];if(!existing)throw Error('Sync broker history before importing statement evidence');
  const history=structuredClone(assertBrokerHistory(existing));
  const notes: string[] = [];
  for(const contract of doc.contracts){
    keys(contract,['native_symbol','multiplier','reference']);
    text(contract.native_symbol);text(contract.reference);decimal(contract.multiplier);
    const matches=history.executions.filter(e=>e.instrument==='option'&&e.native_symbol===contract.native_symbol);
    if(!matches.length)throw Error('Statement contract has no matching retained fills');
    for(const e of matches){
      if(e.multiplier!==null&&!eq(e.multiplier,contract.multiplier))throw Error('Statement multiplier conflicts with retained broker metadata');
      e.multiplier=contract.multiplier;
      if(e.price!==null){const cash=historyProduct(e.price,e.quantity,e.multiplier);const signed=e.side==='buy'?negateDecimal(cash):cash;
        if(e.gross_cash!==null&&!eq(e.gross_cash,signed))throw Error('Statement metadata conflicts with retained execution cash');e.gross_cash??=signed;}
    }
    notes.push(contract.native_symbol);
  }
  doc.lifecycle=doc.lifecycle.map(raw=>{
    const e=assertOptionLifecycleEvent(raw);
    if(e.source!=='broker_statement'||e.source_ref!==doc.source.sha256||e.broker_id!==doc.broker_id||e.channel!==doc.channel||e.account_id!==doc.account_id)throw Error('Statement lifecycle scope or source mismatch');
    if(!e.replaces_execution_ids?.length)throw Error('Statement lifecycle events must explicitly link retained closing execution IDs');
    const fills=e.replaces_execution_ids.map(id=>{const f=history.executions.find(f=>f.id===id);if(!f||f.instrument!=='option'||f.effect!=='close'||!f.option||f.native_symbol!==e.contract_id||f.symbol!==e.underlying||f.option.right!==e.right||f.option.expiry!==e.expiry||!eq(f.option.strike,e.strike)||f.multiplier===null||!eq(f.multiplier,e.multiplier)||f.currency!==e.currency||f.price===null||!eq(f.price,'0'))throw Error('Lifecycle replacement must match explicit zero-price closing fills for this contract');return f;});
    if(new Set(e.replaces_execution_ids).size!==fills.length||!eq(addDecimals(...fills.map(f=>f.quantity)),e.contracts))throw Error('Lifecycle replacement quantity mismatch');
    return e;
  });
  for(const a of doc.annotations){keys(a,['execution_id','kind','reference']);if(a.kind!=='forced_liquidation'||!history.executions.some(e=>e.id===a.execution_id&&e.effect==='close'))throw Error('Liquidation annotation must link a retained closing fill');text(a.reference);}
  const prior=state.broker_statement_evidence??[];
  const documents=prior.some(d=>isDeepStrictEqual(d,doc))?prior:[...prior,doc];
  // An execution can be replaced by exactly one explicit lifecycle event.
  const events=mergeOptionLifecycleEvents(state.option_events??[],doc.lifecycle),links=new Set<string>();
  for(const e of events)for(const fill of e.replaces_execution_ids??[]){const key=JSON.stringify([e.channel,e.account_id,fill]);if(links.has(key))throw Error('Closing fill linked to multiple lifecycle events');links.add(key);}
  history.sync.gaps=history.sync.gaps.filter(g=>!(g.kind==='metadata'&&g.reference&&notes.includes(g.reference)&&history.executions.filter(e=>e.native_symbol===g.reference).every(e=>e.multiplier!==null&&e.symbol!==null)));
  // Coverage is not promoted to complete merely because statement metadata was supplied.
  return {...state,broker_history:{...state.broker_history,[doc.channel]:history},
    option_executions:mergeOptionExecutions(state.option_executions??[],optionExecutionsFromHistory(history)),option_events:events,broker_statement_evidence:documents};
}
