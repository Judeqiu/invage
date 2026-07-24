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

import type { Holding, OptionSpec } from './types.js';

export interface PositionEconomics {
  key: string;
  instrument: 'equity' | 'option';
  /** Display label (ticker or option description). */
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
  /** Absolute premium exchanged (options only); 0 for equity. */
  premiumAbsolute: number;
  /** Contingent cash outlay if short put assigned; 0 otherwise. Not current MTM. */
  contingentCashObligation: number;
  /** Shares deliverable if short call assigned; 0 otherwise. */
  contingentShareObligation: number;
  option?: OptionSpec;
}

export function isOptionHolding(h: Holding): boolean {
  return h.instrument === 'option';
}

export function equityKeys(portfolio: Record<string, Holding>): string[] {
  return Object.keys(portfolio).filter((k) => !isOptionHolding(portfolio[k]));
}

export function optionKeys(portfolio: Record<string, Holding>): string[] {
  return Object.keys(portfolio).filter((k) => isOptionHolding(portfolio[k]));
}

/** OCC-style-ish portfolio key: UNDERLYING-P|C-STRIKE-YYYYMMDD-L|S */
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

export function assertHolding(key: string, h: Holding): void {
  if (!(h.avg_price > 0) || !Number.isFinite(h.avg_price)) {
    throw new Error(`Holding ${key}: avg_price must be positive.`);
  }
  if (!(h.units > 0) || !Number.isFinite(h.units)) {
    throw new Error(`Holding ${key}: units must be positive.`);
  }
  if (h.instrument === 'option') {
    if (!h.option) {
      throw new Error(`Holding ${key}: instrument=option requires option fields.`);
    }
    assertOptionSpec(h.option, key);
  } else if (h.instrument != null && h.instrument !== 'equity') {
    throw new Error(`Holding ${key}: instrument must be "equity" or "option".`);
  } else if (h.option != null) {
    throw new Error(`Holding ${key}: option fields present but instrument is not "option".`);
  }
}

/**
 * Value one position.
 * @param marketPrice Required for equity (Yahoo or override). Ignored for options (uses option.mark).
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
      premiumAbsolute,
      contingentCashObligation,
      contingentShareObligation,
      option: o,
    };
  }

  if (marketPrice == null || !Number.isFinite(marketPrice)) {
    throw new Error(`Missing market price for ${key}. Cannot value equity position.`);
  }
  const cost = h.avg_price * h.units;
  const value = marketPrice * h.units;
  const pl = value - cost;
  return {
    key,
    instrument: 'equity',
    label: key,
    units: h.units,
    avgCost: h.avg_price,
    price: marketPrice,
    cost,
    value,
    pl,
    plPct: cost > 0 ? (pl / cost) * 100 : 0,
    category: h.category ?? 'Uncategorized',
    premiumAbsolute: 0,
    contingentCashObligation: 0,
    contingentShareObligation: 0,
  };
}

/** Value full portfolio. `prices` keyed by equity portfolio keys only. */
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
    return valuePosition(key, h, prices[key]);
  });
}
