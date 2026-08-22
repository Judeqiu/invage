import { describe, expect, it } from 'vitest';
import { parseFlexQueryXml } from '../src/ibkr/flex-parse.js';
import { holdingsFromOpenPositions, yahooSymbolFromFlex } from '../src/ibkr/flex-map.js';
import { replaceChannelCash, replaceChannelHoldings } from '../src/ibkr/flex-apply.js';
import { FlexHttpError, fetchFlexStatement } from '../src/ibkr/flex-client.js';
import { createBookkeeperTools } from '../src/tools/index.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20260811" toDate="20260817" period="Last7CalendarDays" whenGenerated="20260818;090000">
      <OpenPositions>
        <OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" conid="265598" listingExchange="NASDAQ" quantity="10" multiplier="1" costBasisPrice="150" costBasisMoney="1500" markPrice="190" positionValue="1900" />
        <OpenPosition accountId="U1234567" currency="USD" assetCategory="OPT" symbol="AAPL  250117C00200000" underlyingSymbol="AAPL" conid="1" listingExchange="CBOE" quantity="-2" multiplier="100" strike="200" expiry="20250117" putCall="C" costBasisMoney="530" markPrice="3.10" />
        <OpenPosition accountId="U1234567" currency="USD" assetCategory="CASH" symbol="USD" quantity="100" />
      </OpenPositions>
      <CashReport>
        <CashReportCurrency accountId="U1234567" currency="USD" endingCash="4200.50" />
      </CashReport>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

describe('parseFlexQueryXml', () => {
  it('reads statement window, open positions, and cash', () => {
    const doc = parseFlexQueryXml(SAMPLE);
    expect(doc.accountId).toBe('U1234567');
    expect(doc.fromDate).toBe('2026-08-11');
    expect(doc.toDate).toBe('2026-08-17');
    expect(doc.openPositions).toHaveLength(3);
    expect(doc.cash).toEqual([{ currency: 'USD', endingCash: 4200.5 }]);
  });

  it('fails when OpenPositions wrapper is missing', () => {
    expect(() =>
      parseFlexQueryXml(
        SAMPLE.replace('<OpenPositions>', '').replace('</OpenPositions>', ''),
      ),
    ).toThrow(/missing OpenPositions/);
  });

  it('allows empty OpenPositions', () => {
    const xml = SAMPLE.replace(
      /<OpenPositions>[\s\S]*<\/OpenPositions>/,
      '<OpenPositions></OpenPositions>',
    );
    expect(parseFlexQueryXml(xml).openPositions).toEqual([]);
  });

  it('fails when CashReport wrapper is missing', () => {
    expect(() =>
      parseFlexQueryXml(SAMPLE.replace('<CashReport>', '').replace('</CashReport>', '')),
    ).toThrow(/missing CashReport/);
  });

  it('fails when CashReport has no currency rows', () => {
    const xml = SAMPLE.replace(
      /<CashReport>[\s\S]*<\/CashReport>/,
      '<CashReport></CashReport>',
    );
    expect(() => parseFlexQueryXml(xml)).toThrow(/CashReport has no currency rows/);
  });

  it('accepts endingCash 0', () => {
    const xml = SAMPLE.replace('endingCash="4200.50"', 'endingCash="0"');
    expect(parseFlexQueryXml(xml).cash).toEqual([{ currency: 'USD', endingCash: 0 }]);
  });

  it('fails on IBKR error envelope', () => {
    expect(() =>
      parseFlexQueryXml(
        `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Token is invalid.</ErrorMessage></FlexStatementResponse>`,
      ),
    ).toThrow(/1015/);
  });

  it('fails on Warn 1018 rate-limit envelope', () => {
    expect(() =>
      parseFlexQueryXml(
        `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1018</ErrorCode><ErrorMessage>Too many requests have been made from this token. Please try again shortly.</ErrorMessage></FlexStatementResponse>`,
      ),
    ).toThrow(/1018/);
  });

  it('fails when the query returns CSV instead of XML', () => {
    expect(() =>
      parseFlexQueryXml(
        `"ClientAccountID","FromDate","ToDate","EndingCash","CurrencyPrimary"\n"U20877136","20260820","20260820","10000","USD"\n`,
      ),
    ).toThrow(/CSV/);
  });

  it('drops BASE_SUMMARY cash rows and keeps every ISO sleeve', () => {
    const xml = SAMPLE.replace(
      /<CashReport>[\s\S]*<\/CashReport>/,
      `<CashReport>
        <CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="12723" />
        <CashReportCurrency accountId="U1234567" currency="USD" endingCash="10000" />
        <CashReportCurrency accountId="U1234567" currency="HKD" endingCash="50" />
      </CashReport>`,
    );
    const doc = parseFlexQueryXml(xml);
    expect(doc.cash).toEqual([
      { currency: 'USD', endingCash: 10000 },
      { currency: 'HKD', endingCash: 50 },
    ]);
    expect(doc.skipped.some((s) => s.currency === 'BASE_SUMMARY')).toBe(false);
  });

  it('fails when CashReport is only BASE_SUMMARY', () => {
    const xml = SAMPLE.replace(
      /<CashReport>[\s\S]*<\/CashReport>/,
      `<CashReport>
        <CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="12723" />
      </CashReport>`,
    );
    expect(() => parseFlexQueryXml(xml)).toThrow(/CashReport has no currency rows/);
  });
});

