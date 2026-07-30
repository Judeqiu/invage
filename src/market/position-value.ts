/**
 * Position valuation for equities and option contracts.
 *
 * Equity: cost = avg_price × units; value = market × units.
 *
 * Option (premium is total $ per contract — NOT per share):
 *   units      = number of contracts
 *   avg_price  = premium dollars paid/received for ONE contract at trade
 *   mark       = current premium dollars per contract (to close)
 *   multiplier = shares controlled per contract (typically 100) — used for
 *                assignment obligation only, never for premium MTM
 *
 *   premiumAbsolute = avg_price × units
 *   direction = +1 long, −1 short
 *   cost  = direction × avg_price × units
 *   value = direction × mark × units
 *   pl    = value − cost
 *
 * Short put contingent cash if assigned = strike × multiplier × units
 *   (e.g. strike $90 × 100 sh × 1 ct = $9,000). This is NOT current MTM —
 *   it only applies if the put is assigned ("triggered").
 * Short call delivery if assigned = multiplier × units shares.
 */

import type { FundSpec, Holding, OptionSpec } from './types.js';

/**
 * Optional broker/source tag for multi-broker portfolios.
 * Empty/whitespace → unassigned (undefined). Fail-fast on non-string.
 */
export function normalizeOptionalChannel(
  raw: unknown,
  fieldLabel: string,
): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(
      `${fieldLabel} must be a string when set (broker id, e.g. moomoo, ibkr, webull).`,
    );
  }
  const t = raw.trim();
  return t.length === 0 ? undefined : t;
}

export interface PositionEconomics {
  key: string;
  instrument: 'equity' | 'option' | 'fund';
  /** Display label (ticker, fund name, or option description). */
  label: string;
  units: number;
  avgCost: number;
  /** Mark used for MTM (equity market price or option premium $/contract). */
  price: number;
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  category: string;
  /** Broker / custody source when assigned; omit when unassigned. */
  channel?: string;
  /** Absolute premium exchanged (options only); 0 for equity. */
  premiumAbsolute: number;
  /** Contingent cash outlay if short put assigned; 0 otherwise. Not current MTM. */
  contingentCashObligation: number;
  /** Shares deliverable if short call assigned; 0 otherwise. */
  contingentShareObligation: number;
  option?: OptionSpec;
  fund?: FundSpec;
}

export function isOptionHolding(h: Holding): boolean {
  return h.instrument === 'option';
}

export function isFundHolding(h: Holding): boolean {
  return h.instrument === 'fund';
}

/** Stocks (instrument omitted or equity). */
export function isEquityHolding(h: Holding): boolean {
  return h.instrument == null || h.instrument === 'equity';
}

/**
 * Positions that need a Yahoo equity-style quote for MTM:
 * equities + funds with quote_source=yahoo. Options and manual funds excluded.
 */
export function isYahooPricedHolding(h: Holding): boolean {
  if (isOptionHolding(h)) return false;
  if (isFundHolding(h)) {
    if (!h.fund) {
      throw new Error('Fund holding missing fund fields.');
    }
    return h.fund.quote_source === 'yahoo';
  }
  return true;
}

/**
 * Heuristic for import guards: product codes / labels that must use instrument=fund
 * with fund_quote_source=manual (Yahoo has no usable equity quote).
 *
 * @param channel Optional broker/custody tag (e.g. endowus, syfe) — platform channels
 *                almost never have Yahoo equity quotes for synthetic portfolio codes.
 */
