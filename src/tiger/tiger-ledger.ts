import { createHash } from 'node:crypto';
import { assertBrokerCashLedger, cashLedgerBatchId, type BrokerCashLedger, type BrokerCashLedgerBatch } from '../brokers/cash-ledger.js';
import { validDate, decimal } from '../brokers/option-executions.js';
import type { TigerRawBundle } from './tiger-types.js';

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v : null;
/** Types/descriptions are broker labels. No free-text classification or FX is performed. */
export function mapTigerCashLedger(bundle: TigerRawBundle, channel: string): BrokerCashLedger | undefined {
  const evidence = bundle.history?.fund_details;
  if (!evidence) return undefined;
  const gaps = [...(evidence.gaps ?? [])];
  if (!evidence.complete && !gaps.length) gaps.push('Tiger fund detail retrieval is incomplete; retained rows do not establish complete coverage.');
  if (!evidence.segments) gaps.push('Retained source does not record requested segment coverage.');
  const records = evidence.rows.map((r,index) => {
    if (r.accountId != null && String(r.accountId) !== bundle.account || r.account != null && String(r.account) !== bundle.account) throw Error('Tiger ledger account mismatch');
    if (!text(r.id)) throw Error('Tiger ledger source record ID unavailable');
    const rawDate = text(r.businessDate)?.replaceAll('/','-');
    const business_date = rawDate && validDate(rawDate) ? rawDate : null;
    let amount: string | null = null;
    if (r.amount != null) { try { amount = decimal(r.amount); } catch { /* Unknown remains null; raw source is retained. */ } }
    const currency = text(r.currency);
    if (business_date === null || amount === null || currency === null) gaps.push(`Tiger ledger record ${r.id} has unavailable date, amount or currency; consult source evidence.`);
    return {id:text(r.id)!,segment:text(r.segType),business_date,currency,amount,reported_type:text(r.type),description:text(r.desc),contract_name:text(r.contractName),
      source_updated_at:r.updatedAt == null ? null : String(r.updatedAt),source_path:`/history/fund_details/rows/${index}`};
  });
  const batch: Omit<BrokerCashLedgerBatch,'id'> = {source:'tiger.fund_details', observed_at:bundle.fetched_at,
    from:evidence.from.slice(0,10),through:evidence.through.slice(0,10),segments:evidence.segments ?? [],complete:evidence.complete && !gaps.length,
    gaps,source_ref:null,evidence_sha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),records};
  return assertBrokerCashLedger({broker_id:'tiger',channel,account_id:bundle.account,batches:[{...batch,id:cashLedgerBatchId(batch)}]});
}
