import { describe, expect, it } from 'vitest';
import {
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
