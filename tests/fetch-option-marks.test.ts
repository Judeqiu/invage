import { describe, it, expect } from 'vitest';
import {
  pickPerSharePremium,
  perShareToContractMark,
  findYahooContract,
  toDateKey,
  applyOptionMarks,
} from '../src/market/fetch-option-marks.js';
import type { Holding } from '../src/market/types.js';
import { valuePosition } from '../src/market/position-value.js';

describe('toDateKey', () => {
  it('normalizes ISO date and Date', () => {
    expect(toDateKey('2026-08-07')).toBe('2026-08-07');
    expect(toDateKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });
});

describe('pickPerSharePremium', () => {
  it('uses mid when bid/ask valid', () => {
    expect(pickPerSharePremium({ lastPrice: 1, bid: 1.0, ask: 1.2 })).toBeCloseTo(1.1, 5);
  });

  it('falls back to lastPrice when no bid/ask', () => {
    expect(pickPerSharePremium({ lastPrice: 2.65 })).toBe(2.65);
  });

  it('throws when nothing usable', () => {
    expect(() => pickPerSharePremium({})).toThrow(/no usable/);
  });
});

describe('perShareToContractMark', () => {
  it('multiplies by 100 for standard US option', () => {
    // Yahoo lastPrice $2.65/share → $265 per contract
    expect(perShareToContractMark(2.65, 100)).toBe(265);
  });
});

describe('findYahooContract', () => {
  const rows = [
    {
      contractSymbol: 'AAPL260807P00200000',
      strike: 200,
      lastPrice: 1.5,
      expiration: new Date('2026-08-07T00:00:00.000Z'),
    },
    {
      contractSymbol: 'AAPL260807P00210000',
      strike: 210,
      lastPrice: 3.2,
      expiration: new Date('2026-08-07T00:00:00.000Z'),
    },
  ];

  it('matches strike + expiry', () => {
    const row = findYahooContract(rows, 200, '2026-08-07');
    expect(row?.contractSymbol).toBe('AAPL260807P00200000');
  });

  it('returns null when strike missing', () => {
    expect(findYahooContract(rows, 999, '2026-08-07')).toBeNull();
  });
});

describe('applyOptionMarks', () => {
  it('replaces mark for valuation clone only', () => {
    const portfolio: Record<string, Holding> = {
      'AAPL-P-200-20260807-S': {
        instrument: 'option',
        avg_price: 150,
        units: 1,
        option: {
          right: 'put',
          side: 'short',
          strike: 200,
          expiry: '2026-08-07',
          multiplier: 100,
          underlying: 'AAPL',
          settlement: 'physical',
          mark: 150,
        },
      },
    };
    const next = applyOptionMarks(portfolio, {
      'AAPL-P-200-20260807-S': { mark: 320, source: 'yahoo', perShare: 3.2 },
    });
    expect(portfolio['AAPL-P-200-20260807-S'].option!.mark).toBe(150);
    expect(next['AAPL-P-200-20260807-S'].option!.mark).toBe(320);
    const e = valuePosition('AAPL-P-200-20260807-S', next['AAPL-P-200-20260807-S']);
    expect(e.cost).toBe(-150);
    expect(e.value).toBe(-320);
    expect(e.pl).toBe(-170);
  });
});
