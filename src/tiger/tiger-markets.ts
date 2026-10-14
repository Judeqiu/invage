import { historyLocalTime } from '../brokers/history-values.js';
import { BrokerParseError } from '../brokers/errors.js';
import type { YahooSymbolResult } from '../brokers/yahoo-symbol.js';

// Tiger Market enum plus explicit exchange/quote aliases. Keep these scoped to
// Tiger: other brokers use different market identifiers and timestamp formats.
const regions = {
  US: { clock: 'America/New_York', suffix: '', aliases: ['US'] },
  HK: { clock: 'Asia/Hong_Kong', suffix: '.HK', aliases: ['HK', 'SEHK', 'HKEX'] },
  CN: { clock: 'Asia/Shanghai', suffix: '', aliases: ['CN', 'SH', 'SS', 'SZ', 'SSE', 'SZSE', 'SEHKNTL', 'SEHKSZSE'] },
  SG: { clock: 'Asia/Singapore', suffix: '.SI', aliases: ['SG', 'SI', 'SGX'] },
  AU: { clock: 'Australia/Sydney', suffix: '.AX', aliases: ['AU', 'AX', 'ASX'] },
  NZ: { clock: 'Pacific/Auckland', suffix: '.NZ', aliases: ['NZ', 'NZX'] },
  // Preserve the pre-existing Japan mapping, beyond Tiger's published enum.
  JP: { clock: 'Asia/Tokyo', suffix: '.T', aliases: ['JP', 'TSE'] },
} as const;

export function tigerMarket(value: unknown): string {
  const code = String(value ?? '').trim().toUpperCase();
  return Object.entries(regions).find(([, region]) => (region.aliases as readonly string[]).includes(code))?.[0] ?? code;
}

export function tigerMarketClock(value: unknown): string | undefined {
  return regions[tigerMarket(value) as keyof typeof regions]?.clock;
}

export function tigerNativeSymbol(market: unknown, value: string): string {
  const symbol = value.trim().toUpperCase();
  const region = regions[tigerMarket(market) as keyof typeof regions];
  const bare = region?.suffix && symbol.endsWith(region.suffix) ? symbol.slice(0, -region.suffix.length) : symbol;
  return tigerMarket(market) === 'HK' && /^\d+$/.test(bare) ? String(Number(bare)).padStart(4, '0') : bare;
}

export function tigerYahooSymbol(input: { market: string; symbol: string; exchange?: unknown }): YahooSymbolResult {
  const market = tigerMarket(input.market), symbol = tigerNativeSymbol(market, input.symbol);
  if (!symbol) return { skip: 'missing symbol' };
  if (market === 'CN') {
    // CN alone does not distinguish Shanghai from Shenzhen. Never infer a
    // listing from the currency or a numeric ticker that can be ambiguous.
    if (/^\d{6}\.(SS|SZ)$/.test(symbol)) return symbol;
    const exchange = String(input.exchange ?? input.market).trim().toUpperCase();
    if (/^\d{6}$/.test(symbol)) {
      if (['SH', 'SS', 'SSE', 'SEHKNTL'].includes(exchange)) return `${symbol}.SS`;
      if (['SZ', 'SZSE', 'SEHKSZSE'].includes(exchange)) return `${symbol}.SZ`;
    }
    return { skip: 'Tiger CN listing requires a Shanghai/Shenzhen exchange or .SS/.SZ symbol' };
  }
  const region = regions[market as keyof typeof regions];
  return region ? `${symbol}${region.suffix}` : { skip: `Tiger market ${market || '(missing)'} is not mapped` };
}

/** Tiger openTime/updateTime/transactionTime are epoch milliseconds, not local
 * strings. UTC is lossless when a future market's local clock is unknown. */
export function tigerHistoryTime(value: unknown, clock: string): string {
  if (!(typeof value === 'number' && Number.isSafeInteger(value)) &&
      !(typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))) {
    throw new BrokerParseError('Tiger historical timestamp must be exact epoch milliseconds');
  }
  return historyLocalTime(Number(value), clock);
}
