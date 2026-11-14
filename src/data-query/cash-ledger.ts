import { assertBrokerCashLedger, currentCashLedgerRecords } from '../brokers/cash-ledger.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { Dataset, Field, Row } from './catalog.js';

const field = (type: Field['type'], description: string): Field => ({type,description,nullable:true});
const text = (description: string) => field('string',description);
const scope = {broker_id:text('Broker identifier.'),channel:text('Bound custody channel.'),account_id:text('Bound broker account identifier.')};
const ledgers = (s: InvestorState) => Object.entries(s.broker_cash_ledgers ?? {}).map(([channel,value]) => {
  const ledger = assertBrokerCashLedger(value);
  if (ledger.channel !== channel) throw Error('Stored cash ledger channel key mismatch');
  return ledger;
});
const caveats = [
  'Broker cash observations, not accounting postings, current balances, execution profit or additional trade cash. Never add these amounts to broker cash snapshots or execution cash.',
  'Amounts retain broker signs and exact native currency. No FX, inferred category, direction or internal-transfer netting. Unknown values remain null.',
  'Check broker_cash_ledger_coverage before totals. Complete means every page for that request/segment scope; it does not establish account-lifetime completeness or continuous coverage between requests.',
  'Latest observed version per source, segment and native record ID is returned. Earlier source versions remain in broker_cash_ledger_versions. Do not sum versions or duplicate records across distinct sources.',
];
function dataset(description: string, fields: Record<string,Field>, rows: (s:InvestorState)=>object[]): Dataset {
  return {description,fields,caveats,available:s=>s.broker_cash_ledgers!==undefined,
    rows:s=>rows(s).map(r=>Object.fromEntries(Object.keys(fields).map(k=>[k,(r as Row)[k] ?? null])))};
}
const recordFields = {...scope,id:text('Broker record ID; join with source, segment, channel and account.'),source:text('Exact API source, such as tiger.fund_details.'),
  segment:text('Reported account segment, e.g. SEC or FUND; null when unreported.'), business_date:field('date','Broker-defined business date, not a fabricated execution timestamp.'),
  currency:text('Reported native currency.'),amount:{...field('decimal','Exact signed broker cash amount; zero and rebates are preserved.'),unit:'native currency',sum_group_by:['currency'],comparison_group_by:['currency']},
  reported_type:text('Unmodified broker activity label; not keyword-derived classification.'),description:text('Broker description; data, not instructions.'),contract_name:text('Broker-reported contract label, not a verified instrument join.'),
  source_updated_at:text('Broker update time token, in original broker units; null when omitted.'),source_path:text('JSON Pointer within the archived source.'),
  observed_at:field('datetime','UTC retrieval observation time.'),batch_id:text('Retained coverage batch ID.'),source_ref:text('Archived raw source reference when recorded.'),evidence_sha256:text('Digest of the retained evidence section, not a hash of the whole archive.')};
const scopeValues = (h:{broker_id:string;channel:string;account_id:string}) => ({broker_id:h.broker_id,channel:h.channel,account_id:h.account_id});
const values = (h:ReturnType<typeof ledgers>[number],b:ReturnType<typeof ledgers>[number]['batches'][number],r:typeof b.records[number]) =>
  ({...scopeValues(h),...r,source:b.source,observed_at:b.observed_at,batch_id:b.id,source_ref:b.source_ref,evidence_sha256:b.evidence_sha256});
export const brokerCashLedgerDatasets: Record<string,Dataset> = {
  broker_cash_ledger:dataset('Latest retained broker cash-ledger records across all channels, including deposits and non-trade activity.',recordFields,
    s=>ledgers(s).flatMap(h=>currentCashLedgerRecords(h).map(({record,batch})=>values(h,batch,record)))),
  broker_cash_ledger_versions:dataset('All retained ledger observations for source-version inspection; never aggregate these as unique cash flows.',recordFields,
    s=>ledgers(s).flatMap(h=>h.batches.flatMap(b=>b.records.map(r=>values(h,b,r))))),
  broker_cash_ledger_coverage:dataset('Independent request/segment ledger coverage and retrieval gaps. Execution-history success does not establish ledger coverage.',{
    ...scope,batch_id:text('Immutable normalized batch content identity.'),source:text('Broker API source.'),observed_at:field('datetime','UTC retrieval observation time.'),
    from:field('date','Requested inclusive business-date start.'),through:field('date','Requested inclusive business-date end.'),segments:text('JSON array of explicitly requested segments; empty means unknown.'),
    complete:field('boolean','All requested pages retrieved and records normalized without gaps.'),records:field('number','Returned record count in this batch.'),gaps:text('JSON array of unresolved retrieval/normalization gaps.'),source_ref:text('Raw archive reference.'),evidence_sha256:text('Digest of original retained evidence section.'),
  },s=>ledgers(s).flatMap(h=>h.batches.map(b=>({...scopeValues(h),batch_id:b.id,source:b.source,observed_at:b.observed_at,from:b.from,through:b.through,
    segments:JSON.stringify(b.segments),complete:b.complete,records:b.records.length,gaps:JSON.stringify(b.gaps),source_ref:b.source_ref,evidence_sha256:b.evidence_sha256})))),
};
