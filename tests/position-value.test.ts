import { describe, it, expect } from 'vitest';
import {
  buildHoldingKey,
  buildOptionKey,
  equityQuoteSymbol,
  equityQuoteSymbols,
  holdingBaseKey,
  resolveLookupHoldingKey,
  resolveUpsertHoldingKey,
  valuePosition,
  valuePortfolio,
  equityKeys,
  looksLikeNonYahooFundProduct,
  optionKeys,
} from '../src/market/position-value.js';
import type { Holding } from '../src/market/types.js';
import { buildLivePositions } from '../src/report/dashboard-model.js';
import { buildAnalysis, runFullAnalysis } from '../src/market/analyzer.js';

describe('looksLikeNonYahooFundProduct', () => {
  it('flags MMF / long broker codes / fund categories', () => {
    expect(looksLikeNonYahooFundProduct('PHILLIPUSDMMF')).toBe(true);
    expect(looksLikeNonYahooFundProduct('FULLERTONSGDLIQ')).toBe(true);
    expect(
      looksLikeNonYahooFundProduct('XYZ', 'Money Market Fund (Phillip USD MMF)'),
    ).toBe(true);
    expect(looksLikeNonYahooFundProduct('AAPL')).toBe(false);
    expect(looksLikeNonYahooFundProduct('SPY')).toBe(false);
    expect(looksLikeNonYahooFundProduct('0700.HK')).toBe(false);
  });

  it('flags bank unit-trust / robo product codes (OCBCUT, OCBCRI, …)', () => {
    expect(looksLikeNonYahooFundProduct('OCBCUT')).toBe(true);
    expect(looksLikeNonYahooFundProduct('OCBCRI')).toBe(true);
    expect(looksLikeNonYahooFundProduct('OCBCPM')).toBe(true);
    expect(looksLikeNonYahooFundProduct('OCCYRI')).toBe(true);
    expect(looksLikeNonYahooFundProduct('X', 'Robo / Smart Invest')).toBe(true);
    // Listed bank stocks with exchange suffix stay equity-eligible
    expect(looksLikeNonYahooFundProduct('D05.SI')).toBe(false);
    expect(looksLikeNonYahooFundProduct('O39.SI')).toBe(false);
    expect(looksLikeNonYahooFundProduct('AAPL')).toBe(false);
  });
});

describe('buildOptionKey', () => {
  it('builds SPACEX short put key', () => {
    expect(
      buildOptionKey({
        underlying: 'spacex',
        right: 'put',
        strike: 90,
        expiry: '2026-08-07',
        side: 'short',
      }),
    ).toBe('SPACEX-P-90-20260807-S');
  });
});

describe('fund holdings', () => {
  it('values manual fund from fund.mark without Yahoo price', () => {
    const h: Holding = {
      instrument: 'fund',
      avg_price: 1.2,
      units: 1000,
      fund: { quote_source: 'manual', mark: 1.5, name: 'Test Fund' },
    };
    const e = valuePosition('110011', h);
    expect(e.instrument).toBe('fund');
    expect(e.label).toBe('Test Fund');
    expect(e.price).toBe(1.5);
    expect(e.cost).toBe(1200);
    expect(e.value).toBe(1500);
    expect(e.pl).toBe(300);
  });

  it('fails manual fund without mark', () => {
    const h: Holding = {
      instrument: 'fund',
      avg_price: 1,
      units: 10,
      fund: { quote_source: 'manual' },
    };
    expect(() => valuePosition('X', h)).toThrow(/mark/);
  });

  it('yahoo fund uses prices map; equityKeys excludes funds', () => {
    const portfolio: Record<string, Holding> = {
      SPY: {
        instrument: 'fund',
        avg_price: 400,
        units: 10,
        fund: { quote_source: 'yahoo' },
      },
      AAPL: { avg_price: 100, units: 5, instrument: 'equity' },
    };
    expect(equityKeys(portfolio)).toEqual(['AAPL']);
    expect(equityQuoteSymbols(portfolio).sort()).toEqual(['AAPL', 'SPY']);
    const rows = valuePortfolio(portfolio, { SPY: 500, AAPL: 110 });
    const fund = rows.find((r) => r.instrument === 'fund')!;
    expect(fund.value).toBe(5000);
    expect(fund.pl).toBe(1000);
  });

  it('buildLivePositions counts funds separately', () => {
    const live = buildLivePositions(
      {
        SPY: {
          instrument: 'fund',
          avg_price: 400,
          units: 10,
          fund: { quote_source: 'yahoo' },
        },
        AAPL: { avg_price: 100, units: 5 },
      },
      { SPY: 500, AAPL: 110 },
    );
    expect(live.fundCount).toBe(1);
    expect(live.equityCount).toBe(1);
    expect(live.positionCount).toBe(2);
    expect(live.equityValue).toBe(5000 + 550);
  });
});

