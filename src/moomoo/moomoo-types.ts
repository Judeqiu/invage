export interface MooMooEnvelope {
  s: string;
  d?: unknown;
  errcode?: number;
  errmsg?: string;
}

export interface MooMooRawBundle {
  schema: 'invage.moomoo.raw.v1';
  fetched_at: string;
  acc_id: string;
  authorized: MooMooEnvelope;
  funds: MooMooEnvelope;
  positions: MooMooEnvelope;
  /** Exact-code static contract metadata, retained for reproducible mapping. */
  option_basicinfo?: Record<string, unknown>[];
  /** Complete paginated fill history, with the requested range retained. */
  fills_history?: { start: string; end: string; rows: Record<string, unknown>[] };
}

export function envelopeOk(env: MooMooEnvelope): boolean {
  return env.s === 'ok';
}
