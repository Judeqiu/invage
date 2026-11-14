export interface MooMooEnvelope {
  s: string;
  d?: unknown;
  errcode?: number;
  errmsg?: string;
}

/** Independent evidence: unavailable is never an empty holdings list. */
export interface CloudFundPositionsEvidence {
  status: 'available' | 'unavailable';
  observed_at: string;
  http_status: number | null;
  response_body: string | null;
  response?: MooMooEnvelope;
  failure?: 'http' | 'broker' | 'malformed' | 'transport';
}

export interface MooMooRawBundle {
  /** Fund identity/quantity/value evidence; no inferred currency or product class. */
  fund_positions?: CloudFundPositionsEvidence;
  history_error?: string;
  schema: 'invage.moomoo.raw.v1' | 'invage.futubull.cloud.raw.v1';
  fetched_at: string;
  acc_id: string;
  authorized: MooMooEnvelope;
  funds: MooMooEnvelope;
  positions: MooMooEnvelope;
  /** Exact-code static contract metadata, retained for reproducible mapping. */
  option_basicinfo?: Record<string, unknown>[];
  /** Complete paginated fill history, with the requested range retained. */
  fills_history?: { start: string; end: string; rows: Record<string, unknown>[] };
  orders_history?: { start: string; end: string; rows: Record<string, unknown>[] };
  orders_details?: Record<string, unknown>[];
  /** Order-scoped fee totals and breakdowns from the dedicated read-only endpoint. */
  orders_fees?: Record<string, unknown>[];
  /** Exact cash logs and complete contract fill queries for fee/metadata recovery.
   * The fee_fills_history name is retained for existing archive compatibility. */
  cash_logs?: import('./moomoo-cash-fees.js').CashLogEvidence[];
  fee_fills_history?: Array<{code:string;from:string;through:string;rows:Record<string,unknown>[]} >;
  fee_gaps?: Array<{ reference: string; reason: string }>;
  history_mode?: 'full' | 'incremental';
  history_gaps?: Array<{ reference: string | null; reason: string }>;
}

export function envelopeOk(env: MooMooEnvelope): boolean {
  return env.s === 'ok';
}
