export const now = Date.parse('2026-10-19T16:00:00Z'), day = 86400000;
export const symbol = 'SPY261120P00095000';
export function fixture() {
  const row = { contractSymbol: symbol, strike: 95, expiration: new Date('2026-11-20'), contractSize: 'REGULAR', currency: 'USD',
    lastPrice: 1.8, impliedVolatility: .3, lastTradeDate: new Date(now - 60000), bid: 1.7, ask: 1.9 };
  const chain = { underlyingSymbol: 'SPY', quote: { symbol: 'SPY', currency: 'USD', quoteType: 'ETF', exchange: 'PCX', regularMarketPrice: 100, regularMarketTime: new Date(now) },
    options: [{ expirationDate: new Date('2026-11-20'), puts: [row], calls: [] }] };
  const history = { meta: { symbol: 'SPY', currency: 'USD' }, quotes: Array.from({ length: 253 }, (_, i) => ({ date: new Date(now - (252 - i) * 365 / 252 * day), close: 100 })),
    events: { dividends: [{ date: new Date(now - 30 * day), amount: 1 }], splits: [] } };
  let calls = 0;
  const deps = { now: () => now, options: async () => { calls++; return chain; }, dividends: async () => history,
    rate: async () => 'observation_date,DGS1\n2026-10-16,4.2\n' };
  return { row, chain, history, deps, calls: () => calls };
}