export function looksLikeNonYahooFundProduct(
  ticker: string,
  category?: string,
  channel?: string | null,
): boolean {
  const t = ticker.trim().toUpperCase();
  const cat = (category ?? '').toLowerCase();
  const ch = (channel ?? '').trim().toLowerCase();
  if (
    /money\s*market|money market fund|\bmmf\b|liquidity\s*fund|cash\s*management|unit\s*trust|open-?end\s*fund|mutual\s*fund|\b基金\b|robo|smart\s*invest|discretionary|private\s*banking|wealth\s*mgmt|portfolio\s*mgmt|endowus|syfe|stashaway/.test(
      cat,
    )
  ) {
    return true;
  }
  // Digital wealth / robo platforms: portfolio codes are not Yahoo equities
  if (
    /^(endowus|syfe|stashaway|autowealth|fsmone|dollarsandsense)$/.test(ch) ||
    /^(ENDOWUS|ENDOW|SYFE|STASHAWAY|AUTOWEALTH)/.test(t)
  ) {
    return true;
  }
  if (/(MMF|LIQ|LIQUID|CASHFUND|USDMMF|SGDLIQ)$/.test(t) || /MMF|LIQUIDITY|CASHFUND/.test(t)) {
    return true;
  }
  // Unit-trust style suffixes without exchange (OCBCUT, …)
  if (t.length >= 4 && !t.includes('.') && /(UT|UNITTRUST)$/.test(t)) {
    return true;
  }
  // SG bank / private-bank product codes (not listed .SI equities): OCBCUT, OCBCRI, OCBCPM, OCCYRI
  if (
    !t.includes('.') &&
    (/^(OCBC|DBS|UOB|SCB)[A-Z0-9]{1,8}$/.test(t) || /^OCCY[A-Z0-9]{1,8}$/.test(t))
  ) {
    return true;
  }
  // Long broker product codes without exchange suffix (e.g. PHILLIPUSDMMF, FULLERTONSGDLIQ)
  if (t.length >= 10 && !t.includes('.') && !/^[A-Z]{1,5}$/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Separator between base symbol (or option id) and broker channel in portfolio map keys.
 * Same equity at two brokers: AAPL@ibkr and AAPL@moomoo are distinct holdings.
 */
export const HOLDING_KEY_CHANNEL_SEP = '@';

/** Channel identity for holding keys ('' = unassigned). */
function holdingChannelSlot(channel: string | undefined | null): string {
  if (channel == null) return '';
  const t = String(channel).trim();
  return t.length === 0 ? '' : t;
}

/**
 * Portfolio map key for a holding.
 * Unassigned channel → bare base (legacy-compatible: `AAPL`, `SPACEX-P-90-…-S`).
 * Assigned channel → `BASE@channel` so the same ticker can exist at two brokers.
 */
export function buildHoldingKey(baseKey: string, channel?: string | null): string {
  const base = baseKey.trim().toUpperCase();
  if (!base) throw new Error('Holding key base is required.');
  if (base.includes(HOLDING_KEY_CHANNEL_SEP)) {
    throw new Error(
      `Holding base key must not contain "${HOLDING_KEY_CHANNEL_SEP}" (got "${baseKey}"). ` +
        `Pass the bare ticker/option id and channel separately.`,
    );
  }
  const ch = holdingChannelSlot(channel);
  return ch.length > 0 ? `${base}${HOLDING_KEY_CHANNEL_SEP}${ch}` : base;
}

/**
 * Strip optional @channel suffix from a portfolio map key.
 * Equity quote symbol / option base id for market data and display.
 */
export function holdingBaseKey(portfolioKey: string): string {
  const at = portfolioKey.lastIndexOf(HOLDING_KEY_CHANNEL_SEP);
  if (at > 0) return portfolioKey.slice(0, at);
  return portfolioKey;
}

/**
 * Spot crypto aliases → Yahoo Finance pair symbols.
 * Bare `BTC` on Yahoo is Grayscale Bitcoin Mini Trust, not spot — always map.
 * Portfolio may store `BTC`, `BITCOIN`, or `BTC-USD`; all price as `BTC-USD`.
 */
export const CRYPTO_YAHOO_QUOTE_MAP: Readonly<Record<string, string>> = {
  BTC: 'BTC-USD',
  BITCOIN: 'BTC-USD',
  BTCUSD: 'BTC-USD',
  XBT: 'BTC-USD',
  ETH: 'ETH-USD',
  ETHEREUM: 'ETH-USD',
  ETHUSD: 'ETH-USD',
};

/**
 * Yahoo / market-data symbol for an equity or yahoo-fund portfolio key.
 * Strips @channel and maps spot-crypto aliases (BTC → BTC-USD).
 */
export function equityQuoteSymbol(portfolioKey: string): string {
  const base = holdingBaseKey(portfolioKey).trim().toUpperCase();
  return CRYPTO_YAHOO_QUOTE_MAP[base] ?? base;
}

/**
 * Normalize a user-supplied portfolio key: uppercases the base, preserves channel casing.
 * `aapl@moomoo` → `AAPL@moomoo`; `AAPL` → `AAPL`.
 */
export function normalizeHoldingKeyInput(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error('Holding key is required.');
  const at = t.lastIndexOf(HOLDING_KEY_CHANNEL_SEP);
  if (at > 0) {
    const base = t.slice(0, at).trim().toUpperCase();
    const ch = t.slice(at + 1).trim();
    if (!base) throw new Error(`Invalid holding key "${raw}".`);
    if (!ch) return base;
    return `${base}${HOLDING_KEY_CHANNEL_SEP}${ch}`;
  }
  return t.toUpperCase();
}

/**
 * Resolve map key for add_holding (accumulate) / update targeting.
 *
 * - `channelExplicit=true`: match base + channel slot only; else new lot at BASE@channel.
 *   Same stock under different channels → distinct keys.
 * - `channelExplicit=false`: if exactly one lot of that base exists, update it (any channel);
 *   if several, fail-fast (pass channel); if none, create bare unassigned key.
 * Supports legacy bare keys whose channel field still tags the broker.
 */
export function resolveUpsertHoldingKey(
  portfolio: Record<string, Holding>,
  baseKey: string,
  channel: string | undefined,
  channelExplicit = true,
): string {
  const bare = baseKey.trim().toUpperCase();
  if (!bare) throw new Error('Holding key base is required.');
  if (bare.includes(HOLDING_KEY_CHANNEL_SEP)) {
    throw new Error(
      `Holding base key must not contain "${HOLDING_KEY_CHANNEL_SEP}" (got "${baseKey}"). ` +
        `Pass the bare ticker/option id and channel separately.`,
    );
  }

  const byBase = Object.keys(portfolio).filter((k) => holdingBaseKey(k) === bare);

  if (!channelExplicit) {
    if (byBase.length === 1) return byBase[0];
    if (byBase.length > 1) {
      throw new Error(
        `Ticker "${bare}" has multiple channel lots: ${byBase.join(', ')}. ` +
          `Pass channel to choose which lot to update (or to add a new channel lot).`,
      );
    }
    return bare;
  }

  const want = holdingChannelSlot(channel);
  const preferred = buildHoldingKey(bare, channel);
  const matches = byBase.filter(
    (k) => holdingChannelSlot(portfolio[k].channel) === want,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Corrupt portfolio: multiple holdings for ${bare} on channel "${want || '(unassigned)'}": ${matches.join(', ')}`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(portfolio, preferred)) {
    throw new Error(
      `Portfolio key "${preferred}" exists but its channel field does not match "${want || '(unassigned)'}".`,
    );
  }
  return preferred;
}

/**
 * Resolve map key for update/remove from ticker param (+ optional channel).
 * Accepts full key (`AAPL@moomoo`), bare ticker when unique, or ticker+channel.
 * Fail-fast when missing or ambiguous.
 */
export function resolveLookupHoldingKey(
  portfolio: Record<string, Holding>,
  tickerParam: string,
  channel?: string | null,
  channelProvided = false,
): string {
  const raw = normalizeHoldingKeyInput(tickerParam);
  const keys = Object.keys(portfolio);

  if (Object.prototype.hasOwnProperty.call(portfolio, raw)) {
    if (channelProvided) {
      const want = holdingChannelSlot(channel);
      const got = holdingChannelSlot(portfolio[raw].channel);
      if (want !== got) {
        throw new Error(
          `Holding "${raw}" is on channel "${got || '(unassigned)'}", not "${want || '(unassigned)'}".`,
        );
      }
    }
    return raw;
  }

  const base = holdingBaseKey(raw);
  if (channelProvided) {
    const preferred = buildHoldingKey(base, channel);
    if (Object.prototype.hasOwnProperty.call(portfolio, preferred)) return preferred;
    if (
      Object.prototype.hasOwnProperty.call(portfolio, base) &&
      holdingChannelSlot(portfolio[base].channel) === holdingChannelSlot(channel)
    ) {
      return base;
    }
    throw new Error(
      `Holding "${base}" on channel "${holdingChannelSlot(channel) || '(unassigned)'}" not found. ` +
        `Current holdings: ${keys.join(', ') || 'none'}`,
    );
  }

  const matches = keys.filter((k) => k === base || holdingBaseKey(k) === base);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(
      `Ticker "${base}" not found in portfolio. Current holdings: ${keys.join(', ') || 'none'}`,
    );
  }
  throw new Error(
    `Ticker "${base}" matches multiple holdings: ${matches.join(', ')}. ` +
      `Pass the full key (e.g. ${matches[0]}) or set channel to disambiguate.`,
  );
}

/** Equity (stock) portfolio keys only — excludes options and funds. */
export function equityKeys(portfolio: Record<string, Holding>): string[] {
  return Object.keys(portfolio).filter((k) => isEquityHolding(portfolio[k]));
}

/** Fund portfolio keys. */
export function fundKeys(portfolio: Record<string, Holding>): string[] {
  return Object.keys(portfolio).filter((k) => isFundHolding(portfolio[k]));
}

/**
 * Unique Yahoo symbols for live-priced holdings (equities + yahoo funds).
 * Composite keys collapsed to bare symbols.
 */
export function equityQuoteSymbols(portfolio: Record<string, Holding>): string[] {
  return [
    ...new Set(
      Object.keys(portfolio)
        .filter((k) => isYahooPricedHolding(portfolio[k]))
        .map(equityQuoteSymbol),
    ),
  ];
}

export function optionKeys(portfolio: Record<string, Holding>): string[] {
  return Object.keys(portfolio).filter((k) => isOptionHolding(portfolio[k]));
}

/** OCC-style-ish portfolio key: UNDERLYING-P|C-STRIKE-YYYYMMDD-L|S (channel appended separately via buildHoldingKey). */
export function buildOptionKey(input: {
  underlying: string;
  right: 'call' | 'put';
  strike: number;
  expiry: string;
  side: 'long' | 'short';
}): string {
  const u = input.underlying.trim().toUpperCase();
  if (!u) throw new Error('option underlying is required.');
  const right = input.right === 'call' ? 'C' : 'P';
  const side = input.side === 'long' ? 'L' : 'S';
  const expiry = input.expiry.replace(/-/g, '');
  if (!/^\d{8}$/.test(expiry)) {
    throw new Error(`option expiry must be YYYY-MM-DD (got "${input.expiry}").`);
  }
  if (!(input.strike > 0)) throw new Error('option strike must be positive.');
  const strikeKey = Number.isInteger(input.strike)
    ? String(input.strike)
    : String(input.strike).replace(/\.?0+$/, '');
  return `${u}-${right}-${strikeKey}-${expiry}-${side}`;
}

export function formatOptionLabel(o: OptionSpec, units: number): string {
  const side = o.side.toUpperCase();
  const right = o.right.toUpperCase();
  return `${o.underlying} ${side} ${right} $${o.strike} ${o.expiry} ×${units}`;
}

export function assertOptionSpec(o: OptionSpec, key: string): void {
  if (o.right !== 'call' && o.right !== 'put') {
    throw new Error(`Option ${key}: right must be "call" or "put".`);
  }
  if (o.side !== 'long' && o.side !== 'short') {
    throw new Error(`Option ${key}: side must be "long" or "short".`);
  }
  if (!(o.strike > 0)) throw new Error(`Option ${key}: strike must be positive.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.expiry)) {
    throw new Error(`Option ${key}: expiry must be YYYY-MM-DD.`);
  }
  if (!(o.multiplier > 0) || !Number.isFinite(o.multiplier)) {
    throw new Error(`Option ${key}: multiplier must be a positive number (typically 100).`);
  }
  if (!o.underlying || !o.underlying.trim()) {
    throw new Error(`Option ${key}: underlying is required.`);
  }
  if (o.settlement !== 'physical' && o.settlement !== 'cash') {
    throw new Error(`Option ${key}: settlement must be "physical" or "cash".`);
  }
  if (o.mark == null || !(o.mark >= 0) || !Number.isFinite(o.mark)) {
    throw new Error(
      `Option ${key}: mark (premium $ per contract) is required and must be ≥ 0. Use update_holding to set mark.`,
    );
  }
  if (o.underlying_mark != null && (!(o.underlying_mark >= 0) || !Number.isFinite(o.underlying_mark))) {
    throw new Error(`Option ${key}: underlying_mark must be ≥ 0 when set.`);
  }
}

export function assertFundSpec(f: FundSpec, key: string): void {
  if (f.quote_source !== 'yahoo' && f.quote_source !== 'manual') {
    throw new Error(
      `Fund ${key}: fund.quote_source must be "yahoo" or "manual" (no silent default).`,
    );
  }
  if (f.quote_source === 'manual') {
    if (f.mark == null || !(f.mark >= 0) || !Number.isFinite(f.mark)) {
      throw new Error(
        `Fund ${key}: fund.mark (NAV/price per unit) is required when quote_source=manual and must be ≥ 0.`,
      );
    }
  } else if (f.mark != null && (!(f.mark >= 0) || !Number.isFinite(f.mark))) {
    throw new Error(`Fund ${key}: fund.mark must be ≥ 0 when set.`);
  }
  if (f.name != null) {
    if (typeof f.name !== 'string' || f.name.trim().length === 0) {
      throw new Error(`Fund ${key}: fund.name must be a non-empty string when set.`);
    }
  }
}

export function assertHolding(key: string, h: Holding): void {
  if (!(h.avg_price > 0) || !Number.isFinite(h.avg_price)) {
    throw new Error(`Holding ${key}: avg_price must be positive.`);
  }
  if (!(h.units > 0) || !Number.isFinite(h.units)) {
    throw new Error(`Holding ${key}: units must be positive.`);
  }
  // Validate optional channel; empty is allowed (unassigned) but wrong types fail.
  normalizeOptionalChannel(h.channel, `Holding ${key}: channel`);
  if (h.instrument === 'option') {
    if (!h.option) {
      throw new Error(`Holding ${key}: instrument=option requires option fields.`);
    }
    if (h.fund != null) {
      throw new Error(`Holding ${key}: fund fields not allowed on option holdings.`);
    }
    assertOptionSpec(h.option, key);
  } else if (h.instrument === 'fund') {
    if (!h.fund) {
      throw new Error(`Holding ${key}: instrument=fund requires fund fields (quote_source, …).`);
    }
    if (h.option != null) {
      throw new Error(`Holding ${key}: option fields not allowed on fund holdings.`);
    }
    assertFundSpec(h.fund, key);
  } else if (h.instrument != null && h.instrument !== 'equity') {
    throw new Error(`Holding ${key}: instrument must be "equity", "option", or "fund".`);
  } else {
    if (h.option != null) {
      throw new Error(`Holding ${key}: option fields present but instrument is not "option".`);
    }
    if (h.fund != null) {
      throw new Error(`Holding ${key}: fund fields present but instrument is not "fund".`);
    }
  }
}

/**
 * Value one position.
 * @param marketPrice Required for equity and yahoo-priced funds. Ignored for options and manual funds.
 */
export function valuePosition(
  key: string,
  h: Holding,
  marketPrice?: number,
): PositionEconomics {
  assertHolding(key, h);

  if (isOptionHolding(h)) {
    const o = h.option!;
    const contracts = h.units;
    const direction = o.side === 'short' ? -1 : 1;
    // Premium is already total $ per contract — do NOT multiply by multiplier.
    // +0 avoids signed-zero from direction × 0
    const cost = direction * h.avg_price * contracts + 0;
    const value = direction * o.mark * contracts + 0;
    const pl = value - cost + 0;
    const premiumAbsolute = h.avg_price * contracts;
    const plPct = premiumAbsolute > 0 ? (pl / premiumAbsolute) * 100 : 0;

    // Assignment size only — not current MTM (open short is not "triggered" until assigned)
    const sharesControlled = contracts * o.multiplier;
    const contingentCashObligation =
      o.side === 'short' && o.right === 'put' ? o.strike * sharesControlled : 0;
    const contingentShareObligation =
      o.side === 'short' && o.right === 'call' ? sharesControlled : 0;

    const channel = normalizeOptionalChannel(h.channel, `Holding ${key}: channel`);
    return {
      key,
      instrument: 'option',
      label: formatOptionLabel(o, h.units),
      units: h.units,
      avgCost: h.avg_price,
      price: o.mark,
      cost,
      value,
      pl,
      plPct,
      category: h.category ?? 'Options',
      ...(channel != null ? { channel } : {}),
      premiumAbsolute,
      contingentCashObligation,
      contingentShareObligation,
      option: o,
    };
  }

  if (isFundHolding(h)) {
    const f = h.fund!;
    let price: number;
    if (f.quote_source === 'manual') {
      price = f.mark!;
    } else {
      if (marketPrice == null || !Number.isFinite(marketPrice)) {
        throw new Error(
          `Missing market price for fund ${equityQuoteSymbol(key)} (key ${key}, quote_source=yahoo). ` +
            `Cannot value fund position.`,
        );
      }
      price = marketPrice;
    }
    const cost = h.avg_price * h.units;
    const value = price * h.units;
    const pl = value - cost;
    const channel = normalizeOptionalChannel(h.channel, `Holding ${key}: channel`);
    const name = f.name?.trim();
    return {
      key,
      instrument: 'fund',
      label: name && name.length > 0 ? name : equityQuoteSymbol(key),
      units: h.units,
      avgCost: h.avg_price,
      price,
      cost,
      value,
      pl,
      plPct: cost > 0 ? (pl / cost) * 100 : 0,
      category: h.category ?? 'Funds',
      ...(channel != null ? { channel } : {}),
      premiumAbsolute: 0,
      contingentCashObligation: 0,
      contingentShareObligation: 0,
      fund: f,
    };
  }

  if (marketPrice == null || !Number.isFinite(marketPrice)) {
    throw new Error(
      `Missing market price for ${equityQuoteSymbol(key)} (key ${key}). Cannot value equity position. ` +
        `If this is a fund/MMF/non-Yahoo product, re-add as instrument=fund with fund_quote_source=manual and mark=NAV.`,
    );
  }
  const cost = h.avg_price * h.units;
  const value = marketPrice * h.units;
  const pl = value - cost;
  const channel = normalizeOptionalChannel(h.channel, `Holding ${key}: channel`);
  return {
    key,
    instrument: 'equity',
    label: equityQuoteSymbol(key),
    units: h.units,
    avgCost: h.avg_price,
    price: marketPrice,
    cost,
    value,
    pl,
    plPct: cost > 0 ? (pl / cost) * 100 : 0,
    category: h.category ?? 'Uncategorized',
    ...(channel != null ? { channel } : {}),
    premiumAbsolute: 0,
    contingentCashObligation: 0,
    contingentShareObligation: 0,
  };
}

/**
 * Value full portfolio.
 * `prices` keyed by Yahoo symbols (bare tickers) for equities and yahoo-priced funds.
 * Manual funds and options use stored marks.
 * Fail-fast: any missing live price throws (use {@link valuePortfolioLenient} for dashboard).
 */
export function valuePortfolio(
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
): PositionEconomics[] {
  const keys = Object.keys(portfolio);
  if (keys.length === 0) {
    throw new Error('No portfolio saved. Use add_holding to build a portfolio first.');
  }
  return keys.map((key) => {
    const h = portfolio[key];
    if (isOptionHolding(h)) return valuePosition(key, h);
    if (isFundHolding(h) && h.fund?.quote_source === 'manual') {
      return valuePosition(key, h);
    }
    return valuePosition(key, h, prices[equityQuoteSymbol(key)]);
  });
}

export type PortfolioValuationIssueCode =
  | 'missing_price'
  | 'invalid_holding'
  | 'valuation_error';

export interface PortfolioValuationIssue {
  key: string;
  code: PortfolioValuationIssueCode;
  message: string;
  /** cost = MTM at book cost (not a market invent); skipped = row omitted from NAV */
  recovery: 'cost' | 'skipped';
}

export interface LenientPositionEconomics extends PositionEconomics {
  /** How the mark was obtained for this row. */
  pricingMode: 'live' | 'cost' | 'manual' | 'option';
  pricingNote?: string;
}

/**
 * Value portfolio for dashboard display.
 * Never invents a market price: missing Yahoo quote → value at **book cost** (P/L = 0)
 * with an explicit issue. Corrupt holdings are skipped with an issue.
 * Empty portfolio → empty economics (no throw).
 */
export function valuePortfolioLenient(
  portfolio: Record<string, Holding>,
  prices: Record<string, number>,
): { economics: LenientPositionEconomics[]; issues: PortfolioValuationIssue[] } {
  const issues: PortfolioValuationIssue[] = [];
  const economics: LenientPositionEconomics[] = [];
  const keys = Object.keys(portfolio);

  for (const key of keys) {
    const h = portfolio[key];
    try {
      if (isOptionHolding(h)) {
        const e = valuePosition(key, h);
        economics.push({ ...e, pricingMode: 'option' });
        continue;
      }
      if (isFundHolding(h) && h.fund?.quote_source === 'manual') {
        const e = valuePosition(key, h);
        economics.push({
          ...e,
          pricingMode: 'manual',
          pricingNote: 'Manual fund mark',
        });
        continue;
      }
      const quoteSym = equityQuoteSymbol(key);
      const marketPrice = prices[quoteSym];
      if (marketPrice == null || !Number.isFinite(marketPrice)) {
        // Book-cost MTM — not a market invent. P/L forced to 0 at cost.
        const e = valuePosition(key, h, h.avg_price);
        const note =
          `No live Yahoo price for ${quoteSym} (key ${key}). ` +
          `Shown at book cost $${h.avg_price.toFixed(4)}. ` +
          (isFundHolding(h)
            ? 'Set fund_quote_source=manual with mark=NAV, or fix the Yahoo symbol.'
            : 'If this is a fund/platform product, re-add as instrument=fund fund_quote_source=manual mark=NAV.');
        issues.push({
          key,
          code: 'missing_price',
          message: note,
          recovery: 'cost',
        });
        economics.push({
          ...e,
          price: h.avg_price,
          value: e.cost,
          pl: 0,
          plPct: 0,
          pricingMode: 'cost',
          pricingNote: note,
        });
        continue;
      }
      const e = valuePosition(key, h, marketPrice);
      economics.push({ ...e, pricingMode: 'live' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      issues.push({
        key,
        code: /avg_price|units|instrument|option|fund/.test(message)
          ? 'invalid_holding'
          : 'valuation_error',
        message,
        recovery: 'skipped',
      });
    }
  }

  return { economics, issues };
}