describe('multi-channel holding keys', () => {
  it('builds bare vs composite keys', () => {
    expect(buildHoldingKey('aapl')).toBe('AAPL');
    expect(buildHoldingKey('aapl', 'moomoo')).toBe('AAPL@moomoo');
    expect(holdingBaseKey('AAPL@moomoo')).toBe('AAPL');
    expect(equityQuoteSymbol('TSLA@cmbyonglong')).toBe('TSLA');
  });

  it('upserts same channel onto legacy bare key; different channel creates composite', () => {
    const portfolio: Record<string, Holding> = {
      TSLA: { avg_price: 238.75, units: 68, channel: 'cmbyonglong' },
    };
    expect(resolveUpsertHoldingKey(portfolio, 'TSLA', 'cmbyonglong', true)).toBe('TSLA');
    expect(resolveUpsertHoldingKey(portfolio, 'TSLA', 'jude_futu', true)).toBe(
      'TSLA@jude_futu',
    );
  });

  it('allows two lots of the same equity under different channels', () => {
    const portfolio: Record<string, Holding> = {
      'O@cmbyonglong': { avg_price: 58.89, units: 540, channel: 'cmbyonglong' },
      'O@screenshot': { avg_price: 57.03, units: 75, channel: 'screenshot' },
    };
    const rows = valuePortfolio(portfolio, { O: 60 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.key).sort()).toEqual(['O@cmbyonglong', 'O@screenshot']);
    expect(rows.every((r) => r.label === 'O')).toBe(true);
    expect(equityQuoteSymbols(portfolio)).toEqual(['O']);
  });

  it('lookup requires channel or full key when ambiguous', () => {
    const portfolio: Record<string, Holding> = {
      'SPCX@cmbyonglong': { avg_price: 142, units: 45, channel: 'cmbyonglong' },
      'SPCX@jude_futu': { avg_price: 135, units: 50, channel: 'jude_futu' },
    };
    expect(() => resolveLookupHoldingKey(portfolio, 'SPCX')).toThrow(/multiple holdings/);
    expect(resolveLookupHoldingKey(portfolio, 'SPCX', 'jude_futu', true)).toBe(
      'SPCX@jude_futu',
    );
    expect(resolveLookupHoldingKey(portfolio, 'SPCX@cmbyonglong')).toBe('SPCX@cmbyonglong');
  });

  it('values composite equity keys using bare Yahoo symbols', () => {
    const portfolio: Record<string, Holding> = {
      'AAPL@ibkr': { avg_price: 100, units: 10, channel: 'ibkr' },
      'AAPL@moomoo': { avg_price: 110, units: 5, channel: 'moomoo' },
    };
    const live = buildLivePositions(portfolio, { AAPL: 120 });
    expect(live.positionCount).toBe(2);
    expect(live.equityValue).toBe(120 * 15);
    expect(live.positions.every((p) => p.channel === 'ibkr' || p.channel === 'moomoo')).toBe(
      true,
    );
  });
});