describe('holdingsFromOpenPositions', () => {
  it('maps stocks and options; skips cash lots', () => {
    const doc = parseFlexQueryXml(SAMPLE);
    const { lots, skipped } = holdingsFromOpenPositions(doc.openPositions, 'ibkr');
    expect(lots.map((l) => l.mapKey)).toEqual(['AAPL@ibkr', 'AAPL-C-200-20250117-S@ibkr']);
    expect(lots[0].holding).toMatchObject({
      instrument: 'equity',
      units: 10,
      avg_price: 150,
      channel: 'ibkr',
    });
    expect(lots[1].holding.instrument).toBe('option');
    expect(lots[1].holding.units).toBe(2);
    expect(lots[1].holding.option?.side).toBe('short');
    expect(lots[1].holding.option?.right).toBe('call');
    expect(lots[1].holding.option?.mark).toBe(310);
    expect(skipped).toEqual([]);
  });

  it('imports mappable lots and reports unsupported assetCategory', () => {
    const fut: import('../src/ibkr/flex-parse.js').FlexOpenPosition = {
      accountId: 'U1234567',
      currency: 'USD',
      assetCategory: 'FUT',
      symbol: 'ES',
      quantity: 2,
      raw: {},
    };
    const aapl: import('../src/ibkr/flex-parse.js').FlexOpenPosition = {
      accountId: 'U1234567',
      currency: 'USD',
      assetCategory: 'STK',
      symbol: 'AAPL',
      quantity: 10,
      costBasisPrice: 150,
      raw: {},
    };
    const { lots, skipped } = holdingsFromOpenPositions([aapl, fut], 'ibkr');
    expect(lots.map((l) => l.mapKey)).toEqual(['AAPL@ibkr']);
    expect(skipped).toEqual([
      expect.objectContaining({ kind: 'position', symbol: 'ES', assetCategory: 'FUT' }),
    ]);
  });

  it('reports short stock instead of aborting the pull', () => {
    const { lots, skipped } = holdingsFromOpenPositions(
      [
        {
          accountId: 'U1',
          currency: 'USD',
          assetCategory: 'STK',
          symbol: 'TSLA',
          quantity: -5,
          costBasisPrice: 200,
          raw: {},
        },
      ],
      'ibkr',
    );
    expect(lots).toEqual([]);
    expect(skipped[0]?.reason).toMatch(/short stock/);
  });

  it('maps SEHK numeric symbols to Yahoo .HK', () => {
    expect(yahooSymbolFromFlex({ symbol: '700', listingExchange: 'SEHK' })).toBe('0700.HK');
  });

  it('replaces only ibkr lots', () => {
    const doc = parseFlexQueryXml(SAMPLE);
    const { lots } = holdingsFromOpenPositions(doc.openPositions, 'ibkr');
    const { next, removedKeys } = replaceChannelHoldings(
      {
        'MSFT@moomoo': { avg_price: 400, units: 1, channel: 'moomoo', instrument: 'equity' },
        'AAPL@ibkr': { avg_price: 10, units: 1, channel: 'ibkr', instrument: 'equity' },
      },
      lots,
      'ibkr',
    );
    expect(removedKeys).toEqual(['AAPL@ibkr']);
    expect(next['MSFT@moomoo']?.units).toBe(1);
    expect(next['AAPL@ibkr']?.units).toBe(10);
    expect(next['AAPL-C-200-20250117-S@ibkr']?.instrument).toBe('option');
  });

  it('replaces only ibkr cash sleeves', () => {
    const next = replaceChannelCash(
      [
        { amount: 1, currency: 'USD', updated_at: '2026-08-01', channel: 'moomoo' },
        { amount: 9, currency: 'USD', updated_at: '2026-08-01', channel: 'ibkr' },
      ],
      [
        { currency: 'USD', endingCash: 10000 },
        { currency: 'HKD', endingCash: 50 },
      ],
      'ibkr',
      '2026-08-20',
    );
    expect(next).toEqual([
      { amount: 1, currency: 'USD', updated_at: '2026-08-01', channel: 'moomoo' },
      { amount: 10000, currency: 'USD', updated_at: '2026-08-20', channel: 'ibkr' },
      { amount: 50, currency: 'HKD', updated_at: '2026-08-20', channel: 'ibkr' },
    ]);
  });
});

