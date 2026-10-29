import { describe, it, expect, vi } from 'vitest';
import { fetchPrices, fetchQuote, pickCurrentPrice, snapshotFromYahooQuote, formatPriceSnapshot } from '../src/market/fetch-prices.js';
import { yf } from '../src/market/yf-client.js';

describe('pickCurrentPrice', () => {
  it('uses regularMarketPrice in REGULAR session', () => {
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState: 'REGULAR',
      regularMarketPrice: 214.19,
      regularMarketPreviousClose: 206.65,
      postMarketPrice: 213.55,
    });
    expect(p.price).toBe(214.19);
    expect(p.priceField).toBe('regularMarketPrice');
  });

  it.each(['POST', 'POSTPOST'])('uses the after-hours price in %s', (marketState) => {
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState,
      regularMarketPrice: 214.19,
      regularMarketPreviousClose: 206.65,
      postMarketPrice: 213.55,
    });
    expect(p.price).toBe(213.55);
    expect(p.priceField).toBe('postMarketPrice');
    expect(p.price).not.toBe(206.65);
  });

  it.each(['PRE', 'PREPRE'])('uses preMarket when %s and pre is set', (marketState) => {
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState,
      regularMarketPrice: 206.65,
      preMarketPrice: 208.1,
      regularMarketPreviousClose: 206.65,
    });
    expect(p.price).toBe(208.1);
    expect(p.priceField).toBe('preMarketPrice');
  });

  it.each(['CLOSED', undefined])('retains the latest after-hours quote in %s', (marketState) => {
    expect(pickCurrentPrice({
      marketState,
      regularMarketPrice: 214.19,
      regularMarketTime: '2026-10-29T20:00:00Z',
      postMarketPrice: 213.55,
      postMarketTime: new Date('2026-10-29T23:59:00Z'),
      preMarketPrice: 208.1,
      preMarketTime: '2026-10-29T13:00:00Z',
    })).toEqual({ price: 213.55, priceField: 'postMarketPrice', asOf: '2026-10-29T23:59:00.000Z' });
  });

  it.each(['PRE', 'POST', 'CLOSED'])('does not select stale extended-hours fields in %s', (marketState) => {
    expect(pickCurrentPrice({
      marketState,
      regularMarketPrice: 214.19,
      regularMarketTime: '2026-10-29T20:00:00Z',
      postMarketPrice: 213.55,
      postMarketTime: '2026-10-28T23:59:00Z',
      preMarketPrice: 208.1,
      preMarketTime: '2026-10-29T13:00:00Z',
    })).toEqual({ price: 214.19, priceField: 'regularMarketPrice', asOf: '2026-10-29T20:00:00.000Z' });
  });

  it('retains the latest pre-market quote when closed and accepts Unix timestamps', () => {
    expect(pickCurrentPrice({
      marketState: 'CLOSED',
      regularMarketPrice: 206.65,
      regularMarketTime: 1700000000,
      preMarketPrice: 208.1,
      preMarketTime: 1700003600000,
    })).toEqual({ price: 208.1, priceField: 'preMarketPrice', asOf: new Date(1700003600000).toISOString() });
  });

  it.each(['PRE', 'POST', 'CLOSED'])('falls back to regular price when extended hours are absent in %s', (marketState) => {
    expect(pickCurrentPrice({ marketState, regularMarketPrice: 214.19 }).price).toBe(214.19);
  });

  it('falls back to previousClose only when nothing else exists', () => {
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState: 'CLOSED',
      regularMarketPreviousClose: 206.65,
    });
    expect(p.price).toBe(206.65);
    expect(p.priceField).toBe('regularMarketPreviousClose');
  });
});

it('passes the observed AAPL after-hours quote through portfolio prices and single quotes', async () => {
  const quote = vi.spyOn(yf, 'quote').mockResolvedValue({
    symbol: 'AAPL', currency: 'USD', marketState: 'POST',
    regularMarketPrice: 348.91, regularMarketTime: new Date('2026-10-29T20:00:01Z'),
    postMarketPrice: 350.93, postMarketTime: new Date('2026-10-29T22:46:53Z'),
  } as Awaited<ReturnType<typeof yf.quote>>);
  try {
    expect(await fetchPrices(['AAPL'])).toEqual({ AAPL: 350.93 });
    expect(await fetchQuote('AAPL')).toMatchObject({ ticker: 'AAPL', price: 350.93, currency: 'USD' });
  } finally {
    quote.mockRestore();
  }
});

describe('formatPriceSnapshot', () => {
  it('labels prevClose as separate from live', () => {
    const s = snapshotFromYahooQuote('IBM', {
      symbol: 'IBM',
      marketState: 'POST',
      regularMarketPrice: 214.19,
      regularMarketPreviousClose: 206.65,
      postMarketPrice: 213.55,
      shortName: 'IBM',
      currency: 'USD',
    });
    expect(s.price).toBe(213.55);
    const line = formatPriceSnapshot(s);
    expect(line).toContain('213.55 (postMarketPrice');
    expect(line).toContain('prevClose=$206.65');
    expect(line).not.toContain('| post=');
  });
});
