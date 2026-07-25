/**
 * Invage credit conversion rates (utarus credit currency).
 *
 * Required at createFramework boot (utarus ≥ 1.17) whether billing is on or off.
 * Anchor: 100 credits ≡ $0.10 USD → 1 credit ≡ $0.001.
 * LLM: 1 credit / 1k tokens (default DeepSeek-class).
 * Tools: 10 credits / call for metered research & report tools.
 * Unlisted tools → 0 credits (portfolio CRUD, playbook, etc.).
 *
 * Paywall / Stripe plans are not configured yet — do not set UTARUS_BILLING_ENABLED.
 */

import type { CreditRatesCatalog } from 'utarus';

export const INVAGE_CREDIT_RATES: CreditRatesCatalog = {
  version: 1,
  llm: {
    credits_per_1k_tokens: {
      default: 1,
    },
  },
  tools: {
    firecrawl: 10,
    get_quote: 10,
    portfolio_analyzer: 10,
    save_report: 10,
    send_report: 10,
    write_report: 10,
  },
  resources: {},
};
