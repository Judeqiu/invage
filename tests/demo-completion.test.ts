import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import {prepareCompletedDemo,completedDemoDashboard,demoRelationships,completedDemo,demoOptionModel} from '../src/demo/completion.js';
import {demoCompletionFixture} from './helpers/demo-completion.js';
import {buildPageProjections} from '../src/report/page-projections.js';
import {buildBrokerProjections} from '../src/report/broker-projections.js';
import {tradesOpenBook,tradesHistory} from '../src/webapp/trades-v2-data.js';
import {addDecimals,negateDecimal,buildExecutionJournal} from '../src/brokers/option-executions.js';
import {portfolioFingerprint} from '../src/state/projection-store.js';
import {optionAccounts} from '../src/brokers/option-identities.js';
const cents=(v:number)=>Math.round(v*100);

it('reconciles worksheet cash, generated fills, holdings, daily history and broker scopes',()=>{
  const {state,book,market,plan}=demoCompletionFixture(),before=structuredClone(state);
  const next=prepareCompletedDemo(state,market,plan),d=completedDemoDashboard(next),pages=buildPageProjections(d);
  const open=tradesOpenBook(next),links=demoRelationships(next),history=tradesHistory(next,links.groups.flatMap(g=>g.relationships));
  expect(state).toEqual(before);expect(next.demo_workbook).toEqual(book);
  expect(prepareCompletedDemo(state,market,plan)).toEqual(next);
  expect(open.rows).toHaveLength(book.rows.length);
  expect(open.rows.every(r=>r.premium!==null&&r.netCash!==null&&r.entryDate!==null)).toBe(true);
  expect(d.optionAnalytics!.gaps).toEqual([]);expect(history.rows.some(r=>r.realizedPnl!==null)).toBe(true);
  const scoped:any=pages.dashboard.live.merged;
  expect(cents(scoped.view.totalValue)).toBe(cents(Number(book.summary.nav)));
  expect(cents(scoped.view.cashAmount)).toBe(cents(Number(book.summary.cash)));
  expect(scoped.assignmentObligation).toBe(book.rows.reduce((n,r)=>n+Number(r.contracts)*Number(r.strike)*Number(book.multiplier),0));
  const journal=buildExecutionJournal(next.option_executions);
  expect(cents(scoped.premium.total)).toBe(cents(Number(addDecimals('0',...journal.executions.map(e=>e.gross_premium)))));
  expect(scoped.realized[scoped.premium.dailyFrom].value).toBe(0);
  expect(scoped.risk.wheel.rows.every((r:any)=>r.estimate.ivSource==='demo_model'&&Number.isFinite(r.estimate.probability))).toBe(true);
  const broker=buildBrokerProjections(next,d,open.rows,history.rows);
  expect(cents(Object.values(broker).reduce((n,b)=>n+b.nav!,0))).toBe(cents(scoped.view.totalValue));
  expect(Object.values(broker).every(b=>b.totals!.navComplete&&b.totals!.cashAmount!==null)).toBe(true);
  const last=next.demo_completion!.snapshots.at(-1)!;
  expect(cents(last.totalValue)).toBe(cents(d.model!.live.totalValue));
  expect(cents(last.cashAmount!)).toBe(cents(d.model!.live.cashAmount!));
  expect(Object.values((pages.dashboard.live.merged as any).positionTimelines).every((t:any)=>t.length>0)).toBe(true);
  for(const row of book.rows){
    const ids=Object.entries(next.demo_completion!.executionSources).filter(([,s])=>s.sheet===row.sheet&&s.row===row.row).map(([id])=>id);
    const fills=journal.executions.filter(e=>ids.includes(e.execution_id));
    const current=fills.find(e=>e.execution_id.endsWith(':current-open'))!;
    const action=plan.entries.find(e=>e.sheet===row.sheet&&e.row===row.row)!;
    const worksheet=addDecimals(row.credit,negateDecimal(row.debit));
    if(action.kind==='roll'){
      const closing=fills.find(e=>e.execution_id.endsWith(':predecessor-close'))!;
      expect(addDecimals(current.gross_premium,closing.gross_premium)).toBe(worksheet+'.00');
      expect(cents(Number(addDecimals(current.commission!,closing.commission!)))).toBe(cents(-Number(row.fees)));
    } else expect(cents(Number(current.gross_premium))).toBe(cents(Number(worksheet)));
  }
  const vm=createContext({});new Script(readFileSync(new URL('../webui/dashboard/net-risk-capital.js',import.meta.url),'utf8')).runInContext(vm);
  expect(vm.NetRiskCapital.calculate(scoped.view).value).toBe(vm.NetRiskCapital.calculate({...scoped.view,positions:scoped.view.positions.filter((p:any)=>p.instrument==='option')}).value);
});

