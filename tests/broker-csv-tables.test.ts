import { describe, expect, it } from 'vitest';
import { assertCsvTablesSpec, runCsvTablesSpec } from '../src/brokers/csv-tables.js';

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
      endingCash: 'EndingCash',
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
    const doc = runCsvTablesSpec(IBKR_CSV, spec);
    expect(doc.accountId).toBe('U20877136');
    expect(doc.fromDate).toBe('2026-08-20');
    expect(doc.toDate).toBe('2026-08-20');
    expect(doc.cash).toEqual([{ currency: 'USD', endingCash: 10000 }]);
    expect(doc.openPositions).toEqual([]);
  });

  it('fails when required cash columns are omitted from the spec', () => {
    expect(() =>
      assertCsvTablesSpec({
        ...SPEC,
        cash: { headerMustInclude: ['EndingCash'], columns: { currency: 'CurrencyPrimary' } },
      }),
    ).toThrow(/cash.columns/);
  });
});
