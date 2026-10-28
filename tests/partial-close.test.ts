import {expect,it} from 'vitest';
import {partialCloseSummary} from '../src/brokers/partial-close.js';
import {tradesHistory} from '../src/webapp/trades-v2-data.js';
import {optionFill,tradesFixture} from './helpers/trades-fixture.js';

it('realizes the closed contract while retaining the remaining recorded contract',()=>{
 const s=tradesFixture();s.option_executions=[optionFill({gross_premium:'270',commission:'-1.49'}),optionFill({execution_id:'close',contracts:'1',side:'buy',effect:'close',gross_premium:'-1014',commission:'-3.29',executed_at:'2026-10-22T11:09:53'})];
 const before=JSON.stringify(s),r=tradesHistory(s).rows[0];
 expect(r).toMatchObject({status:'Partially closed',contracts:'1',remainingContracts:'1',premium:'135',netCash:'134.255',paidToClose:'1014',realizedPnl:'-883.035',feeBasis:'net'});
 expect(r.realizations).toMatchObject([{contracts:'1',gross:'-879',net:'-883.035',openingFees:'-0.745'}]);
 expect(JSON.stringify(s)).toBe(before);
});
it('matches FIFO opening prices and preserves signed fees and rebates',()=>{
 const fills=[optionFill({execution_id:'a',contracts:'1',gross_premium:'100',commission:'-1'}),optionFill({execution_id:'b',contracts:'1',gross_premium:'200',commission:'0.5',executed_at:'2026-09-11T10:00:00'}),optionFill({execution_id:'c',contracts:'1',side:'buy',effect:'close',gross_premium:'-20',commission:'0.25',executed_at:'2026-10-01T10:00:00'})];
 expect(partialCloseSummary(fills)).toMatchObject({premium:'100',net:'79.25',remaining:'1',realizations:[{openingExecutionIds:['a']}]});
 expect(partialCloseSummary([...fills,optionFill({execution_id:'d',contracts:'1',side:'buy',effect:'close',gross_premium:'-30',commission:'-1',executed_at:'2026-10-02T10:00:00'})])).toMatchObject({gross:'250',net:'248.75',remaining:'0'});
});
it('retains before-fee profit when fees are unknown and refuses unmatched or ambiguous closes',()=>{
 const o=optionFill({commission:null}),c=optionFill({execution_id:'c',contracts:'1',side:'buy',effect:'close',executed_at:'2026-10-01T10:00:00',gross_premium:'-50'});
 expect(partialCloseSummary([o,c])).toMatchObject({net:null,remaining:'1'});
 expect(partialCloseSummary([o,{...c,contracts:'3'}])).toBeUndefined();
 expect(partialCloseSummary([o,{...c,executed_at:o.executed_at}])).toBeUndefined();
});
it('keeps recurring allocations rational until native currency presentation',()=>{
 const o=optionFill({contracts:'3',gross_premium:'300',commission:'-1'}),c=optionFill({execution_id:'c',contracts:'1',side:'buy',effect:'close',executed_at:'2026-10-01T10:00:00',gross_premium:'-10',commission:'-1'});
 expect(partialCloseSummary([o,c])).toMatchObject({net:'88.67',rounded:true,remaining:'2'});
 expect(partialCloseSummary([o,c,{...c,execution_id:'last',contracts:'2',executed_at:'2026-10-02T10:00:00',gross_premium:'-20',commission:'-1'}])).toMatchObject({gross:'270',net:'267',remaining:'0'});
});

it.each([
 {closingCash:'-20',expected:'110.965'},
 {closingCash:'-1014',expected:'-883.035'},
])('treats liquidation-marked BTC $closingCash as ordinary realized P&L, independent of marks and later closes',({closingCash,expected})=>{
 const s=tradesFixture();s.option_executions=[optionFill({gross_premium:'270',commission:'-1.49'}),optionFill({execution_id:'btc',contracts:'1',side:'buy',effect:'close',gross_premium:closingCash,commission:'-3.29',executed_at:'2026-10-22T11:09:53'})];
 const ordinary=tradesHistory(s).rows[0];
 s.broker_statement_evidence=[{version:1,broker_id:'ibkr',channel:'ibkr',account_id:'U1',source:{name:'Statement',sha256:'a'.repeat(64),reference:'Trades *'},contracts:[],lifecycle:[],annotations:[{execution_id:'btc',kind:'forced_liquidation',reference:'* next to BTC'}]}];
 const marked=tradesHistory(s).rows[0];
 expect(marked).toMatchObject({status:'Partially closed',realizedPnl:expected,remainingContracts:'1'});
 expect(marked.realizedPnl).toBe(ordinary.realizedPnl);expect(marked.realizations).toEqual(ordinary.realizations);
 expect(marked.notes.join(' ')).toContain('Forced liquidation');
 s.portfolio!['AAPL-put'].option!.mark=99999;
 expect(tradesHistory(s).rows[0].realizedPnl).toBe(expected);
 s.option_executions.push(optionFill({execution_id:'later-btc',contracts:'1',side:'buy',effect:'close',gross_premium:'-30',commission:'-1',executed_at:'2026-10-23T11:09:53'}));
 const fullyClosed=tradesHistory(s).rows[0];expect(fullyClosed.status).toBe('Closed');
 expect(fullyClosed.realizations![0]).toEqual(marked.realizations![0]);
});
