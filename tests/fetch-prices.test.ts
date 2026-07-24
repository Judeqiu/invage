import { describe, it, expect } from 'vitest';
import { pickCurrentPrice, snapshotFromYahooQuote, formatPriceSnapshot } from '../src/market/fetch-prices.js';

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

  it('does not use previousClose when regular exists in POST', () => {
    // Bug case: agent reported 206.65 (prev close) as "live"
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState: 'POST',
      regularMarketPrice: 214.19,
      regularMarketPreviousClose: 206.65,
      postMarketPrice: 213.55,
    });
    expect(p.price).toBe(214.19);
    expect(p.priceField).toBe('regularMarketPrice');
    expect(p.price).not.toBe(206.65);
  });

  it('uses preMarket when PRE and pre is set', () => {
    const p = pickCurrentPrice({
      symbol: 'IBM',
      marketState: 'PRE',
      regularMarketPrice: 206.65,
      preMarketPrice: 208.1,
      regularMarketPreviousClose: 206.65,
    });
    expect(p.price).toBe(208.1);
    expect(p.priceField).toBe('preMarketPrice');
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
    expect(s.price).toBe(214.19);
    const line = formatPriceSnapshot(s);
    expect(line).toContain('214.19');
    expect(line).toContain('prevClose=$206.65');
    expect(line).toContain('post=$213.55');
  });
});
