import { describe, expect, it } from 'vitest';
import { parseFlexQueryXml } from '../src/ibkr/flex-parse.js';
import { mapFlexDocToStatement } from '../src/ibkr/flex-map.js';
import { mapFlexHistory } from '../src/ibkr/flex-history.js';
import { mergeBrokerHistory, optionExecutionsFromHistory } from '../src/brokers/history.js';
import { buildExecutionJournal } from '../src/brokers/option-executions.js';
import { parseRelationshipArchive } from '../src/brokers/option-relationships.js';

const option = '<Trade tradeID="o" conid="123" dateTime="20261020;100000" levelOfDetail="EXECUTION" assetCategory="OPT" underlyingSymbol="AMD" multiplier="100" strike="150" expiry="20261120" putCall="P" quantity="2" proceeds="-200.00" buySell="BUY" openCloseIndicator="C;O" ibCommission="-1.25" ibCommissionCurrency="USD" currency="USD"/>';
const stock = '<Trade tradeID="s" conid="456" dateTime="20261020;100001" levelOfDetail="EXECUTION" assetCategory="STK" multiplier="1" quantity="2" proceeds="-100.00" buySell="BUY" currency="USD"/>';
const xml = `<FlexQueryResponse><FlexStatement accountId="A" fromDate="20261001" toDate="20261020"><OpenPositions><OpenPosition accountId="A" currency="USD" assetCategory="OPT" symbol="AMD   261120P00150000" position="1" costBasisMoney="100" markPrice="1"/></OpenPositions><CashReport><CashReportCurrency currency="USD" endingCash="500"/></CashReport><Trades>${option}${stock}</Trades></FlexStatement></FlexQueryResponse>`;
const plan = { mode: 'full' as const, from: '2026-10-01T00:00:00Z', through: '2026-10-20T23:59:59Z' };
const history = (body = xml) => mapFlexHistory([{ xml: body, from: '20261001', through: '20261020' }], 'A', 'ibkr-A', plan, [], false);

describe('usable IBKR evidence without redundant fields', () => {
  it('imports current positions and exact mixed execution cash without row accounts, prices or stock tickers', () => {
    const statement = mapFlexDocToStatement(parseFlexQueryXml(xml), 'ibkr-A');
    expect(statement.skipped).toEqual([]);
    expect(statement.lots[0].holding.option).toMatchObject({ underlying: 'AMD', strike: 150, multiplier: 100 });
    const h = history();
    expect(h.executions).toHaveLength(2);
    expect(h.executions[0]).toMatchObject({ effect: 'mixed', price: null, quantity: '2' });
    expect(h.executions[1]).toMatchObject({ symbol: null, price: null, gross_cash: '-100.00', fee_cash: null });
    const journal = buildExecutionJournal(optionExecutionsFromHistory(mergeBrokerHistory(h, h)));
    expect(journal.executions).toHaveLength(1);
    expect(journal.daily[0]).toMatchObject({ gross_premium: '-200.00', net_premium: '-201.25' });
    expect(parseRelationshipArchive('ibkr', Buffer.from(xml), 'A', { id: 'test', version: '1' })[0])
      .toMatchObject({ effect: 'mixed', cash: '-201.25', order: '' });
  });
  it('enriches missing prices on overlap, keeps known prices and still rejects conflicting money', () => {
    const unpriced = history();
    const priced = history(xml.replace('tradeID="o"', 'tradePrice="1" tradeID="o"'));
    expect(mergeBrokerHistory(unpriced, priced).executions[0].price).toBe('1');
    expect(mergeBrokerHistory(priced, unpriced).executions[0].price).toBe('1');
    expect(() => mergeBrokerHistory(priced, history(xml.replace('tradeID="o"', 'tradePrice="2" tradeID="o"')))).toThrow(/Conflicting/);
  });
  it('never assumes a multiplier where matching broker contract evidence is absent or ambiguous', () => {
    const unrelated = xml.replace('conid="123"', 'conid="999"').replace('strike="150"', 'strike="151"');
    expect(mapFlexDocToStatement(parseFlexQueryXml(unrelated), 'ibkr-A').skipped).toContainEqual(expect.objectContaining({ reason: 'option missing multiplier' }));
    const conflicting = xml.replace('</Trades>', `${option.replace('tradeID="o"', 'tradeID="different-size"').replace('multiplier="100"', 'multiplier="10"')}</Trades>`);
    expect(mapFlexDocToStatement(parseFlexQueryXml(conflicting), 'ibkr-A').skipped).toContainEqual(expect.objectContaining({ reason: 'option missing multiplier' }));
  });
  it('accepts equivalent ISO clocks, ISO expiries and spelled-out option rights across readers', () => {
    const iso = xml.replace('20261020;100000', '2026-10-20T10:00:00').replace('expiry="20261120"', 'expiry="2026-11-20"').replace('putCall="P"', 'putCall="PUT"');
    expect(parseFlexQueryXml(iso).optionExecutions![0]).toMatchObject({ executed_at: '2026-10-20T10:00:00', right: 'put', expiry: '2026-11-20' });
    expect(history(iso).executions[0].executed_at).toBe('2026-10-20T10:00:00');
    expect(parseRelationshipArchive('ibkr', Buffer.from(iso), 'A', { id: 'test', version: '1' })[0].at).toBe('2026-10-20T10:00:00');
  });
});
