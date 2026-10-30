import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { matchingProbabilityQuote, fetchOptionMarks, providerIvFromYahooRow } from '../src/market/fetch-option-marks.js';
import { buildLivePositions } from '../src/report/dashboard-model.js';
import { yf } from '../src/market/yf-client.js';
import type { Holding } from '../src/market/types.js';

vi.mock('../src/market/yf-client.js', () => ({ yf: { options: vi.fn() } }));
const now = Date.parse('2026-10-15T10:00:00Z');
const row = { strike: 390, lastPrice: 25, bid: 24, ask: 28,
  lastTradeDate: new Date('2026-10-14T19:59:00Z'), expiration: '2026-10-16' };
const quote = { regularMarketPrice: 370, regularMarketTime: new Date('2026-10-14T20:00:00Z'), preMarketPrice: 361 };
const option = { right: 'put', side: 'short', strike: 390, expiry: '2026-10-16', multiplier: 100, underlying: 'TSLA', settlement: 'physical', mark: 1641 } as const;
const math = readFileSync('webui/option-probability.js', 'utf8');
const calculate = runInNewContext(math + '; OptionProbability.finishItmProbability');

it('pairs last-session prices before market open and ignores premarket spot and untimestamped mid', () => {
  const pair = matchingProbabilityQuote(row, quote, 100, now)!;
  expect(pair).toMatchObject({ mark: 2500, spot: 370 });
  expect(calculate({ option, brokerMark: 1641, price: 2600, probabilityQuote: pair }, 361, 1).probability).toBeGreaterThan(0);
});

it('leaves probability unavailable without matched quotes rather than using stored broker marks', () => {
  expect(calculate({ option, brokerMark: 1641, price: 2600 }, 361, 1)).toMatchObject({ probability: null, reason: 'Waiting for matching prices' });
});

it('rejects missing timestamps, old trades, different dates, future timestamps and excessive skew', () => {
  for (const lastTradeDate of [undefined, '2026-10-13T20:00:00Z', '2026-10-14T19:44:00Z', 'invalid']) {
    expect(matchingProbabilityQuote({ ...row, lastTradeDate }, quote, 100, now)).toBeUndefined();
  }
  expect(matchingProbabilityQuote(row, { ...quote, regularMarketTime: undefined }, 100, now)).toBeUndefined();
  expect(matchingProbabilityQuote(row, quote, 100, now - 86400_000)).toBeUndefined();
  expect(matchingProbabilityQuote(row, quote, 100, now + 8 * 86400_000)).toBeUndefined();
  expect(matchingProbabilityQuote({ ...row, lastTradeDate: '2026-10-14T23:59:00Z' },
    { regularMarketPrice: 370, regularMarketTime: '2026-10-15T00:01:00Z' }, 100, now)).toBeUndefined();
});

it('keeps the intrinsic-value guard even when quote timestamps match', () => {
  const pair = matchingProbabilityQuote({ ...row, lastPrice: 10 }, quote, 100, now)!;
  expect(calculate({ option, probabilityQuote: pair }, 361, 1)).toMatchObject({ probability: null, reason: 'Matching prices fail value check' });
});

it('carries chain evidence through valuation to the browser without altering the valuation mark', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  try {
    vi.mocked(yf.options).mockResolvedValue({ quote, options: [{ expirationDate: '2026-10-16', puts: [row] }] } as never);
    const portfolio: Record<string, Holding> = { contract: { instrument: 'option', units: 1, avg_price: 2000, currency: 'USD', option } };
    const marks = await fetchOptionMarks(portfolio);
    expect(marks.contract.mark).toBe(2600);
    const valued = { contract: { ...portfolio.contract, option: { ...option, mark: marks.contract.mark } } };
    const live = buildLivePositions(valued, { TSLA: 361 }, marks);
    expect(live.positions[0].probabilityQuote).toEqual(marks.contract.probabilityQuote);
    expect(live.positions[0].probabilityQuote?.mark).toBe(2500);
    expect(live.positions[0].price).toBe(2600);
  } finally { vi.useRealTimers(); }
});

it('preserves provider IV provenance without assigning the option trade time to IV', async () => {
  const evidence=providerIvFromYahooRow({...row,impliedVolatility:.55},new Date(now))!;
  expect(evidence).toMatchObject({iv:.55,source:'yahoo',asOf:null,fetchedAt:new Date(now).toISOString(),optionAsOf:'2026-10-14T19:59:00.000Z'});
  expect(providerIvFromYahooRow({...row,impliedVolatility:.55,lastTradeDate:'invalid'},new Date(now))?.optionAsOf).toBeNull();
  vi.useFakeTimers();vi.setSystemTime(now);
  try {
    vi.mocked(yf.options).mockResolvedValue({quote,options:[{expirationDate:'2026-10-16',puts:[{...row,impliedVolatility:.55}]}]} as never);
    const portfolio:Record<string,Holding>={contract:{instrument:'option',units:1,avg_price:2000,currency:'USD',option}};
    const marks=await fetchOptionMarks(portfolio);
    expect(marks.contract.providerIv).toEqual(evidence);
    expect(buildLivePositions(portfolio,{TSLA:361},marks).positions[0].providerIv).toEqual(evidence);
    expect(marks.contract.mark).toBe(2600);
  } finally {vi.useRealTimers();}
});
