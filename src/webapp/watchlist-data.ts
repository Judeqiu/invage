/**
 * Load playbook watchlists + live quotes for the Watch List page.
 * Quote misses become per-row quoteError — never invent 0.
 */

import { loadInvestor } from '../state/investor-store.js';
import { fetchPriceSnapshots, type YahooPriceSnapshot } from '../market/fetch-prices.js';
import { getPlaybook, type InvestorState } from '../state/portfolio-state.js';
import type { WatchInstrument, WatchProduct } from '../playbook/index.js';

export interface WatchQuoteOverride {
  price?: number | null;
  change?: number | null;
  changePct?: number | null;
  currency?: string | null;
  quoteError?: string;
}

export interface WatchProductRow {
  symbol: string;
  instrument: WatchInstrument;
  added_at: string;
  note?: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  quoteError?: string;
}

export interface WatchlistPayload {
  slug: string;
  displayName: string;
  generatedAt: string;
  watchlists: {
    markets: string[];
    sectors: string[];
    themes: string[];
  };
  products: WatchProductRow[];
}

function changeFromSnapshot(s: YahooPriceSnapshot): {
  price: number;
  change: number | null;
  changePct: number | null;
  currency: string;
} {
  const prev = s.previousClose;
  if (prev == null || prev === 0) {
    return { price: s.price, change: null, changePct: null, currency: s.currency };
  }
  const change = Number((s.price - prev).toFixed(4));
  const changePct = Number((((s.price - prev) / prev) * 100).toFixed(2));
  return { price: s.price, change, changePct, currency: s.currency };
}

function rowFromProduct(
  p: WatchProduct,
  quote: WatchQuoteOverride | YahooPriceSnapshot | undefined,
  fetchError?: string,
): WatchProductRow {
  const base: WatchProductRow = {
    symbol: p.symbol,
    instrument: p.instrument,
    added_at: p.added_at,
    price: null,
    change: null,
    changePct: null,
    currency: null,
  };
  if (p.note !== undefined) base.note = p.note;

  if (quote && 'quoteError' in quote && quote.quoteError) {
    return { ...base, quoteError: quote.quoteError };
  }
  if (quote && 'priceField' in quote) {
    const q = changeFromSnapshot(quote);
    return { ...base, ...q };
  }
  if (quote && 'price' in quote && quote.price != null) {
    return {
      ...base,
      price: quote.price,
      change: quote.change ?? null,
      changePct: quote.changePct ?? null,
      currency: quote.currency ?? null,
    };
  }
  return {
    ...base,
    quoteError: fetchError ?? `Yahoo quote unavailable for ${p.symbol}`,
  };
}

export async function loadWatchlistForSlug(
  slug: string,
  quoteOverride?: Record<string, WatchQuoteOverride>,
): Promise<WatchlistPayload> {
  const state = (await loadInvestor(slug)).state;
  const playbook = getPlaybook(state);
  const generatedAt = new Date().toISOString();
  const products = [...playbook.watchlists.products].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );

  let snaps: Record<string, YahooPriceSnapshot> = {};
  let fetchError: string | undefined;
  if (!quoteOverride && products.length > 0) {
    try {
      snaps = await fetchPriceSnapshots(products.map((p) => p.symbol));
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
  }

  return {
    slug,
    displayName: state.profile.display_name,
    generatedAt,
    watchlists: {
      markets: [...playbook.watchlists.markets],
      sectors: [...playbook.watchlists.sectors],
      themes: [...playbook.watchlists.themes],
    },
    products: products.map((p) => {
      if (quoteOverride) return rowFromProduct(p, quoteOverride[p.symbol]);
      return rowFromProduct(p, snaps[p.symbol], fetchError);
    }),
  };
}
