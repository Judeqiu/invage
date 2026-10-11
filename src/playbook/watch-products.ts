/**
 * Named watch-list products on the Investment Playbook.
 * Interest only — never holdings, never books.
 */

import {
  WATCH_INSTRUMENTS,
  type WatchInstrument,
  type WatchProduct,
} from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeWatchSymbol(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error('watch product symbol must be a string');
  }
  const symbol = raw.trim().toUpperCase();
  if (!symbol) {
    throw new Error('watch product symbol must be a non-empty string');
  }
  return symbol;
}

function isWatchInstrument(v: unknown): v is WatchInstrument {
  return typeof v === 'string' && (WATCH_INSTRUMENTS as readonly string[]).includes(v);
}

function assertAddedAt(v: unknown): string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) {
    throw new Error(`watch product added_at must be YYYY-MM-DD, got: ${String(v)}`);
  }
  return v;
}

function optionalNote(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error('watch product note must be a string when present');
  }
  const note = v.trim();
  return note === '' ? undefined : note;
}

function parseOneProduct(raw: unknown, index: number): WatchProduct {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`watchlists.products[${index}] must be a mapping`);
  }
  const p = raw as Record<string, unknown>;
  if (!isWatchInstrument(p.instrument)) {
    throw new Error(
      `watchlists.products[${index}].instrument must be one of: ${WATCH_INSTRUMENTS.join(', ')}`,
    );
  }
  const product: WatchProduct = {
    symbol: normalizeWatchSymbol(p.symbol as string),
    instrument: p.instrument,
    added_at: assertAddedAt(p.added_at),
  };
  const note = optionalNote(p.note);
  if (note !== undefined) product.note = note;
  return product;
}

/** Parse stored products. Missing/null → []. Not-an-array → throw. Duplicates → throw. */
export function parseWatchProducts(raw: unknown): WatchProduct[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('watchlists.products must be an array');
  }
  const products = raw.map((item, i) => parseOneProduct(item, i));
  const seen = new Set<string>();
  for (const p of products) {
    if (seen.has(p.symbol)) {
      throw new Error(`watchlists.products contains duplicate symbol ${p.symbol}`);
    }
    seen.add(p.symbol);
  }
  return products;
}

export function addWatchProduct(
  current: WatchProduct[],
  input: { symbol: string; instrument: string; note?: string; added_at?: string },
): WatchProduct[] {
  if (!isWatchInstrument(input.instrument)) {
    throw new Error(`watch product instrument must be one of: ${WATCH_INSTRUMENTS.join(', ')}`);
  }
  const symbol = normalizeWatchSymbol(input.symbol);
  if (current.some((p) => p.symbol === symbol)) {
    throw new Error(`Watch product ${symbol} is already on the list`);
  }
  const added_at = input.added_at ?? new Date().toISOString().slice(0, 10);
  assertAddedAt(added_at);
  const next: WatchProduct = { symbol, instrument: input.instrument, added_at };
  const note = optionalNote(input.note);
  if (note !== undefined) next.note = note;
  return [...current, next];
}

export function removeWatchProduct(current: WatchProduct[], symbolRaw: string): WatchProduct[] {
  const symbol = normalizeWatchSymbol(symbolRaw);
  const next = current.filter((p) => p.symbol !== symbol);
  if (next.length === current.length) {
    throw new Error(`Watch product ${symbol} is not on the list`);
  }
  return next;
}