describe('SpaceX short put — $265 total premium for 1 contract (100 shares)', () => {
  const holding: Holding = {
    instrument: 'option',
    avg_price: 265, // total $ per contract, NOT per share
    units: 1,
    category: 'Private / Secondary',
    option: {
      right: 'put',
      side: 'short',
      strike: 90,
      expiry: '2026-08-07',
      multiplier: 100,
      underlying: 'SPACEX',
      settlement: 'physical',
      mark: 265,
    },
  };

  it('does not multiply premium by 100: credit $265, obligation $9,000, P/L 0 at entry', () => {
    const e = valuePosition('SPACEX-P-90-20260807-S', holding);
    expect(e.premiumAbsolute).toBe(265);
    expect(e.contingentCashObligation).toBe(9000); // 90 × 100 — only if assigned
    expect(e.contingentShareObligation).toBe(0);
    expect(e.cost).toBe(-265);
    expect(e.value).toBe(-265); // open short liability = mark, not strike loss
    expect(e.pl).toBe(0);
  });

  it('expires worthless (mark 0): keep full $265 premium profit', () => {
    const expired: Holding = {
      ...holding,
      option: { ...holding.option!, mark: 0 },
    };
    const e = valuePosition('SPACEX-P-90-20260807-S', expired);
    expect(e.value).toBe(0);
    expect(e.pl).toBe(265);
    expect(e.contingentCashObligation).toBe(9000);
  });

  it('two contracts double premium and obligation, still no ×100 on premium', () => {
    const two: Holding = { ...holding, units: 2 };
    const e = valuePosition('X', two);
    expect(e.premiumAbsolute).toBe(530);
    expect(e.cost).toBe(-530);
    expect(e.contingentCashObligation).toBe(18000);
  });

  it('fails without mark', () => {
    const bad = {
      ...holding,
      option: { ...holding.option!, mark: undefined as unknown as number },
    };
    expect(() => valuePosition('X', bad)).toThrow(/mark/);
  });
});

describe('mixed portfolio valuation', () => {
  const portfolio: Record<string, Holding> = {
    AAPL: { avg_price: 100, units: 10, instrument: 'equity' },
    'SPACEX-P-90-20260807-S': {
      instrument: 'option',
      avg_price: 265,
      units: 1,
      option: {
        right: 'put',
        side: 'short',
        strike: 90,
        expiry: '2026-08-07',
        multiplier: 100,
        underlying: 'SPACEX',
        settlement: 'physical',
        mark: 0,
      },
    },
  };

  it('splits equity vs option keys', () => {
    expect(equityKeys(portfolio)).toEqual(['AAPL']);
    expect(optionKeys(portfolio)).toEqual(['SPACEX-P-90-20260807-S']);
  });

  it('values without Yahoo price for the option key', () => {
    const rows = valuePortfolio(portfolio, { AAPL: 110 });
    expect(rows).toHaveLength(2);
    const opt = rows.find((r) => r.instrument === 'option')!;
    expect(opt.pl).toBe(265);
    expect(opt.contingentCashObligation).toBe(9000);
  });

  it('buildLivePositions surfaces obligation and premium', () => {
    const live = buildLivePositions(portfolio, { AAPL: 110 });
    expect(live.equityValue).toBe(1100);
    expect(live.equityCost).toBe(1000);
    expect(live.optionsPremiumCollected).toBe(265);
    expect(live.contingentCashObligation).toBe(9000);
    expect(live.optionCount).toBe(1);
    expect(live.equityCount).toBe(1);
    // Equity 1100 + option MTM 0; costs 1000 + (−265)
    expect(live.totalValue).toBe(1100);
    expect(live.totalCost).toBe(735);
    expect(live.totalPL).toBe(1100 - 735);
  });

  it('analyzer skips options for 3-axis buckets but includes them in fullAnalysis', () => {
    const result = runFullAnalysis(
      portfolio,
      { AAPL: 110 },
      {
        AAPL: {
          ticker: 'AAPL',
          targetLowPrice: 90,
          targetMedianPrice: 100,
          targetMeanPrice: 100,
          targetHighPrice: 120,
        },
      },
    );
    expect(result.fullAnalysis).toHaveLength(2);
    expect(result.fullAnalysis.some((p) => p.instrument === 'option')).toBe(true);
    expect(result.laggards.every((p) => p.instrument !== 'option')).toBe(true);
    expect(result.overpriced.every((p) => p.instrument !== 'option')).toBe(true);
    expect(result.buyOpportunities.every((p) => p.instrument !== 'option')).toBe(true);
  });

  it('buildAnalysis fails fast when equity price missing', () => {
    expect(() => buildAnalysis({ AAPL: { avg_price: 100, units: 1 } }, {}, {})).toThrow(
      /Missing market price for AAPL/,
    );
  });
});
