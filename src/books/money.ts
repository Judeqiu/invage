/**
 * Ledger money: integer minor units (scale 6). No floating accounting in the DB.
 * Application amounts are number; conversion fails fast on non-finite / excess precision.
 */

export const MONEY_SCALE = 6;
const MONEY_FACTOR = 1_000_000;

export function assertCurrency(currency: string): string {
  if (typeof currency !== 'string' || currency.trim().length === 0) {
    throw new Error('currency is required (e.g. USD, SGD) — no silent default.');
  }
  const ccy = currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(ccy)) {
    throw new Error(`currency must be 3–4 letters (got "${currency}").`);
  }
  return ccy;
}

/**
 * Convert decimal amount → minor units (bigint) at fixed scale 6.
 * Uses toFixed so IEEE float noise (e.g. 16698.19 * 1e6) does not fail-fast incorrectly.
 * Still rejects non-finite inputs.
 */
export function toMinor(amount: number): bigint {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error(`toMinor: amount must be a finite number (got ${String(amount)}).`);
  }
  // toFixed rounds half-up to scale; parse as integer minor units
  const fixed = amount.toFixed(MONEY_SCALE);
  const neg = fixed.startsWith('-');
  const body = neg ? fixed.slice(1) : fixed;
  const [whole, frac = ''] = body.split('.');
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(frac) || frac.length !== MONEY_SCALE) {
    throw new Error(`toMinor: failed to parse amount ${amount} as scale-${MONEY_SCALE}.`);
  }
  const minor = BigInt(whole) * BigInt(MONEY_FACTOR) + BigInt(frac);
  return neg ? -minor : minor;
}

/** Minor units → number for API/YAML projection. */
export function fromMinor(minor: bigint | string | number): number {
  const n = typeof minor === 'bigint' ? minor : BigInt(minor);
  return Number(n) / MONEY_FACTOR;
}

export function assertNonNegativeMinor(minor: bigint, label: string): void {
  if (minor < 0n) {
    throw new Error(`${label} must be ≥ 0 (got ${fromMinor(minor)}).`);
  }
}

/** Normalize channel for account keys: null/undefined/blank → ''. */
export function normalizeChannelKey(channel: string | undefined | null): string {
  if (channel == null) return '';
  const t = String(channel).trim();
  return t.length === 0 ? '' : t;
}

export function formatChannelLabel(channel: string): string {
  return channel.length > 0 ? channel : '(unassigned)';
}
