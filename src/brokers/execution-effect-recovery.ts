import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { InvestorState } from '../state/portfolio-state.js';
import { parseCsvLine } from './csv-tables.js';
import { addDecimals, assertOptionExecution, mergeOptionExecutions, negateDecimal, type ExecutionEffectEvidence, type OptionExecution } from './option-executions.js';
import { reconcileExecutionEffects } from './execution-effects.js';
import type { BrokerHistory } from './history.js';
import {scaledHistoryQuantity} from './history-values.js';

export const evidenceHash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const executionScopeKey = (e: Pick<OptionExecution,'channel'|'account_id'|'execution_id'>) => JSON.stringify([e.channel,e.account_id,e.execution_id]);
export interface EffectRecovery {
  channel: string; account_id: string; execution_id: string;
  effect: 'open' | 'close' | 'mixed'; evidence: ExecutionEffectEvidence[];
}
export interface StatementSource { file_id: string; bytes: Buffer; }
const normalized = (value: string) => addDecimals(value,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1').replace(/^-0$/,'0');
const numberCell = (value: string | undefined) => {
  if (value === undefined) throw Error('Statement amount missing');
  return normalized(value.replaceAll(',',''));
};
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const matchKey = (e: Pick<OptionExecution,'underlying'|'right'|'expiry'|'strike'|'executed_at'|'side'|'contracts'|'currency'|'gross_premium'>) =>
  JSON.stringify([e.underlying,e.right,e.expiry,normalized(e.strike),e.executed_at.slice(0,10),e.side,normalized(e.contracts),e.currency,normalized(e.gross_premium)]);

/** Enrich manual rows only when every matching broker record reports the same
 * effect and there are enough distinct statement transactions for those rows.
 * Fees and timestamps remain the original worksheet values, even when different.
 */
export function recoverStatementEffects(state: InvestorState, sources: StatementSource[], scope: {channel:string;account_id:string}) {
  type Candidate = { effect:EffectRecovery['effect']; evidence:ExecutionEffectEvidence; fee:string | null; };
  const candidates = new Map<string, Map<string,Candidate>>();
  for (const source of sources) {
    const lines = source.bytes.toString('utf8').split(/\r?\n/).map(parseCsvLine);
    const accounts = lines.filter(r => r[0] === 'Account Information' && r[1] === 'Data' && r[2] === 'Account').map(r => r[3]);
    if (accounts.length !== 1 || accounts[0] !== scope.account_id) throw Error('Statement account differs from recovery scope');
    const sha = evidenceHash(source.bytes);
    let header: string[] = [];
    for (const [index,line] of lines.entries()) {
      if (line[0] !== 'Trades') continue;
      if (line[1] === 'Header') { header = line; continue; }
      if (line[1] !== 'Data' || !header.length) continue;
      const r = Object.fromEntries(header.map((key,i) => [key,line[i]]));
      if (!/option/i.test(r['Asset Category'] ?? '')) continue;
      // Lot/tax details are not independent transactions.
      if (r.DataDiscriminator !== 'Order' && r.DataDiscriminator !== 'Trade') continue;
      const terms = r.Symbol?.match(/^(.+) (\d{2})([A-Za-z]{3})(\d{2}) (\d+(?:\.\d+)?) ([CP])$/);
      if (!terms) continue;
      const month = months.indexOf(terms[3].toUpperCase())+1;
      const expiry = `20${terms[4]}-${String(month).padStart(2,'0')}-${terms[2]}`;
      const codes = new Set((r.Code ?? '').split(';').map(c => c.trim()));
      // Delivery/expiration rows require lifecycle handling, not a synthetic fill.
      if (['A','Ep','Ex'].some(c => codes.has(c)) || !codes.has('O') && !codes.has('C')) continue;
      const qty = numberCell(r.Quantity);
      const parsed = {underlying:terms[1],right:terms[6] === 'P' ? 'put' as const : 'call' as const,expiry,
        strike:terms[5],executed_at:r['Date/Time'],side:qty.startsWith('-') ? 'sell' as const : 'buy' as const,
        contracts:qty.replace(/^-/,''),currency:r.Currency,gross_premium:numberCell(r.Proceeds)};
      const key = matchKey(parsed);
      if (!candidates.has(key)) candidates.set(key,new Map());
      const effect = codes.has('O') && codes.has('C') ? 'mixed' : codes.has('O') ? 'open' : 'close';
      const fee = r['Comm/Fee'] ?? r['Comm in USD'];
      // Deduplicate the same transaction repeated in overlapping statements.
      // Retain all intraday times and never invent a time for the worksheet row.
      const identity = JSON.stringify([key,r['Date/Time'],r['T. Price'],fee,r.Code]);
      candidates.get(key)!.set(identity,{effect,fee:fee === undefined ? null : numberCell(fee),evidence:{
        kind:'broker_statement',source_sha256:sha,source_file_id:source.file_id,
        reference:`Trades CSV row ${index+1}; Code ${r.Code}; broker time ${r['Date/Time']}`,
      }});
    }
  }
  const groups = new Map<string,OptionExecution[]>();
  // Include already-enriched worksheet rows in cardinality checks on reruns.
  for (const e of state.option_executions ?? []) if (e.spreadsheet_source && e.channel === scope.channel && e.account_id === scope.account_id) {
    const key = matchKey(e); groups.set(key,[...(groups.get(key) ?? []),e]);
  }
  const changes: EffectRecovery[] = [], unresolved: Array<{execution_id:string;reason:string}> = [];
  let feeDifferences = 0;
  for (const [key,executions] of groups) {
    const matches = [...(candidates.get(key)?.values() ?? [])], effects = new Set(matches.map(m => m.effect));
    const reason = !matches.length ? 'No exact statement trade match' : matches.length < executions.length
      ? 'Statement transactions cannot cover every matching worksheet row' : effects.size !== 1 ? 'Matching statement trades have different effects' : null;
    for (const e of executions) {
      if (e.effect !== 'unknown') continue;
      if (reason) { unresolved.push({execution_id:e.execution_id,reason}); continue; }
      const effect = matches[0].effect;
      if (matches.every(m => m.fee !== e.commission)) feeDifferences++;
      changes.push({channel:e.channel,account_id:e.account_id,execution_id:e.execution_id,effect,evidence:matches.map(m => m.evidence)});
    }
  }
  return {changes,unresolved,feeDifferences};
}

/** A newly fetched, fully paginated option-history tail can extend the quantity
 * proof without falsely advancing the whole broker's stock/fee sync cursor. */
export function recoverSnapshotEffects(state: InvestorState, history: BrokerHistory, tail: {
  channel:string;account_id:string;from:string;through:string;complete:boolean;
  transactions:Array<{id:unknown;accountId:unknown;secType:unknown;[key:string]:unknown}>;
}, evidence: ExecutionEffectEvidence): EffectRecovery[] {
  if (!tail.complete || tail.channel !== history.channel || tail.account_id !== history.account_id ||
    tail.from !== history.sync.through || Date.parse(tail.through) < Date.parse(tail.from)) throw Error('Invalid option history tail coverage');
  const ids = new Map(history.executions.filter(e => e.instrument === 'option').map(e => [e.id,e]));
  if (tail.transactions.some(e => String(e.accountId) !== history.account_id || e.secType !== 'OPT')) throw Error('Option history tail scope mismatch');
  if (tail.transactions.some(e => !ids.has(String(e.id)))) throw Error('New option transactions require normal history ingestion before recovery');
  for (const raw of tail.transactions) {
    const prior = ids.get(String(raw.id))!;
    if (normalized(scaledHistoryQuantity(raw.filledQuantity,raw.filledQuantityScale ?? 0)) !== normalized(prior.quantity) ||
      raw.action !== prior.side.toUpperCase() || String(raw.orderId) !== prior.order_id) throw Error('Option history tail contradicts retained transaction quantities or direction');
  }
  const projected = reconcileExecutionEffects({...history,sync:{...history.sync,through:tail.through}},state.option_observations ?? [],state.option_events ?? []);
  return projected.executions.flatMap((e,i) => history.executions[i].effect === 'unknown' && e.effect !== 'unknown'
    ? [{channel:e.channel,account_id:e.account_id,execution_id:e.id,effect:e.effect,evidence:[evidence]}] : []);
}

/** Changes only unknown position effects and their independent provenance. */
export function applyEffectRecovery(state: InvestorState, changes: EffectRecovery[]): InvestorState {
  const before = state.option_executions ?? [], byKey = new Map(before.map(e => [executionScopeKey(e),e]));
  const incoming: OptionExecution[] = [];
  for (const change of changes) {
    const prior = byKey.get(executionScopeKey(change));
    if (!prior) throw Error('Effect recovery execution not found');
    if (prior.effect !== 'unknown' && prior.effect !== change.effect) throw Error('Effect recovery contradicts an established position effect');
    incoming.push(assertOptionExecution({...prior,effect:change.effect,effect_evidence:[...(prior.effect_evidence ?? []),...change.evidence]}));
  }
  const merged = mergeOptionExecutions(before,incoming), strip = ({effect,effect_evidence,...rest}:OptionExecution) => rest;
  for (const e of merged) if (!isDeepStrictEqual(strip(e),strip(byKey.get(executionScopeKey(e))!))) throw Error('Effect recovery changed original execution fields');
  const history = structuredClone(state.broker_history);
  for (const h of Object.values(history ?? {})) for (const e of h.executions) {
    const recovered = incoming.find(r => r.channel === e.channel && r.account_id === e.account_id && r.execution_id === e.id);
    if (!recovered) continue;
    if (e.effect !== 'unknown' && e.effect !== recovered.effect) throw Error('Effect recovery contradicts retained broker history');
    e.effect = recovered.effect;
  }
  return {...state,option_executions:merged,...(history ? {broker_history:history} : {})};
}
