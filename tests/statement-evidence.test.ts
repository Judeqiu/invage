import {expect,it} from 'vitest';
import {reconcileStatementEvidence,type StatementEvidence} from '../src/brokers/statement-evidence.js';
import {tradesHistory} from '../src/webapp/trades-v2-data.js';
import {buildRecordedOptionAnalytics} from '../src/webapp/option-analytics.js';
import {tradesFixture} from './helpers/trades-fixture.js';
function fixture(){
 const s=tradesFixture();s.portfolio={};s.option_executions=[];
 const common={broker_id:'ibkr',channel:'ibkr',account_id:'U1',order_id:null,native_symbol:'PUT',symbol:'AAPL',instrument:'option' as const,clock:'America/New_York',currency:'USD',quantity:'1',multiplier:null,gross_cash:null,fee_cash:'0',option:{right:'put' as const,expiry:'2027-01-15',strike:'150'}};
 s.broker_history={ibkr:{broker_id:'ibkr',channel:'ibkr',account_id:'U1',executions:[{...common,id:'open',side:'sell',effect:'open',executed_at:'2026-09-10T10:00:00',price:'3'},{...common,id:'zero',side:'buy',effect:'close',executed_at:'2027-01-16T01:00:00',price:'0'}],orders:[],sync:{version:1,mode:'full',from:'2000-01-01T00:00:00Z',through:'2027-01-17T00:00:00Z',status:'partial',full_history_synced:false,fees:'unavailable',gaps:[{kind:'metadata',reference:'PUT',reason:'Contract size missing'}]}}};
 const doc:StatementEvidence={version:1,broker_id:'ibkr',channel:'ibkr',account_id:'U1',source:{name:'Statement',sha256:'a'.repeat(64),reference:'Page 2'},contracts:[{native_symbol:'PUT',multiplier:'100',reference:'Page 2'}],annotations:[],lifecycle:[{id:'expiry',broker_id:'ibkr',channel:'ibkr',account_id:'U1',contract_id:'PUT',underlying:'AAPL',right:'put',strike:'150',expiry:'2027-01-15',multiplier:'100',date:'2027-01-15',kind:'expiration',settlement:'physical',contracts:'1',currency:'USD',fees:'0',source:'broker_statement',source_ref:'a'.repeat(64),replaces_execution_ids:['zero']}]};return {s,doc};
}
it('enriches missing metadata with provenance, links expiry once and is idempotent without changing source state',()=>{
 const {s,doc}=fixture(),before=JSON.stringify(s),next=reconcileStatementEvidence(s,doc);
 expect(JSON.stringify(s)).toBe(before);expect(next.option_executions).toHaveLength(2);expect(next.broker_statement_evidence).toEqual([doc]);
 expect(next.broker_history!.ibkr.executions[0]).toMatchObject({multiplier:'100',gross_cash:'300'});
 expect(tradesHistory(next).rows).toHaveLength(1);expect(tradesHistory(next).rows[0]).toMatchObject({status:'Expired',realizedPnl:'300'});
 expect(buildRecordedOptionAnalytics(next.option_executions,next.option_events).profits).toMatchObject([{gross:300,net:300}]);
 expect(reconcileStatementEvidence(next,doc)).toEqual(next);
});
it('keeps physical exercise out of option profit and preserves explicit liquidation annotations',()=>{
 const {s,doc}=fixture();s.broker_history!.ibkr.executions[0].side='buy';s.broker_history!.ibkr.executions[1].side='sell';doc.lifecycle[0].kind='exercise';
 const next=reconcileStatementEvidence(s,doc);expect(tradesHistory(next).rows[0]).toMatchObject({status:'Exercised',realizedPnl:null});expect(buildRecordedOptionAnalytics(next.option_executions,next.option_events).profits).toEqual([]);
 const f=fixture();f.doc.lifecycle=[];f.doc.annotations=[{execution_id:'zero',kind:'forced_liquidation',reference:'* on page 2'}];
 expect(tradesHistory(reconcileStatementEvidence(f.s,f.doc)).rows[0].notes.join(' ')).toContain('Forced liquidation reported in Statement');
});
it('rejects contradictory metadata, foreign accounts, nonzero replacements and duplicated lifecycle links atomically',()=>{
 const {s,doc}=fixture();const enriched=reconcileStatementEvidence(s,doc);
 expect(()=>reconcileStatementEvidence(enriched,{...doc,contracts:[{...doc.contracts[0],multiplier:'10'}]})).toThrow('conflicts');
 expect(()=>reconcileStatementEvidence(s,{...doc,account_id:'OTHER'})).toThrow('configured');
 s.broker_history!.ibkr.executions[1].price='1';expect(()=>reconcileStatementEvidence(s,doc)).toThrow('zero-price');
 const f=fixture();f.doc.lifecycle.push({...f.doc.lifecycle[0],id:'other'});expect(()=>reconcileStatementEvidence(f.s,f.doc)).toThrow('multiple');
});

it.each(['ibkr','moomoo','tiger','webull'])('reconciles statement evidence generically for %s accounts', broker=>{
 const {s,doc}=fixture();s.broker_sources!.source.broker_id=broker;
 const c=s.broker_connections!.ibkr as import('../src/state/portfolio-state.js').BrokerAccountConnection;c.broker_id=broker;
 c.config=broker==='ibkr'?{}:{[{moomoo:'acc_id',tiger:'account',webull:'account_id'}[broker]!]:'U1'};
 s.broker_history!.ibkr.broker_id=broker;for(const e of s.broker_history!.ibkr.executions)e.broker_id=broker;
 doc.broker_id=broker;for(const e of doc.lifecycle)e.broker_id=broker;
 expect(tradesHistory(reconcileStatementEvidence(s,doc)).rows[0]).toMatchObject({status:'Expired',realizedPnl:'300'});
});

it('keeps imports idempotent after PostgreSQL jsonb reorders every object key',()=>{
 const {s,doc}=fixture();const first=reconcileStatementEvidence(s,doc);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
 const persisted=reorder(first);const next=reconcileStatementEvidence(persisted,doc);
 expect(next.broker_statement_evidence).toHaveLength(1);expect(next).toEqual(persisted);
});
