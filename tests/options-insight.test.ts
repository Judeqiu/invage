import { describe, expect, it } from 'vitest';
import {
  classifyMoneyness,
  daysToExpiry,
  intrinsicPerShare,
  putCallOpenInterestRatio,
  relativeIv,
  structureEconomics,
} from '../src/market/options-insight.js';

describe('options insight structure math', () => {
  it('computes DTE from UTC calendar dates', () => {
    expect(daysToExpiry('2026-08-22', '2026-09-18')).toBe(27);
    expect(daysToExpiry('2026-08-22', '2026-08-22')).toBe(0);
  });

  it('fails on expired contracts', () => {
    expect(() => daysToExpiry('2026-08-22', '2026-08-21')).toThrow(/expired/);
  });

  it('classifies call/put moneyness from live spot', () => {
    expect(classifyMoneyness(100, 90, 'call')).toBe('ITM');
    expect(classifyMoneyness(100, 110, 'call')).toBe('OTM');
    expect(classifyMoneyness(100, 100, 'call')).toBe('ATM');
    expect(classifyMoneyness(100, 110, 'put')).toBe('ITM');
    expect(classifyMoneyness(100, 90, 'put')).toBe('OTM');
  });

  it('computes intrinsic without inventing premium', () => {
    expect(intrinsicPerShare(105, 100, 'call')).toBe(5);
    expect(intrinsicPerShare(95, 100, 'call')).toBe(0);
    expect(intrinsicPerShare(95, 100, 'put')).toBe(5);
    expect(intrinsicPerShare(105, 100, 'put')).toBe(0);
  });

  it('long call is defined-risk; short call max gain is premium only', () => {
    const long = structureEconomics({
      right: 'call',
      side: 'long',
      strike: 100,
      premiumPerShare: 2.5,
      multiplier: 100,
      units: 1,
    });
    expect(long.breakevenPerShare).toBe(102.5);
    expect(long.maxLoss).toBe(250);
    expect(long.maxGain).toBeNull();
    expect(long.assignmentCash).toBeNull();

    const short = structureEconomics({
      right: 'call',
      side: 'short',
      strike: 100,
      premiumPerShare: 2.5,
      multiplier: 100,
      units: 2,
    });
    expect(short.maxGain).toBe(500);
    expect(short.maxLoss).toBeNull();
    expect(short.undefinedRisk).toBe(true);
  });

  it('short put max loss and assignment cash use strike × multiplier', () => {
    const shortPut = structureEconomics({
      right: 'put',
      side: 'short',
      strike: 90,
      premiumPerShare: 2.65,
      multiplier: 100,
      units: 1,
    });
    expect(shortPut.maxGain).toBe(265);
    expect(shortPut.maxLoss).toBe(9000 - 265);
    expect(shortPut.assignmentCash).toBe(9000);
    expect(shortPut.breakevenPerShare).toBe(87.35);
  });

  it('treats missing/zero IV as unavailable — never invents richness', () => {
    expect(relativeIv(null, 0.3)).toBe('unavailable');
    expect(relativeIv(0, 0.3)).toBe('unavailable');
    expect(relativeIv(0.4, 0.3)).toBe('rich_vs_atm');
    expect(relativeIv(0.2, 0.3)).toBe('cheap_vs_atm');
    expect(relativeIv(0.31, 0.3)).toBe('in_line');
  });

  it('put/call open-interest ratio is null when either side has no OI', () => {
    expect(putCallOpenInterestRatio([{ openInterest: 10 }], [{ openInterest: 20 }])).toBe(2);
    expect(putCallOpenInterestRatio([{ openInterest: 0 }], [{ openInterest: 20 }])).toBeNull();
  });
});
