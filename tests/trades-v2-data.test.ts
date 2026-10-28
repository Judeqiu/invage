import { expect, it } from 'vitest';
import { tradesOpenBook, tradesHistory } from '../src/webapp/trades-v2-data.js';
import { optionFill, tradesFixture } from './helpers/trades-fixture.js';
import type { OptionLifecycleEvent } from '../src/brokers/option-events.js';
const event = (patch: Partial<OptionLifecycleEvent> = {}): OptionLifecycleEvent => ({ id:'expiry',broker_id:'ibkr',channel:'ibkr',account_id:'U1',underlying:'AAPL',right:'put',strike:'150',expiry:'2027-01-15',multiplier:'100',date:'2027-01-15',kind:'expiration',settlement:'physical',contracts:'1',currency:'USD',source:'ibkr_flex',fees:'0',...patch });

it('reconciles still-open premium and dates, never substitutes book cost for missing fills', () => {
  const state = tradesFixture(), row = tradesOpenBook(state).rows[0];
  expect(row).toMatchObject({entryDate:'2026-09-10',contracts:'1',premium:'300.06172839',netCash:'299.01172839'});
  expect(row.returnsPct).toBeCloseTo(2.0004115226);
  expect(row.executions).toHaveLength(1);
  delete state.option_executions;
  expect(tradesOpenBook(state).rows[0]).toMatchObject({entryDate:null,premium:null,netCash:null,returnsPct:null});
});
it('separates partial closes and same-contract reopenings, with exact decimal money and stable fill IDs', () => {
  const s = tradesFixture();
  s.option_executions!.push(optionFill({execution_id:'close-2',executed_at:'2026-10-02T10:00:00',side:'buy',effect:'close',contracts:'1',gross_premium:'-49.99',commission:'-1.05'}));
  const closed = tradesHistory(s).rows[0];
  expect(closed).toMatchObject({status:'Closed',contracts:'2',premium:'600.12345678',paidToClose:'100.00',realizedPnl:'495.92345678',feeBasis:'net'});
  s.option_executions!.push(optionFill({execution_id:'reopen',executed_at:'2026-10-02T11:00:00',contracts:'1',gross_premium:'100'}));
  const rows = tradesHistory(s).rows;
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map(r => r.id)).size).toBe(2);
  expect(new Set(rows.map(r => r.optionId)).size).toBe(1);
  expect(rows.find(r => r.status === 'Closed')!.executions).toEqual(closed.executions);
});
it('withholds profit for unmatched closes, physical assignment and absent settlement proceeds', () => {
  const s = tradesFixture(); s.portfolio = {}; s.option_executions = [optionFill({contracts:'1',gross_premium:'100'})];
  s.option_events = [event({kind:'assignment'})];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Assigned',realizedPnl:null});
  s.option_events = [event({kind:'assignment',broker_realized_pl:'87.12345'})];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Assigned',realizedPnl:'87.12345',feeBasis:'broker'});
  s.option_events = [event({kind:'cash_settlement',settlement:'cash'})];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Cash settled',realizedPnl:null});
  s.option_events = []; s.option_executions = [optionFill({side:'buy',effect:'close',gross_premium:'-10'})];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Incomplete history',entryDate:null,realizedPnl:null,netCash:null});
});
it('uses explicit expiration and shows gross profit when commission evidence is incomplete', () => {
  const s = tradesFixture(); s.portfolio = {}; s.option_executions = [optionFill({contracts:'1',gross_premium:'100',commission:null})];
  s.option_events = [event()];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Expired',realizedPnl:'100',feeBasis:'gross'});
  s.option_events = [];
  expect(tradesHistory(s).rows[0]).toMatchObject({status:'Unverified',realizedPnl:null});
});
it('does not promote timing-only roll candidates into confirmed rolls', () => {
  const s = tradesFixture(); s.option_executions = [optionFill({contracts:'1'}),optionFill({execution_id:'close',contracts:'1',side:'buy',effect:'close',gross_premium:'-10',executed_at:'2026-10-01T10:00:00'})];
  const relation: any = {channel:'ibkr',account_id:'U1',side:'short',closing_fills:['close'],evidence:'possible'};
  expect(tradesHistory(s,[relation]).rows[0].rolled).toBe(false);
  expect(tradesHistory(s,[{...relation,evidence:'order'}]).rows[0].rolled).toBe(true);
});
it('withholds profit when closing and reopening ordering is ambiguous at the same timestamp', () => {
  const s = tradesFixture();s.option_executions = [optionFill({contracts:'1'}),
    optionFill({execution_id:'close',contracts:'1',executed_at:'2026-10-01T10:00:00',side:'buy',effect:'close',gross_premium:'-10'}),
    optionFill({execution_id:'reopen',contracts:'1',executed_at:'2026-10-01T10:00:00',gross_premium:'200'})];
  expect(tradesHistory(s).rows.every(r => r.realizedPnl === null)).toBe(true);
});
it('keeps date-only lifecycle events separate from same-day fills without inventing their ordering', () => {
  const s = tradesFixture();s.portfolio = {};s.option_executions = [optionFill({contracts:'1',executed_at:'2027-01-15T10:00:00'})];
  s.option_events = [event()];
  const rows = tradesHistory(s).rows;
  expect(rows).toHaveLength(2);
  expect(rows.every(r => r.realizedPnl === null)).toBe(true);
  expect(rows.some(r => r.status === 'Expired')).toBe(true);
});

