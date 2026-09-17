import { describe, expect, it } from 'vitest';
import { parseFlexOptionExecutions } from '../src/ibkr/flex-executions.js';
import { mergeOptionExecutions, buildExecutionJournal } from '../src/brokers/option-executions.js';

export const trade = (attrs = '') => `<Trade accountId="U1" levelOfDetail="EXECUTION" assetCategory="OPT" tradeID="1" conid="123" dateTime="20260909;103015" buySell="SELL" openCloseIndicator="O" quantity="-2" multiplier="100" underlyingSymbol="PATH" putCall="C" strike="20" expiry="20270319" currency="USD" proceeds="5140.00" ibCommission="-1.23456789" ibCommissionCurrency="USD" ${attrs}/>`;
export const statement = (rows: string) => `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" fromDate="20260909" toDate="20260909"><Trades>${rows}</Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

describe('option execution journal', () => {
  it('retains individual premium, exact commission and broker local timestamp', () => {
    const rows = parseFlexOptionExecutions(statement(trade()))!;
    expect(rows[0]).toMatchObject({ executed_at: '2026-09-09T10:30:15', gross_premium: '5140.00', commission: '-1.23456789', expiry: '2027-03-19', contracts: '2' });
    const journal = buildExecutionJournal(rows);
    expect(journal.executions[0].net_premium).toBe('5138.76543211');
    expect(journal.daily[0].net_premium).toBe('5138.76543211');
  });
  it('deduplicates overlapping imports, rejects conflicts and separates accounts', () => {
    const rows = parseFlexOptionExecutions(statement(trade()))!;
    expect(mergeOptionExecutions(rows, rows)).toHaveLength(1);
    expect(() => mergeOptionExecutions(rows, [{ ...rows[0], commission: '-2' }])).toThrow(/conflict/i);
    expect(mergeOptionExecutions(rows, [{ ...rows[0], account_id: 'U2' }])).toHaveLength(2);
  });
  it('subtracts buybacks and their commissions without using cumulative position cost', () => {
    const close = trade().replace('tradeID="1"', 'tradeID="2"').replace('buySell="SELL"', 'buySell="BUY"').replace('openCloseIndicator="O"', 'openCloseIndicator="C"').replace('quantity="-2"', 'quantity="2"').replace('proceeds="5140.00"', 'proceeds="-1200.00"');
    const j = buildExecutionJournal(parseFlexOptionExecutions(statement(trade() + close))!);
    expect(j.executions).toHaveLength(2);
    expect(j.daily[0].net_premium).toBe('3937.53086422');
  });
  it('distinguishes absent history from an empty execution report and ignores summaries', () => {
    expect(parseFlexOptionExecutions(statement('').replace('<Trades></Trades>', ''))).toBeUndefined();
    expect(parseFlexOptionExecutions(statement(''))).toEqual([]);
    expect(() => parseFlexOptionExecutions(statement(trade().replace('EXECUTION', 'ORDER')))).toThrow(/Select Executions/);
    expect(parseFlexOptionExecutions(statement(trade() + trade().replace('EXECUTION', 'ORDER')))).toHaveLength(1);
  });
  it('rejects malformed XML and duplicate attributes; comments do not create trades', () => {
    expect(() => parseFlexOptionExecutions(statement(trade()).replace('</Trades>', ''))).toThrow();
    expect(() => parseFlexOptionExecutions(statement(trade('tradeID="2"')))).toThrow();
    expect(parseFlexOptionExecutions(statement(`<!-- ${trade()} -->`))).toEqual([]);
  });
  it('separates currency totals and excludes long-option actions from short-option premium', () => {
    const rows = parseFlexOptionExecutions(statement(trade()))!;
    const journal = buildExecutionJournal([...rows,
      { ...rows[0], execution_id: '2', currency: 'HKD' },
      { ...rows[0], execution_id: '3', side: 'buy', gross_premium: '-100' },
    ]);
    expect(journal.executions).toHaveLength(3);
    expect(journal.daily).toHaveLength(2);
    expect(journal.cumulative.map(row => row.net_premium)).toEqual(['5138.76543211', '5138.76543211']);
  });
  it.each([
    ['commission', trade().replace('ibCommission="-1.23456789"', '')],
    ['currency', trade().replace('ibCommissionCurrency="USD"', 'ibCommissionCurrency="HKD"')],
    ['account', trade().replace('accountId="U1"', 'accountId="U2"')],
    ['date', trade().replace('20260909;103015', '20260230;103015')],
    ['action', trade().replace('openCloseIndicator="O"', 'openCloseIndicator="O;C"')],
    ['correction', trade('origTradeID="123"')],
  ])('fails on invalid %s', (_name, row) => {
    expect(() => parseFlexOptionExecutions(statement(row))).toThrow();
  });
});