describe('Bookkeeper tools', () => {
  it('registers configure_ibkr_flex and sync_ibkr_flex', () => {
    const names = createBookkeeperTools().map((t) => t.name);
    expect(names).toContain('configure_ibkr_flex');
    expect(names).toContain('sync_ibkr_flex');
    expect(names).toContain('read_broker_raw');
    expect(names).toContain('save_broker_parser');
    expect(names).toContain('parse_broker_raw');
    expect(names).toContain('apply_broker_statement');
  });
});

describe('fetchFlexStatement', () => {
  it('SendRequest then GetStatement', async () => {
    const calls: string[] = [];
    const xml = await fetchFlexStatement(
      { token: 'tok', queryId: '99' },
      {
        get: async (path, params) => {
          calls.push(`${path}:${params.q}`);
          if (path === 'SendRequest') {
            return Buffer.from(
              `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref1</ReferenceCode></FlexStatementResponse>`,
            );
          }
          return Buffer.from(SAMPLE);
        },
      },
    );
    expect(calls).toEqual(['SendRequest:99', 'GetStatement:ref1']);
    expect(parseFlexQueryXml(xml).accountId).toBe('U1234567');
  });

  it('retries 1019 then succeeds', async () => {
    let n = 0;
    const xml = await fetchFlexStatement(
      { token: 'tok', queryId: '99' },
      {
        get: async (path) => {
          if (path === 'SendRequest') {
            return Buffer.from(
              `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref1</ReferenceCode></FlexStatementResponse>`,
            );
          }
          n += 1;
          if (n === 1) {
            return Buffer.from(
              `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress.</ErrorMessage></FlexStatementResponse>`,
            );
          }
          return Buffer.from(SAMPLE);
        },
        sleepMs: async () => undefined,
      },
    );
    expect(parseFlexQueryXml(xml).toDate).toBe('2026-08-17');
  });

  it('fails fast on 1015', async () => {
    await expect(
      fetchFlexStatement(
        { token: 'bad', queryId: '1' },
        {
          get: async () =>
            Buffer.from(
              `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Token is invalid.</ErrorMessage></FlexStatementResponse>`,
            ),
        },
      ),
    ).rejects.toBeInstanceOf(FlexHttpError);
  });

  it('returns CSV GetStatement body so the caller can run a csv_tables spec', async () => {
    const csv = `"ClientAccountID","EndingCash","CurrencyPrimary"\n"U1","1","USD"\n`;
    const buf = await fetchFlexStatement(
      { token: 'tok', queryId: '99' },
      {
        get: async (path) => {
          if (path === 'SendRequest') {
            return Buffer.from(
              `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref1</ReferenceCode></FlexStatementResponse>`,
            );
          }
          return Buffer.from(csv);
        },
      },
    );
    expect(buf.toString('utf8')).toBe(csv);
  });

  it('fails fast on Warn 1018', async () => {
    await expect(
      fetchFlexStatement(
        { token: 'tok', queryId: '1' },
        {
          get: async (path) => {
            if (path === 'SendRequest') {
              return Buffer.from(
                `<FlexStatementResponse><Status>Success</Status><ReferenceCode>ref1</ReferenceCode></FlexStatementResponse>`,
              );
            }
            return Buffer.from(
              `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1018</ErrorCode><ErrorMessage>Too many requests have been made from this token. Please try again shortly.</ErrorMessage></FlexStatementResponse>`,
            );
          },
        },
      ),
    ).rejects.toMatchObject({ name: 'FlexHttpError', code: '1018' });
  });
});
