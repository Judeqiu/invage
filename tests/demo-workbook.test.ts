import { expect, it, vi } from 'vitest';
import { blankState } from 'utarus';
import { DEMO_EMAIL, DEMO_NAME, seedSyntheticPortfolio, syntheticDashboard } from '../src/demo/showcase.js';
import { assertDemoWorkbook, demoWorkbookForState, workbookJournal, workbookPortfolioEvidence, type DemoWorkbook } from '../src/demo/workbook.js';
import { queryOptionTrades } from '../src/tools/option_trades.js';
import type { InvestorState } from '../src/state/portfolio-state.js';
import { buildPageProjections } from '../src/report/page-projections.js';
import { buildBrokerProjections } from '../src/report/broker-projections.js';
import { tradesOpenBook, tradesHistory } from '../src/webapp/trades-v2-data.js';
import { portfolioFingerprint } from '../src/state/projection-store.js';

function fixture() {
  const state = blankState({ displayName: DEMO_NAME, contactEmail: DEMO_EMAIL, language: 'en' }) as InvestorState;
  seedSyntheticPortfolio(state);
  const original = syntheticDashboard(state), amount = String(original.model!.live.cashAmount);
  const book: DemoWorkbook = { version: 1, asOf: original.generatedAt.slice(0,10), currency: 'USD', multiplier: '100',
    source: { sha256: 'a'.repeat(64), fileId: 'imports/demo-workbook/Demo data.xlsx' },
    summary: { premiumDaily:amount, premiumMtd:amount, premiumTotal:amount, feesMtd:amount, feesTotal:amount,
      earnedDaily:null, earnedMtd:amount, earnedTotal:amount, nav:amount, cash:amount, assignment:amount, riskCapital:amount },
    rows: Object.entries(state.portfolio!).filter(([,h]) => h.option?.right === 'put').map(([id,h],i) => ({
      sheet:id, row:i+2, channel:'ibkr', brokerId:'ibkr', underlying:h.option!.underlying, description:id,
      entryDate:original.generatedAt.slice(0,10), expiry:h.option!.expiry, strike:String(h.option!.strike),
      contracts:String(h.units), credit:String(h.avg_price*h.units), debit:String(h.option!.mark*h.units), fees:'-2',
    })) };
  state.demo_workbook=book; state.portfolio={}; state.option_executions=[]; state.cash=[];
  return {state,book};
}
it('reproduces independent source totals without inventing market prices, fills or completed profit', () => {
  const {state,book}=fixture(), before=structuredClone(state);
  assertDemoWorkbook(book);
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('No live demo requests'));
  try {
    const dashboard=syntheticDashboard(state), pages=buildPageProjections(dashboard), scope=pages.dashboard.live.merged as any;
    expect(dashboard.model!.live.positions).toHaveLength(book.rows.length);
    expect(dashboard.model!.live.positions.every(p=>p.cost===null && p.price===null && p.option!.mark===null)).toBe(true);
    expect(scope.view.totalValue).toBe(Number(book.summary.nav));
    expect(scope.view.cashAmount).toBe(Number(book.summary.cash));
    expect(scope.premium.total).toBe(Number(book.summary.premiumTotal));
    expect(scope.premium.fees).toBe(Number(book.summary.feesMtd));
    expect(scope.realized[''].value).toBe(Number(book.summary.earnedTotal));
    expect(scope.realized[scope.premium.dailyFrom].value).toBeNull();
    expect(scope.assignmentObligation).toBe(Number(book.summary.assignment));
    expect(scope.workbookRiskCapital.value).toBe(Number(book.summary.riskCapital));
    const open=tradesOpenBook(state);
    expect(open.rows).toHaveLength(book.rows.length);
    expect(open.rows.every(r=>r.premium===null && r.realizedPnl===null && !r.executions.length)).toBe(true);
    expect(tradesHistory(state).rows).toEqual([]);
    expect(workbookJournal(book).executions).toEqual([]);
    expect(workbookPortfolioEvidence(state)!.current_positions).toHaveLength(book.rows.length);
    expect(queryOptionTrades(state,{},{}).worksheet_rows).toEqual(book.rows);
    expect(queryOptionTrades(state,{},{start_date:book.rows[0].expiry}).worksheet_rows).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  } finally {fetch.mockRestore();}
});
it('keeps signed row cash and fees in broker scopes without allocating the combined summary', () => {
  const {state,book}=fixture(), dashboard=syntheticDashboard(state);
  const broker=buildBrokerProjections(state,dashboard,tradesOpenBook(state).rows,[]).ibkr;
  const scope=broker.scopes.live.merged as any;
  expect(broker.nav).toBeNull();
  expect(broker.totals!.cashAmount).toBeNull();
  expect(scope.view.totalValue).toBeNull();
  expect(scope.workbookRiskCapital).toBeUndefined();
  expect(scope.realized[''].value).toBeNull();
  expect(scope.premium.total).toBe(book.rows.reduce((n,r)=>n+Number(r.credit)-Number(r.debit),0));
  expect(scope.premium.totalFees).toBe(book.rows.reduce((n,r)=>n+Number(r.fees),0));
  expect(broker.journal.executions).toEqual([]);
});
it('binds projection validity to source content and isolates normal accounts', () => {
  const {state,book}=fixture(), before=portfolioFingerprint(state);
  book.summary.nav=String(Number(book.summary.nav)+1);
  expect(portfolioFingerprint(state)).not.toBe(before);
  state.profile.contact_email='customer@example.com';
  expect(demoWorkbookForState(state)).toBeUndefined();
  expect(()=>syntheticDashboard(state)).toThrow('synthetic demo');
});
it('rejects duplicate source coordinates, missing amounts and invalid dates', () => {
  const {book}=fixture();
  const duplicate=structuredClone(book);duplicate.rows.push(duplicate.rows[0]);
  expect(()=>assertDemoWorkbook(duplicate)).toThrow('Duplicate');
  const missing=structuredClone(book);delete (missing.summary as any).nav;
  expect(()=>assertDemoWorkbook(missing)).toThrow('decimal');
  const date=structuredClone(book);date.rows[0].expiry='invalid';
  expect(()=>assertDemoWorkbook(date)).toThrow('row');
});