it('uses retained historical evidence offline and rejects cross-account/unsupported source plans',()=>{
  const {state,market,plan}=demoCompletionFixture(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No live lookup'));
  try{const next=prepareCompletedDemo(state,market,plan);completedDemoDashboard(next);expect(fetch).not.toHaveBeenCalled();
    const before=portfolioFingerprint(next);next.demo_completion!.methods.push('Source evidence note');expect(portfolioFingerprint(next)).not.toBe(before);
    next.profile.contact_email='customer@example.com';expect(completedDemo(next)).toBeUndefined();expect(()=>prepareCompletedDemo(next,market,plan)).toThrow('isolated');
    expect(()=>prepareCompletedDemo(state,market,{...plan,entries:[plan.entries[0],plan.entries[0]]})).toThrow('duplicate');
    expect(()=>prepareCompletedDemo(state,{...market,series:[]},plan)).toThrow('evidence');
  }finally{fetch.mockRestore();}
});

it('ignores completion metadata on normal accounts and leaves their native calculations unchanged',()=>{
  const {state,market,plan}=demoCompletionFixture(),demo=prepareCompletedDemo(state,market,plan);
  const normal=structuredClone(demo);normal.profile.contact_email='normal@example.com';delete normal.synthetic_demo;delete normal.demo_workbook;
  const without=structuredClone(normal);delete without.demo_completion;
  expect(completedDemo(normal)).toBeUndefined();
  expect(portfolioFingerprint(normal)).toBe(portfolioFingerprint(without));
  expect(optionAccounts(normal)).toEqual(optionAccounts(without));
  expect(tradesOpenBook(normal)).toEqual(tradesOpenBook(without));
  expect(tradesHistory(normal)).toEqual(tradesHistory(without));
});

it('funds approved stock lots and locally covered calls without changing source puts, cash or broker NAV',()=>{
  const {state,book,market,plan}=demoCompletionFixture();
  const base=prepareCompletedDemo(state,market,plan),baseDashboard=completedDemoDashboard(base);
  const expandedPlan={...plan,positions:{kind:'covered_stock_book' as const,funding:'generated_reserves' as const}};
  const next=prepareCompletedDemo(base,market,expandedPlan),dashboard=completedDemoDashboard(next),pages=buildPageProjections(dashboard);
  expect(prepareCompletedDemo(base,market,expandedPlan)).toEqual(next);
  expect(next.demo_workbook).toEqual(book);expect(next.cash).toEqual(base.cash);
  for(const[key,h]of Object.entries(base.portfolio!))if(h.instrument==='option')expect(next.portfolio![key]).toEqual(h);
  for(const fill of base.option_executions!)expect(next.option_executions!.find(e=>e.execution_id===fill.execution_id)).toEqual(fill);
  const view=pages.positions.all as any;
  expect(view.stocks).toHaveLength(new Set(book.rows.map(r=>r.underlying)).size);
  expect(view.stocks.every((r:any)=>r.shares>0&&r.cost>0&&r.last>0&&r.covered>0&&r.callShares<=r.shares)).toBe(true);
  expect(view.stocks.some((r:any)=>r.idle>0)).toBe(true);
  expect(view.obligations.every((r:any)=>r.shares>0&&r.callContracts>0&&r.sharesIfCalled>0&&r.unscored===0)).toBe(true);
  expect(dashboard.optionAnalytics!.gaps).toEqual([]);
  expect(cents(dashboard.model!.live.totalValue)).toBe(cents(baseDashboard.model!.live.totalValue));
  expect(dashboard.model!.live.byChannel.map(b=>[b.channel,cents(b.totalValue)])).toEqual(baseDashboard.model!.live.byChannel.map(b=>[b.channel,cents(b.totalValue)]));
  const end=next.demo_completion!.snapshots.at(-1)!;
  expect(cents(end.totalValue)).toBe(cents(Number(book.summary.nav)));
  expect(cents(end.cashAmount!)).toBe(cents(Number(book.summary.cash)));
  expect(end.positions.filter(p=>p.option?.right==='call')).toHaveLength(view.stocks.length);
  expect(cents(end.positions.filter(p=>p.instrument==='equity').reduce((n,p)=>n+p.value,0))).toBe(cents(view.totals.value));
  const journal=buildExecutionJournal(next.option_executions);
  for(const[channel,initial]of Object.entries(next.demo_completion!.initialCash)){
    const purchases=next.demo_completion!.equityLots!.filter(l=>l.channel===channel).map(l=>(l.units*l.entryPrice).toFixed(2));
    const cash=addDecimals(initial,...journal.executions.filter(e=>e.channel===channel).map(e=>addDecimals(e.gross_premium,e.commission!)),...purchases.map(negateDecimal));
    expect(cents(Number(cash))).toBe(cents(next.cash!.find(c=>c.channel===channel)!.amount));
  }
  const normal=structuredClone(next);normal.profile.contact_email='normal@example.com';
  expect(()=>prepareCompletedDemo(normal,market,expandedPlan)).toThrow('isolated');
});


it('models calls with the correct right at expiry, zero volatility and positive volatility',()=>{
  const {book}=demoCompletionFixture(),multiplier=Number(book.multiplier),strike=Number(book.rows[0].strike),spot=strike*2;
  const expiry=book.rows[0].expiry;
  const expired=demoOptionModel(spot,strike,expiry,expiry,0,multiplier,'call');
  expect(expired).toEqual({mark:Number(((spot-strike)*multiplier).toFixed(2)),probability:1});
  const put=demoOptionModel(spot,strike,expiry,book.asOf,0,multiplier,'put');
  const call=demoOptionModel(spot,strike,expiry,book.asOf,0,multiplier,'call');
  expect(put.mark).toBe(0);expect(call.mark).toBeGreaterThanOrEqual(expired.mark);
  const volatileCall=demoOptionModel(strike,strike,expiry,book.asOf,.3,multiplier,'call');
  const volatilePut=demoOptionModel(strike,strike,expiry,book.asOf,.3,multiplier,'put');
  expect(volatileCall.mark).toBeGreaterThan(volatilePut.mark);
  expect(volatileCall.probability+volatilePut.probability).toBeCloseTo(1);
});
