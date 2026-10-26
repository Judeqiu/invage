import {describe,it,expect} from 'vitest';
import {assertBrokerConnectionMetrics} from '../src/state/portfolio-state.js';
import {buildAccountRisk} from '../src/webapp/account-risk-data.js';
import type {DashboardPayload} from '../src/webapp/dashboard-data.js';
import type {InvestorState} from '../src/state/portfolio-state.js';
const now = new Date('2026-10-26T08:00:00Z');
export function riskFixture() {
  const state = {user:{id:'test'},profile:{display_name:'Test'},log:[],broker_sources:{source:{broker_id:'futubull',credentials:{}}},broker_connections:{
    a:{broker_id:'futubull',source_id:'source',label:'Futu',channel:'a',enabled:true,config:{},metrics:{currency:'USD',as_of:'2026-10-25',excess_liquidity:5389.61,buying_power:0}},
    b:{broker_id:'futubull',source_id:'source',label:'Other account',channel:'b',enabled:true,config:{}}}} as unknown as InvestorState;
  const position = (ticker: string,channel:string,strike:number,units:number,currency='USD') => ({ticker,currency,channel,instrument:'option',units,option:{underlying:'SOXL',strike,expiry:'2026-11-06',side:'short',right:'put',multiplier:100,settlement:'physical'}});
  const payload = {generatedAt:'2026-10-26T07:00:00Z',brokerAsOf:{a:'2026-10-25',b:'2026-10-25'},model:{live:{reportingCurrency:'USD',channels:['a','b'],positions:[position('SOXL-A','a',60,5),position('SOXL-B','a',50,5),position('SOXL-C','b',40,2)],byChannel:[{channel:'a',cashAmount:10000,cashCurrency:'USD',totalValue:15000,navComplete:true},{channel:'b',cashAmount:100000,cashCurrency:'USD',totalValue:100000,navComplete:true}]}}} as unknown as DashboardPayload;
  return {state,payload};
}
describe('account risk evidence', () => {
  it('keeps cash separate across accounts, reports gross obligations and shared underlyings', () => {
    const {state,payload}=riskFixture();const result=buildAccountRisk(state,payload,now), a=result.accounts.find(a=>a.channel==='a')!;
    expect(a.grossPutObligation).toBe(55000);expect(a.cash).toBe(10000);expect(a.excess).toBe(5389.61);
    expect(a.findings.map(f=>f.kind)).toEqual(['margin','assignment','expiry','concentration']);
    expect(result.overlaps).toEqual([{underlying:'SOXL',channels:['a','b']}]);
    expect(a.coverage.join(' ')).toMatch(/exact broker warning trigger cannot be confirmed/);
  });
  it('does not substitute total NAV for ELV, invent margin or infer safety from missing data', () => {
    const {state,payload}=riskFixture();delete state.broker_connections!.a.metrics;
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.excess).toBeNull();expect(a.coverage.join(' ')).toMatch(/cannot be assessed/);
    expect(a).not.toHaveProperty('bufferRatio');expect(a).not.toHaveProperty('brokerStatus');
  });
  it('does not publish a partial obligation total when FX or contract inputs are missing', () => {
    const {state,payload}=riskFixture();payload.model!.live.positions[0].currency='HKD';
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.grossPutObligation).toBeNull();expect(a.concentration).toEqual([]);
    expect(a.findings.some(f=>f.kind==='assignment')).toBe(false);
    payload.model!.live.fxApplied=true;payload.model!.live.fxRates={HKD:.13};
    expect(buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!.grossPutObligation).toBe(28900);
  });
  it('does not turn stale or future-dated observations into current alerts', () => {
    const {state,payload}=riskFixture();payload.brokerAsOf!.a='2026-10-01';state.broker_connections!.a.metrics!.as_of='2026-11-01';
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.holdingsFresh).toBe(false);expect(a.metricsFresh).toBe(false);expect(a.findings).toEqual([]);expect(a.status).toBe('unassessed');
  });
  it('withholds complete totals when the broker skipped positions', () => {
    const {state,payload}=riskFixture();state.broker_connections!.a.last_sync={at:now.toISOString(),ok:true,not_imported:['unsupported option position']};
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.grossPutObligation).toBeNull();expect(a.coverage.join(' ')).toMatch(/unsupported option position/);
  });
  it('excludes long legs, cash settlement, and short calls from gross physical put purchases', () => {
    const {state,payload}=riskFixture();payload.model!.live.positions[0].option!.settlement='cash';payload.model!.live.positions[1].option!.right='call';
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.grossPutObligation).toBe(0);expect(a.putLines).toEqual([]);expect(a.upcoming).toHaveLength(2);
  });
  it('quantifies the all-assigned cash gap without treating it as required margin', () => {
    const {state,payload}=riskFixture();const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.assignmentCashGap).toBe(45000);
    expect(a.findings.find(f=>f.kind==='assignment')?.action).toMatch(/broker/);
    expect(buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='b')!.assignmentCashGap).toBe(0);
    payload.model!.live.byChannel[0].cashAmount=null;
    expect(buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!.assignmentCashGap).toBeNull();
  });
  it('prioritizes imminent expiry, while actual margin pressure stays first', () => {
    const {state,payload}=riskFixture();payload.model!.live.positions[0].option!.expiry='2026-10-26';
    let a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.findings[0].title).toBe('Options expire today');expect(a.status).toBe('review');
    state.broker_connections!.a.metrics!.excess_liquidity=-100;
    a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.findings[0].kind).toBe('margin');expect(a.status).toBe('urgent');
  });
  it('includes long options in settlement watch without adding them to put obligations', () => {
    const {state,payload}=riskFixture();for (const p of payload.model!.live.positions) p.option!.side='long';
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.expiries).toHaveLength(2);expect(a.upcoming).toHaveLength(0);expect(a.grossPutObligation).toBe(0);
    expect(a.findings.find(f=>f.kind==='expiry')?.title).toMatch(/Long options/);
  });
  it('reports gross call delivery without inferring naked-call or hedge coverage', () => {
    const {state,payload}=riskFixture();payload.model!.live.positions[0].option!.right='call';
    const a=buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!;
    expect(a.callDeliveries[0].shares).toBe(500);expect(a.findings.some(f=>f.kind==='delivery')).toBe(true);
    expect(a.callDeliveries[0]).not.toHaveProperty('uncovered');
    payload.model!.live.positions[0].option!.multiplier=NaN;
    expect(buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!.callDeliveries[0].shares).toBeNull();
    payload.model!.live.positions[0].option!.settlement='cash';
    expect(buildAccountRisk(state,payload,now).accounts.find(a=>a.channel==='a')!.callDeliveries).toEqual([]);
  });
  it('uses New York date for expiry and rejects invalid calendar dates', () => {
    const {state,payload}=riskFixture();payload.model!.live.positions[0].option!.expiry='2026-10-26';
    const result=buildAccountRisk(state,payload,new Date('2026-10-27T01:00:00Z'));
    expect(result.valuationDate).toBe('2026-10-26');expect(result.accounts[0].expiries[0].dte).toBe(0);
    payload.model!.live.positions[0].option!.expiry='2026-10-32';
    expect(buildAccountRisk(state,payload,now).accounts[0].expiries.some(p=>p.ticker==='SOXL-A')).toBe(false);
  });

  it('accepts a broker margin deficit, rejects nonfinite liquidity and negative requirements', () => {
    expect(assertBrokerConnectionMetrics({as_of:'2026-10-26',currency:'USD',excess_liquidity:-100}).excess_liquidity).toBe(-100);
    for (const metrics of [{excess_liquidity:NaN},{excess_liquidity:Infinity},{maintenance_margin:-100},{buying_power:-100}]) {
      expect(()=>assertBrokerConnectionMetrics({as_of:'2026-10-26',currency:'USD',...metrics})).toThrow();
    }
  });

});
