import { describe, expect, it } from 'vitest';
import {
  canonicalOptionUnderlying,
  looksLikeOptionCode,
  optionUnderlyingFromBroker,
  parseBrokerOptionCode,
} from '../src/brokers/option-symbol.js';

describe('parseBrokerOptionCode', () => {
  it('parses Futu HK TCH codes (strike ×1000, 6 digits)', () => {
    expect(parseBrokerOptionCode('TCH260629C390000')).toEqual({
      root: 'TCH',
      expiry: '2026-06-29',
      right: 'call',
      strike: 390,
    });
    expect(parseBrokerOptionCode('TCH210429P350000')).toEqual({
      root: 'TCH',
      expiry: '2021-04-29',
      right: 'put',
      strike: 350,
    });
  });

  it.each([['PATH270319P15000', 15], ['INTC261030P80000', 80],
    ['BRKA270319C1234567', 1234.567]])('parses variable-width scaled strikes (%s)', (code, strike) => {
    expect(parseBrokerOptionCode(code)).toMatchObject({ strike });
  });

  it('parses OCC-style 8-digit strikes', () => {
    expect(parseBrokerOptionCode('AAPL250117C00150000')).toEqual({
      root: 'AAPL',
      expiry: '2025-01-17',
      right: 'call',
      strike: 150,
    });
  });

  it('does not treat equity tickers as option codes', () => {
    expect(looksLikeOptionCode('00700')).toBe(false);
    expect(looksLikeOptionCode('AAPL')).toBe(false);
    expect(looksLikeOptionCode('TCH260629C390000')).toBe(true);
  });
});

describe('canonicalOptionUnderlying', () => {
  const expected = { right: 'put' as const, expiry: '2026-10-16', strike: 230 };
  it('removes a matching OCC code from the underlying name', () => {
    expect(canonicalOptionUnderlying('AMD 261016P00230000', expected)).toBe('AMD');
    expect(canonicalOptionUnderlying('AMD', expected)).toBe('AMD');
  });
  it('rejects an embedded contract code that contradicts the structured fields', () => {
    expect(() => canonicalOptionUnderlying('AMD 261016C00230000', expected)).toThrow(/disagrees/);
  });
});

describe('optionUnderlyingFromBroker', () => {
  it('prefers stock_owner MARKET.SYMBOL', () => {
    expect(optionUnderlyingFromBroker({ market: 'HK', owner: 'HK.00700' })).toBe('0700.HK');
    expect(optionUnderlyingFromBroker({ market: 'US', owner: 'AAPL' })).toBe('AAPL');
  });

  it('maps proven HK option roots only', () => {
    expect(optionUnderlyingFromBroker({ market: 'HK', optionRoot: 'TCH' })).toBe('0700.HK');
    expect(optionUnderlyingFromBroker({ market: 'HK', optionRoot: 'XYZ' })).toEqual({
      skip: 'HK option root XYZ is not mapped',
    });
  });
});
