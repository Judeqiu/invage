import { describe, expect, it } from 'vitest';
import {
  coerceToolNumber,
  HOLDING_NUMERIC_FIELDS,
  prepareNumericToolArgs,
} from '../src/tools/coerce-tool-numbers.js';

describe('coerceToolNumber', () => {
  it('passes through finite numbers', () => {
    expect(coerceToolNumber(19340.22, 'mark')).toBe(19340.22);
  });

  it('strips thousand separators and currency symbols from strings', () => {
    expect(coerceToolNumber('19,340.22', 'mark')).toBe(19340.22);
    expect(coerceToolNumber('$20,000.00', 'avg_price')).toBe(20000);
    expect(coerceToolNumber('−659.78', 'pl')).toBe(-659.78);
  });

  it('fails fast on garbage', () => {
    expect(() => coerceToolNumber('abc', 'units')).toThrow(/finite number/);
    expect(() => coerceToolNumber('', 'units')).toThrow(/empty string/);
    expect(() => coerceToolNumber(Number.NaN, 'units')).toThrow(/finite number/);
  });
});

describe('prepareNumericToolArgs', () => {
  it('coerces listed fields and leaves others', () => {
    const out = prepareNumericToolArgs(
      {
        ticker: 'EASTSPRING-ASB',
        avg_price: '20,000.00',
        units: '1',
        mark: '19,340.22',
        instrument: 'fund',
        fund_quote_source: 'manual',
        adjust_cash: false,
      },
      HOLDING_NUMERIC_FIELDS,
    );
    expect(out.avg_price).toBe(20000);
    expect(out.units).toBe(1);
    expect(out.mark).toBe(19340.22);
    expect(out.instrument).toBe('fund');
    expect(out.adjust_cash).toBe(false);
  });

  it('rejects non-object args', () => {
    expect(() => prepareNumericToolArgs(null, HOLDING_NUMERIC_FIELDS)).toThrow(/JSON object/);
  });
});
