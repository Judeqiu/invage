import {expect,it} from 'vitest';
import {executionJournalWithRealizations} from '../src/webapp/execution-realizations.js';
import {buildExecutionJournal} from '../src/brokers/option-executions.js';
import {tradesHistory} from '../src/webapp/trades-v2-data.js';
import {tradesFixture,optionFill} from './helpers/trades-fixture.js';

it.each([
 ['AMD','370','3515.00','-0.84','-1650.0','1863.41','2026-07-17T09:46:52','10:53:12'],
 ['AMD','350','2410.0','-0.82','-925.0','1483.43','2026-06-24T13:57:16','10:51:47'],
 ['TSLA','300','2110.0','-0.81','-465.0','1643.44','2026-08-04T10:03:26','10:50:54'],
 ['AMD','240','1595','-0.8','-84.0','1509.45','2026-05-04T11:13:08','10:49:54'],
 ['AMD','230','1370.0','-0.8','-65.0','1303.45','2026-05-04T11:19:51','10:48:43'],
])('shows the verified %s %s closing example using its original opening fill', (underlying,strike,credit,fee,debit,expected,openedAt,closedTime)=>{
 const s=tradesFixture();s.portfolio={};s.option_executions=[
  optionFill({channel:'tiger',account_id:'T1',underlying,strike,expiry:'2026-11-20',executed_at:openedAt,contracts:'1',gross_premium:credit,commission:fee}),
  optionFill({channel:'tiger',account_id:'T1',underlying,strike,expiry:'2026-11-20',execution_id:'close',contracts:'1',side:'buy',effect:'close',gross_premium:debit,commission:'-0.750000000000',executed_at:'2026-11-05T'+closedTime}),
 ];
 const journal=buildExecutionJournal(s.option_executions),history=tradesHistory(s),before=JSON.stringify({journal,history});
 const result=executionJournalWithRealizations(journal,history),closing=result.executions.find(e=>e.execution_id==='close')!;
 expect(closing.realization).toMatchObject({net:expected,openingExecutionIds:['open-1'],openingPremium:credit.replace(/\.0+$/,'')});
 expect(result.executions.find(e=>e.effect==='open')!.realization).toBeNull();
 expect(JSON.stringify({journal,history})).toBe(before);expect(result.daily).toEqual(journal.daily);expect(result.cumulative).toEqual(journal.cumulative);
});
it('retains FIFO partial allocations, before-fee profit and account isolation',()=>{
 const s=tradesFixture();s.option_executions![0].commission=null;
 const journal=buildExecutionJournal(s.option_executions),history=tradesHistory(s);
 const result=executionJournalWithRealizations(journal,history),closing=result.executions.find(e=>e.effect==='close')!;
 expect(closing.realization).toMatchObject({contracts:'1',gross:'250.05172839',net:null,openingPremium:'300.06172839',openingFees:null});
 const foreign={...closing,account_id:'OTHER'};
 expect(executionJournalWithRealizations({...journal,executions:[...journal.executions,foreign]},history).executions.at(-1)!.realization).toBeNull();
 expect(executionJournalWithRealizations(journal,{...history,gaps:[{channel:'ibkr',blocksTotals:true}]}).executions.every(e=>e.realization===null)).toBe(true);
 expect(executionJournalWithRealizations(journal,{...history,rows:[...history.rows,...history.rows]}).executions.every(e=>e.realization===null)).toBe(true);
 const wrongContract={...journal,executions:journal.executions.map(e=>e.effect==='open'?{...e,multiplier:'10'}:e)};
 expect(executionJournalWithRealizations(wrongContract,history).executions.every(e=>e.realization===null)).toBe(true);
});
it('does not invent profit for unmatched closes or unknown/mixed effects',()=>{
 const s=tradesFixture();s.portfolio={};s.option_executions=[optionFill({effect:'close',side:'buy'})];
 expect(executionJournalWithRealizations(buildExecutionJournal(s.option_executions),tradesHistory(s)).executions[0].realization).toBeNull();
});
