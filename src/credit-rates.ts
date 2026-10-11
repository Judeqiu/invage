/**
 * Invage credit conversion rates (utarus credit currency).
 *
 * Required at createFramework boot (utarus ≥ 1.17) whether billing is on or off.
 * Anchor: 100 credits ≡ $0.10 USD → 1 credit ≡ $0.001.
 *
 * Schema (utarus ≥ v3.0.0-beta.61 — credits_per_1k_tokens and flat tools.{name}
 * are removed and fail boot):
 * - llm.tokens_per_credit: fresh (uncached) tokens per 1 credit, integer ≥ 1.
 *   Keys must cover every UTARUS_LLM_PROFILES name (daily / vision / heavy).
 * - llm.cache_read_tokens_per_credit: cache-read tokens per 1 credit, integer ≥ 1.
 *   Ratios mirror Binary: daily ×120 (DeepSeek hit/miss), vision/heavy ×12.
 * - tools.credits_per_call: must include "default" (0 = unmetered); named keys
 *   override. 10 credits / call for metered research & report tools.
 *
 * Pricing preserved from the old catalog: daily 1 cr / 1k fresh tokens,
 * vision/heavy 10 cr / 1k fresh tokens.
 *
 * Paywall / Stripe plans are not configured yet — do not set UTARUS_BILLING_ENABLED.
 */

import type { CreditRatesCatalog } from 'utarus';

export const INVAGE_CREDIT_RATES: CreditRatesCatalog = {
  version: 1,
  llm: {
    tokens_per_credit: {
      default: 1000,
      daily: 1000,
      vision: 100,
      heavy: 100,
    },
    cache_read_tokens_per_credit: {
      default: 120_000,
      daily: 120_000,
      vision: 12_000,
      heavy: 12_000,
    },
  },
  tools: {
    credits_per_call: {
      default: 0,
      firecrawl: 10,
      get_quote: 10,
      portfolio_analyzer: 10,
      save_report: 10,
      send_report: 10,
      write_report: 10,
    },
  },
  resources: {},
};