it.each(['mixed', 'unknown'] as const)('retains %s executions without treating them as pure closes', effect => {
  const s = tradesFixture();
  s.portfolio = {};
  s.option_executions = [optionFill(), optionFill({ execution_id: 'mixed', effect, contracts: '3', side: 'buy', gross_premium: '-300', executed_at: '2026-10-01T10:00:00' })];
  const rows = tradesHistory(s).rows;
  const mixed = rows.find(row => row.executions.some(e => e.execution_id === 'mixed'))!;
  expect(mixed).toMatchObject({ status: 'Unresolved', side: 'unknown', realizedPnl: null });
  expect(rows.every(row => row.realizedPnl === null)).toBe(true);
});

it.each(['moomoo', 'tiger', 'webull', 'ibkr'])('shows retained %s option fills with missing metadata without inventing cash', broker => {
  const s = tradesFixture(); s.portfolio = {}; s.option_executions = [];
  const source: import('../src/brokers/history.js').BrokerHistoryExecution = {
    broker_id:broker, channel:broker, account_id:'A1', id:'source-fill', order_id:'parent',
    native_symbol:'EXPIRED-PUT', symbol:'AAPL', instrument:'option', side:'buy', effect:'close',
    executed_at:'2026-07-18T10:00:00', clock:'America/New_York', currency:'USD',
    quantity:'2', price:'-0.25', multiplier:null, gross_cash:null, fee_cash:'0',
    option:{right:'put',expiry:'2026-07-17',strike:'150'},
  };
  s.broker_history = { [broker]:{ broker_id:broker, channel:broker, account_id:'A1', executions:[source], orders:[],
    sync:{version:1,mode:'full',from:'2000-01-01T00:00:00Z',through:'2026-10-28T00:00:00Z',status:'partial',full_history_synced:false,fees:'partial',gaps:[]} } };
  const before = JSON.stringify(s), history = tradesHistory(s), row = history.rows[0];
  expect(history.available).toBe(true);
  expect(history.rows).toHaveLength(1);
  expect(row).toMatchObject({status:'Incomplete history',side:'short',entryDate:null,lastTrade:'2026-07-18',contracts:'2',multiplier:null,premium:null,paidToClose:null,realizedPnl:null,returnsPct:null});
  expect(row.sourceExecutions).toEqual([source]);
  expect(JSON.stringify(s)).toBe(before);
  expect(tradesHistory(s).rows[0].id).toBe(row.id);
  // IDs are scoped to accounts even when brokers reuse execution IDs.
  s.broker_history[broker].account_id = source.account_id = 'A2';
  expect(tradesHistory(s).rows[0].id).not.toBe(row.id);
});

it('does not duplicate projected fills and replaces source-only rows after metadata recovery', () => {
  const s = tradesFixture(); s.portfolio = {};
  const fill = s.option_executions![0];
  const source: import('../src/brokers/history.js').BrokerHistoryExecution = {
    broker_id:'ibkr', channel:fill.channel, account_id:fill.account_id, id:fill.execution_id, order_id:null,
    native_symbol:fill.contract_id, symbol:fill.underlying, instrument:'option', side:fill.side, effect:fill.effect,
    executed_at:fill.executed_at, clock:'America/New_York', currency:fill.currency, quantity:fill.contracts,
    price:null, multiplier:null, gross_cash:null, fee_cash:fill.commission,
    option:{right:fill.right,expiry:fill.expiry,strike:fill.strike},
  };
  s.broker_history = { ibkr:{broker_id:'ibkr',channel:fill.channel,account_id:fill.account_id,executions:[source],orders:[],
    sync:{version:1,mode:'full',from:'2000-01-01T00:00:00Z',through:'2026-10-28T00:00:00Z',status:'partial',full_history_synced:false,fees:'partial',gaps:[]}} };
  expect(tradesHistory(s).rows.some(r => r.sourceExecutions)).toBe(false);
  s.option_executions = [];
  expect(tradesHistory(s).rows[0].sourceExecutions).toEqual([source]);
  source.multiplier = fill.multiplier; source.gross_cash = fill.gross_premium;
  s.option_executions = [fill];
  expect(tradesHistory(s).rows).toHaveLength(1);
  expect(tradesHistory(s).rows[0].sourceExecutions).toBeUndefined();
});
