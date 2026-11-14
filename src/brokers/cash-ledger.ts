/** Broker cash observations, never postings to the balance/position books. */
import { createHash } from 'node:crypto';
import { decimal, validDate } from './option-executions.js';
import type { BrokerHistoryScope } from './history.js';

export interface BrokerCashLedgerRecord {
  id: string;
  segment: string | null;
  business_date: string | null;
  currency: string | null;
  amount: string | null;
  reported_type: string | null;
  description: string | null;
  contract_name: string | null;
  source_updated_at: string | null;
  source_path: string;
  /** Some broker cash APIs expose no stable transaction ID. */
  identity_basis?: 'native_id' | 'content_occurrence';
  reported_time?: string | null;
  reported_balance?: string | null;
  native_symbol?: string | null;
  currency_source?: string | null;
}
export interface BrokerCashLedgerBatch {
  /** Observation content identity excludes only archive location. */
  id: string;
  source: string;
  observed_at: string;
  from: string;
  through: string;
  segments: string[];
  complete: boolean;
  gaps: string[];
  source_ref: string | null;
  evidence_sha256: string;
  records: BrokerCashLedgerRecord[];
}
export interface BrokerCashLedger extends BrokerHistoryScope { batches: BrokerCashLedgerBatch[] }

function object(raw: unknown, allowed: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) throw Error('Invalid broker cash ledger object');
  return raw as Record<string, unknown>;
}
function text(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw Error('Broker cash ledger text required');
  return raw;
}
const nullable = (raw: unknown) => raw === null ? null : text(raw);
function date(raw: unknown): string {
  const value = text(raw); if (!validDate(value)) throw Error('Invalid broker cash ledger date'); return value;
}
function stamp(raw: unknown): string {
  const value = text(raw);
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error('Broker cash ledger observation needs an exact UTC timestamp');
  return value;
}
function texts(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw Error('Broker cash ledger text array required'); return raw.map(text);
}
function hash(raw: unknown): string {
  const value = text(raw); if (!/^[a-f0-9]{64}$/.test(value)) throw Error('Invalid broker cash ledger digest'); return value;
}
const recordFields = ['id','segment','business_date','currency','amount','reported_type','description','contract_name','source_updated_at','source_path','identity_basis','reported_time','reported_balance','native_symbol','currency_source'];
/** Fixed field order makes persisted jsonb and fresh mapper output equivalent. */
export function cashLedgerBatchId(batch: Omit<BrokerCashLedgerBatch, 'id'>): string {
  return createHash('sha256').update(JSON.stringify({ source: batch.source, observed_at: batch.observed_at, from: batch.from, through: batch.through,
    segments: batch.segments, complete: batch.complete, gaps: batch.gaps, evidence_sha256: batch.evidence_sha256, records: batch.records.map(r => Object.fromEntries(recordFields.filter(k => Object.hasOwn(r,k)).map(k => [k,(r as unknown as Record<string,unknown>)[k]]))) })).digest('hex');
}
export function assertBrokerCashLedger(raw: unknown): BrokerCashLedger {
  const o = object(raw, ['broker_id','channel','account_id','batches']);
  if (!Array.isArray(o.batches)) throw Error('Broker cash ledger batches required');
  const batches = o.batches.map(rawBatch => {
    const b = object(rawBatch, ['id','source','observed_at','from','through','segments','complete','gaps','source_ref','evidence_sha256','records']);
    if (!Array.isArray(b.records) || typeof b.complete !== 'boolean') throw Error('Invalid broker cash ledger batch');
    const records = b.records.map(rawRecord => {
      const r = object(rawRecord, recordFields);
      if (r.identity_basis !== undefined && r.identity_basis !== 'native_id' && r.identity_basis !== 'content_occurrence') throw Error('Invalid cash ledger identity basis');
      return { id:text(r.id), segment:nullable(r.segment), business_date:r.business_date === null ? null : date(r.business_date),
        currency:nullable(r.currency), amount:r.amount === null ? null : decimal(r.amount), reported_type:nullable(r.reported_type),
        description:nullable(r.description), contract_name:nullable(r.contract_name), source_updated_at:nullable(r.source_updated_at), source_path:text(r.source_path),
        ...(r.identity_basis !== undefined ? {identity_basis:r.identity_basis as 'native_id' | 'content_occurrence'} : {}),
        ...Object.fromEntries(['reported_time','reported_balance','native_symbol','currency_source'].filter(k => k in r).map(k => [k,nullable(r[k])])) };
    });
    const batch: BrokerCashLedgerBatch = { id:hash(b.id), source:text(b.source), observed_at:stamp(b.observed_at), from:date(b.from), through:date(b.through),
      segments:texts(b.segments), complete:b.complete, gaps:texts(b.gaps), source_ref:nullable(b.source_ref), evidence_sha256:hash(b.evidence_sha256), records };
    if (batch.from > batch.through || new Set(batch.segments).size !== batch.segments.length || batch.complete && batch.gaps.length) throw Error('Invalid broker cash ledger coverage');
    if (new Set(records.map(record => JSON.stringify([record.segment,record.id]))).size !== records.length) throw Error('Duplicate broker cash ledger record');
    if (batch.id !== cashLedgerBatchId(batch)) throw Error('Broker cash ledger batch digest mismatch');
    return batch;
  });
  if (new Set(batches.map(b => b.id)).size !== batches.length) throw Error('Duplicate broker cash ledger batch');
  return {broker_id:text(o.broker_id),channel:text(o.channel),account_id:text(o.account_id),batches};
}
export function mergeBrokerCashLedger(previous: BrokerCashLedger | undefined, incoming: BrokerCashLedger): BrokerCashLedger {
  const next = assertBrokerCashLedger(incoming), old = previous ? assertBrokerCashLedger(previous) : undefined;
  if (old && (old.broker_id !== next.broker_id || old.channel !== next.channel || old.account_id !== next.account_id)) throw Error('Broker cash ledger scope cannot change');
  const batches = new Map((old?.batches ?? []).map(b => [b.id,b]));
  for (const batch of next.batches) if (!batches.has(batch.id)) batches.set(batch.id,batch);
  const merged = {...next,batches:[...batches.values()].sort((a,b) => a.observed_at.localeCompare(b.observed_at) || a.id.localeCompare(b.id))};
  currentCashLedgerRecords(merged); // Reject ambiguous equally timed revisions before persistence.
  return merged;
}
/** One latest observation per endpoint/segment/native ID. Older versions remain in batches.
 * An absent row never deletes a retained record, even on a complete request.
 */
export function currentCashLedgerRecords(ledger: BrokerCashLedger) {
  const found = new Map<string, {record:BrokerCashLedgerRecord;batch:BrokerCashLedgerBatch}>();
  for (const batch of ledger.batches) for (const record of batch.records) {
    const key = JSON.stringify([batch.source,record.segment,record.id]), prior = found.get(key);
    if (prior && prior.batch.observed_at === batch.observed_at && JSON.stringify({...prior.record,source_path:''}) !== JSON.stringify({...record,source_path:''})) throw Error('Conflicting broker cash ledger observations at the same time');
    if (!prior || batch.observed_at > prior.batch.observed_at) found.set(key,{record,batch});
  }
  return [...found.values()];
}
