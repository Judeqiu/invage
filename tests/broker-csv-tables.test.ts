import { describe, expect, it } from 'vitest';
import { assertCsvTablesSpec, runCsvTablesSpec } from '../src/brokers/csv-tables.js';
import { assertBrokerStatement } from '../src/brokers/statement.js';

const IBKR_CSV = `"ClientAccountID","FromDate","ToDate","StartingCash","EndingCash","CurrencyPrimary"
"U20877136","20260820","20260820","12711","12723","BASE_SUMMARY"
"U20877136","20260820","20260820","10000","10000","USD"
"ClientAccountID","Symbol","Quantity","MarkPrice","PositionValue","CostBasisPrice","CostBasisMoney","CurrencyPrimary","AssetClass","PercentOfNAV"
`;

const SPEC = {
  kind: 'csv_tables' as const,
  skipCurrencies: ['BASE_SUMMARY'],
  cash: {
    headerMustInclude: ['EndingCash', 'CurrencyPrimary'],
    columns: {
      accountId: 'ClientAccountID',
      fromDate: 'FromDate',
      toDate: 'ToDate',
      currency: 'CurrencyPrimary',
      amount: 'EndingCash',
    },
  },
  positions: {
    headerMustInclude: ['Symbol', 'AssetClass'],
    columns: {
      accountId: 'ClientAccountID',
      symbol: 'Symbol',
      quantity: 'Quantity',
      currency: 'CurrencyPrimary',
      assetCategory: 'AssetClass',
      markPrice: 'MarkPrice',
      costBasisPrice: 'CostBasisPrice',
      costBasisMoney: 'CostBasisMoney',
    },
  },
};

describe('csv_tables generated parser', () => {
  it('reads IBKR Flex CSV cash and empty positions', () => {
    const spec = assertCsvTablesSpec(SPEC);
    const doc = runCsvTablesSpec(IBKR_CSV, spec, 'ibkr');
    expect(doc.account_id).toBe('U20877136');
    expect(doc.from_date).toBe('2026-08-20');
    expect(doc.as_of).toBe('2026-08-20');
    expect(doc.cash).toEqual([{ currency: 'USD', amount: 10000 }]);
    expect(doc.lots).toEqual([]);
  });

  it('still loads saved specs that mapped endingCash (pre-public-field name)', () => {
    const legacy = {
      ...SPEC,
      cash: {
        headerMustInclude: ['EndingCash', 'CurrencyPrimary'],
        columns: {
          accountId: 'ClientAccountID',
          fromDate: 'FromDate',
          toDate: 'ToDate',
          currency: 'CurrencyPrimary',
          endingCash: 'EndingCash',
        },
      },
    };
    const spec = assertCsvTablesSpec(legacy);
    expect(spec.cash.columns.amount).toBe('EndingCash');
    expect(spec.cash.columns.endingCash).toBeUndefined();
    const doc = runCsvTablesSpec(IBKR_CSV, spec, 'ibkr');
    expect(doc.cash).toEqual([{ currency: 'USD', amount: 10000 }]);
  });

  it('fails when required cash columns are omitted from the spec', () => {
    expect(() =>
      assertCsvTablesSpec({
        ...SPEC,
        cash: { headerMustInclude: ['EndingCash'], columns: { currency: 'CurrencyPrimary' } },
      }),
    ).toThrow(/cash.columns/);
  });

  it('csv_tables output is the public books statement, not Flex rows', () => {
    const doc = runCsvTablesSpec(IBKR_CSV, assertCsvTablesSpec(SPEC), 'ibkr');
    expect(() => assertBrokerStatement(doc)).not.toThrow();
    expect('openPositions' in doc).toBe(false);
    expect(doc.cash[0]).not.toHaveProperty('endingCash');
  });
});

describe('BrokerStatement (public books snapshot)', () => {
  it('rejects Flex vendor field names', () => {
    expect(() =>
      assertBrokerStatement({
        accountId: 'U1',
        fromDate: '2026-08-20',
        toDate: '2026-08-20',
        cash: [{ currency: 'USD', endingCash: 1 }],
        openPositions: [],
      }),
    ).toThrow(/books snapshot/);
  });

  it('accepts lots as Holding + cash.amount', () => {
    const doc = assertBrokerStatement({
      account_id: 'U1',
      as_of: '2026-08-20',
      cash: [{ currency: 'USD', amount: 1000, settled_amount: 900 }],
      lots: [
        {
          ticker: 'AAPL',
          currency: 'USD',
          holding: {
            instrument: 'equity',
            avg_price: 150,
            units: 10,
            broker_ref: { native_id: '265598' },
          },
        },
      ],
      skipped: [],
    });
    expect(doc.lots[0].holding.broker_ref?.native_id).toBe('265598');
    expect(doc.cash[0].settled_amount).toBe(900);
  });
});
