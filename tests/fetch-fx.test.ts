import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/market/yf-client.js', () => ({
  yf: {
    quote: vi.fn(),
  },
}));

const { yf } = await import('../src/market/yf-client.js');
const { fetchFxRates, toReportingLive, fxPairSymbol } = await import(
  '../src/market/fetch-fx.js'
);

describe('fxPairSymbol', () => {
  it('builds Yahoo pair', () => {
    expect(fxPairSymbol('sgd', 'usd')).toBe('SGDUSD=X');
  });

  it('rejects bad codes', () => {
    expect(() => fxPairSymbol('US', 'USD')).toThrow(/currency/);
  });
});

describe('toReportingLive', () => {
  it('passthrough same currency', () => {
    expect(toReportingLive(100, 'USD', 'USD', {}, 'cash')).toBe(100);
  });

  it('converts with rate', () => {
    // rates[SGD] = USD per 1 SGD
    expect(toReportingLive(100, 'SGD', 'USD', { SGD: 0.74 }, 'cash')).toBeCloseTo(74, 10);
  });

  it('fails without rate', () => {
    expect(() => toReportingLive(100, 'SGD', 'USD', {}, 'cash')).toThrow(/Missing FX rate/);
  });

  it('fails on invalid rate', () => {
    expect(() => toReportingLive(100, 'SGD', 'USD', { SGD: 0 }, 'cash')).toThrow(/Invalid FX/);
  });
});

describe('fetchFxRates', () => {
  beforeEach(() => {
    vi.mocked(yf.quote).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('same-currency → 1 without network', async () => {
    const rates = await fetchFxRates(['USD', 'usd'], 'USD');
    expect(rates).toEqual({ USD: 1 });
    expect(yf.quote).not.toHaveBeenCalled();
  });

  it('fetches foreign pairs', async () => {
    vi.mocked(yf.quote).mockImplementation(async (symbol: string) => {
      if (symbol === 'SGDUSD=X') return { regularMarketPrice: 0.74 };
      if (symbol === 'HKDUSD=X') return { regularMarketPrice: 0.128 };
      throw new Error(`unexpected ${symbol}`);
    });
    const rates = await fetchFxRates(['SGD', 'HKD', 'USD'], 'USD');
    expect(rates.USD).toBe(1);
    expect(rates.SGD).toBe(0.74);
    expect(rates.HKD).toBe(0.128);
    expect(yf.quote).toHaveBeenCalledWith('SGDUSD=X');
    expect(yf.quote).toHaveBeenCalledWith('HKDUSD=X');
  });

  it('fails when quote missing', async () => {
    vi.mocked(yf.quote).mockResolvedValue(undefined as never);
    await expect(fetchFxRates(['SGD'], 'USD')).rejects.toThrow(/Missing live FX/);
  });

  it('fails when price invalid', async () => {
    vi.mocked(yf.quote).mockResolvedValue({ regularMarketPrice: 0 });
    await expect(fetchFxRates(['SGD'], 'USD')).rejects.toThrow(/Invalid live FX/);
  });
});
