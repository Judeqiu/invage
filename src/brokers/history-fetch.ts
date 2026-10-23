import { BrokerHttpError } from './errors.js';
import type { BrokerRawPayload } from './adapter.js';

/** Safe diagnostic: vendor error bodies/URLs may contain credentials. */
export function deferredHistoryReason(broker: string, error: unknown): string {
  const code = error instanceof BrokerHttpError && /^[A-Za-z0-9_.-]{1,60}$/.test(error.vendorCode ?? '') ? ` (${error.vendorCode})` : '';
  return `${broker} historical enrichment unavailable${code}; retain current snapshot and retry history.`;
}
export function jsonBrokerPayload(bundle: object & { history_error?: string; fetched_at?: string }, meta?: Record<string, string>): BrokerRawPayload {
  return { kind: 'json', body: Buffer.from(JSON.stringify(bundle)), meta: {...meta, ...(bundle.fetched_at ? {snapshot_at:bundle.fetched_at} : {})},
    ...(bundle.history_error ? { historyDeferred: { reason: bundle.history_error } } : {}) };
}
