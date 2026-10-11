/**
 * Product display name for this Invage instance.
 * Required env — no silent default (Wallet Street, Victor Consultant, …).
 */

export function productDisplayName(): string {
  const n = process.env.UTARUS_AGENT_NAME?.trim();
  if (!n) {
    throw new Error('UTARUS_AGENT_NAME is required (product display name).');
  }
  return n;
}

/** Compact @mention / host id: "Victor Consultant" → "VictorConsultant". */
export function productHostLabel(): string {
  return productDisplayName().replace(/\s+/g, '');
}
