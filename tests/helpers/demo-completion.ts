import {blankState} from 'utarus';
import type {InvestorState} from '../../src/state/portfolio-state.js';
import type {DemoWorkbook} from '../../src/demo/workbook.js';
import type {DemoMarketEvidence,DemoCompletionPlan} from '../../src/demo/completion.js';

/** Generated market/worksheet fixtures, never customer data or live quotes. */
export function demoCompletionFixture() {
  const asOf='2026-10-16',rows:DemoWorkbook['rows']=[
    {sheet:'Account A',row:2,channel:'ibkr',brokerId:'ibkr',underlying:'DEMO-A',description:'Fictional opening',entryDate:'2026-09-14',expiry:'2027-01-15',strike:'85.5',contracts:'2',credit:'2020',debit:'0',fees:'2.74'},
    {sheet:'Account B',row:2,channel:'moomoo',brokerId:'moomoo',underlying:'DEMO-B',description:'Fictional roll',entryDate:'2026-09-23',expiry:'2026-12-18',strike:'95',contracts:'1',credit:'0',debit:'550',fees:'-3.40'},
  ];
  const book:DemoWorkbook={version:1,asOf,currency:'USD',multiplier:'100',source:{sha256:'a'.repeat(64),fileId:'imports/demo-workbook/Demo data.xlsx'},
    rows,summary:{nav:'630480',cash:'120000',premiumDaily:'1065',premiumMtd:'3130',premiumTotal:'324406.12',feesMtd:'3.45',feesTotal:'356.80',earnedDaily:null,earnedMtd:'6705',earnedTotal:'41456.93',assignment:'340050',riskCapital:'290050'}};
  const state=blankState({displayName:'Fictional demo fixture',contactEmail:'demo@velovest.ai',language:'en'}) as InvestorState;
  state.synthetic_demo={version:1};state.demo_workbook=book;
  const start=Date.parse('2026-06-04T00:00:00Z'),end=Date.parse(asOf+'T00:00:00Z');
  const series=['DEMO-A','DEMO-B'].map((symbol,k)=>({symbol,response:{meta:{currency:book.currency},quotes:Array.from({length:(end-start)/86400000+1},(_,i)=>{
    const at=new Date(start+i*86400000),price=(k?85:120)*Math.exp(Math.sin(i*.61)*.04+i*.0003);
    return {date:at.toISOString(),close:price,adjclose:price,weekday:at.getUTCDay()};
  }).filter(q=>q.weekday!==0&&q.weekday!==6)}}));
  const market:DemoMarketEvidence={version:1,provider:'Generated unit-test prices',capturedAt:asOf+'T00:00:00Z',sourceSha256:book.source.sha256,asOf,requestedFrom:'2026-06-04',requestedThrough:'2026-10-17',series};
  const plan:DemoCompletionPlan={version:1,sourceSha256:book.source.sha256,entries:rows.map((r,i)=>({sheet:r.sheet,row:r.row,kind:i?'roll':'opening'}))};
  return {state,book,market,plan};
}
