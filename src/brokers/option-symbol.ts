/**
 * Vendor option codes → public OptionSpec pieces.
 * Futu/MooMoo: TCH260629C390000 (root + YYMMDD + C|P + strike×1000).
 * OCC-style: AAPL250117C00150000 (8-digit strike ×1000).
 */

import { yahooSymbolFromBroker } from './yahoo-symbol.js';

/** Proven Futu HK option roots → numeric stock code (not a ticker guess). */
export const HK_OPTION_ROOT_TO_CODE: Readonly<Record<string, string>> = {
  TCH: '0700',
};

export interface ParsedOptionCode {
  root: string;
  expiry: string;
  right: 'call' | 'put';
  strike: number;
}

const OPTION_CODE_RE = /^([A-Z][A-Z0-9]*?)(\d{6})([CP])(\d{5,8})$/;

export function looksLikeOptionCode(symbol: string): boolean {
  return OPTION_CODE_RE.test(symbol.trim().toUpperCase());
}

function ymdFromYymmdd(raw: string): string | undefined {
  if (!/^\d{6}$/.test(raw)) return undefined;
  const yy = Number(raw.slice(0, 2));
  const year = 2000 + yy;
  const expiry = `${year}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
  const t = Date.parse(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(t)) return undefined;
  if (new Date(t).toISOString().slice(0, 10) !== expiry) return undefined;
  return expiry;
}

export function parseBrokerOptionCode(symbol: string): ParsedOptionCode | { skip: string } {
  const t = symbol.trim().toUpperCase();
  const m = t.match(OPTION_CODE_RE);
  if (!m) return { skip: 'not an option code' };
  const root = m[1]!;
  const expiry = ymdFromYymmdd(m[2]!);
  if (!expiry) return { skip: 'option expiry is not a date' };
  const right = m[3] === 'P' ? 'put' : 'call';
  const digits = m[4]!;
  const raw = Number(digits);
  if (!Number.isFinite(raw) || raw <= 0) return { skip: 'option strike is not positive' };
  const strike = digits.length === 6 || digits.length === 8 ? raw / 1000 : raw;
  if (!(strike > 0)) return { skip: 'option strike is not positive' };
  return { root, expiry, right, strike };
}

/**
 * Yahoo-facing underlying for an option lot.
 * Prefer the broker's owner/underlying code. HK letter roots (TCH) map only
 * when proven in {@link HK_OPTION_ROOT_TO_CODE}.
 */
export function optionUnderlyingFromBroker(args: {
  market: string;
  owner?: string;
  optionRoot?: string;
}): string | { skip: string } {
  const market = args.market.trim().toUpperCase();
  const owner = args.owner?.trim();
  if (owner) {
    const dot = owner.indexOf('.');
    if (dot > 0) {
      return yahooSymbolFromBroker({
        market: owner.slice(0, dot),
        symbol: owner.slice(dot + 1),
      });
    }
    return yahooSymbolFromBroker({ market: market || 'US', symbol: owner });
  }
  const root = args.optionRoot?.trim().toUpperCase();
  if (!root) return { skip: 'option missing underlying' };
  if (market === 'HK' || market === 'SEHK' || market === 'HKEX') {
    const numeric = HK_OPTION_ROOT_TO_CODE[root];
    if (!numeric) return { skip: `HK option root ${root} is not mapped` };
    return yahooSymbolFromBroker({ market: 'HK', symbol: numeric });
  }
  return yahooSymbolFromBroker({ market: market || 'US', symbol: root });
}
