export type YahooSymbolResult = string | { skip: string };

function padHk(symbol: string): string {
  if (!/^\d+$/.test(symbol)) return `${symbol}.HK`;
  return `${String(Number(symbol)).padStart(4, '0')}.HK`;
}

/** Map a broker market+symbol to a Yahoo ticker, or skip. */
export function yahooSymbolFromBroker(input: {
  market: string;
  symbol: string;
}): YahooSymbolResult {
  const market = input.market.trim().toUpperCase();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { skip: 'missing symbol' };
  if (market === 'US' || market === '') return symbol;
  if (market === 'HK' || market === 'SEHK' || market === 'HKEX') return padHk(symbol);
  if (market === 'SG') return `${symbol}.SI`;
  if (market === 'AU') return `${symbol}.AX`;
  if (market === 'JP') return `${symbol}.T`;
  return { skip: `market ${market} is not imported` };
}

export function yahooSymbolFromFlex(pos: {
  symbol: string;
  listingExchange?: string;
}): string {
  const ex = (pos.listingExchange ?? '').trim().toUpperCase();
  const market = ex === 'SEHK' || ex === 'HKEX' ? 'HK' : 'US';
  const got = yahooSymbolFromBroker({ market, symbol: pos.symbol });
  if (typeof got !== 'string') return pos.symbol.trim().toUpperCase();
  return got;
}
