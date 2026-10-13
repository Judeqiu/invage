import { expect, it, vi } from 'vitest';
import type { Holding } from '../src/market/types.js';

vi.mock('../src/market/fetch-prices.js', () => ({ fetchPrices: vi.fn() }));
vi.mock('../src/market/fetch-option-marks.js', () => ({
  fetchOptionMarks: vi.fn(async () => ({})),
  applyOptionMarks: (portfolio: Record<string, Holding>) => portfolio,
}));

import { fetchPrices } from '../src/market/fetch-prices.js';
import { resolvePortfolioMarket } from '../src/market/resolve-portfolio.js';
import { portfolioQuoteSymbols } from '../src/market/portfolio-quote-symbols.js';

const option: Holding = {
  instrument: 'option', avg_price: 500, units: 2, currency: 'USD',
  option: { underlying: 'AAPL', right: 'put', side: 'short', strike: 140,
    expiry: '2026-09-18', multiplier: 100, mark: 200 },
};

it('fetches the underlying share price for an option-only portfolio without scaling it', async () => {
  vi.mocked(fetchPrices).mockResolvedValue({ AAPL: 151.23 });
  const result = await resolvePortfolioMarket({ contract: option });
  expect(fetchPrices).toHaveBeenCalledWith(['AAPL']);
  expect(result.equityPrices.AAPL).toBe(151.23);
});

it('deduplicates stocks and option underlyings, including broker OCC codes and HK symbols', () => {
  expect(portfolioQuoteSymbols({
    AAPL: { avg_price: 100, units: 5 },
    option,
    occ: { ...option, option: { ...option.option!, underlying: 'AAPL  260918P00140000' } },
    hk: { ...option, currency: 'HKD', option: { ...option.option!, underlying: '0700.HK' } },
  })).toEqual(['AAPL', '0700.HK']);
});
