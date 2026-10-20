import type { InvestorState } from '../state/portfolio-state.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { addDecimals, mergeOptionExecutions, type OptionExecution } from '../brokers/option-executions.js';
import { buildOptionIdentityIndex, executionId, holdingIdentityTerms, optionAccounts, optionId, optionSystemId, type OptionIdentityTerms } from '../brokers/option-identities.js';
import { mergeOptionLifecycleEvents, type OptionLifecycleEvent } from '../brokers/option-events.js';
import { openOptionTradeDetails } from './option-dashboard-data.js';
import { buildOptionEpisodes } from '../brokers/option-history.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import type { OptionRelationship } from '../brokers/option-relationships.js';
import type { BrokerOrderFees } from '../brokers/history.js';

export interface TradeJournalRow {
  id: string; optionId: string; underlying: string; right: 'call' | 'put'; side: 'short' | 'long' | 'unknown';
  strike: string; expiry: string; multiplier: string; currency: string; channel: string; accountId: string;
  entryDate: string | null; entryThrough: string | null; contracts: string;
  premium: string | null; netCash: string | null; returnsPct: number | null;
  status: string; lastTrade: string | null; paidToClose: string | null; realizedPnl: string | null;
  feeBasis: 'net' | 'gross' | 'broker' | 'unknown'; brokerDate: string | null; observedSince: string | null;
  executions: Array<OptionExecution & { id: string; option_id: string }>;
  orderFees: Array<BrokerOrderFees & { orderId: string }>;
  events: OptionLifecycleEvent[]; notes: string[]; rolled: boolean; thesis: string; noteUpdatedAt: string | null;
}
const neg = (v: string) => v.startsWith('-') ? v.slice(1) : `-${v}`;
const zero = (v: string) => !/[1-9]/.test(v);
function base(state: InvestorState, t: OptionIdentityTerms, side: TradeJournalRow['side']): TradeJournalRow {
  const pk = optionId(state, t);
  return { id:`${pk}:${side}`, optionId:pk, underlying:canonicalOptionUnderlying(t.underlying, { ...t, strike:Number(t.strike) }), right:t.right, side,
    strike:t.strike, expiry:t.expiry, multiplier:t.multiplier, currency:t.currency, channel:t.channel, accountId:t.account_id,
    entryDate:null, entryThrough:null, contracts:'0', premium:null, netCash:null, returnsPct:null,
    status:'Open', lastTrade:null, paidToClose:null, realizedPnl:null, feeBasis:'unknown', brokerDate:null, observedSince:null,
    executions:[], orderFees:[], events:[], notes:[], rolled:false, thesis:state.option_journal?.[pk]?.thesis ?? '',
    noteUpdatedAt:state.option_journal?.[pk]?.updated_at ?? null };
}
function attachOrderFees(state: InvestorState, row: TradeJournalRow) {
  const ids = new Set(row.executions.map(e => e.execution_id));
  for (const history of Object.values(state.broker_history ?? {})) {
    if (history.channel !== row.channel || history.account_id !== row.accountId) continue;
    const parents = new Set(history.executions.filter(e => ids.has(e.id)).map(e => e.order_id));
    if (history.broker_id === 'webull') for (const id of ids) if (id.startsWith('order:')) parents.add(id.slice(6));
    row.orderFees = history.orders.filter(o => parents.has(o.id) && o.fees).map(o => ({ ...o.fees!, orderId:o.id }));
  }
}
function returns(row: TradeJournalRow): number | null {
  const denominator = Number(row.strike) * Number(row.contracts) * Number(row.multiplier);
  const pct = row.side === 'short' && row.premium !== null && denominator > 0 ? Number(row.premium) / denominator * 100 : null;
  return pct !== null && Number.isFinite(pct) ? pct : null;
}
export function tradesOpenBook(rawState: InvestorState) {
  // Compatibility projection is read-only, with exactly the same IDs as the backfill.
  const state = { ...rawState, option_identities:buildOptionIdentityIndex(rawState) };
  const portfolio = getPortfolio(state), accounts = optionAccounts(state);
  const details = openOptionTradeDetails(portfolio, state.option_executions, accounts, state.option_events);
  const fills = mergeOptionExecutions([], state.option_executions ?? []);
  const observedDates = new Map<string, { first:string; last:string }>();
  for (const run of state.option_observations ?? []) for (const c of run.options) {
    const pk = optionId(state,{...c,strike:String(c.strike),multiplier:String(c.multiplier),channel:run.channel,account_id:run.account_id});
    const key = `${pk}:${c.side}`, prior = observedDates.get(key);
    observedDates.set(key,{first:prior && prior.first < run.as_of ? prior.first : run.as_of,last:prior && prior.last > run.as_of ? prior.last : run.as_of});
  }
  const rows: TradeJournalRow[] = [];
  for (const [key, h] of Object.entries(portfolio)) {
    if (h.instrument !== 'option' || !h.option) continue;
    const terms = holdingIdentityTerms(state, key, accounts), row = base(state, terms, h.option.side);
    const detail = terms.account_id ? details[key] : undefined;
    row.id = `${row.id}:${key}`;
    row.contracts = String(h.units);
    const observed = observedDates.get(`${row.optionId}:${row.side}`);
    row.observedSince = observed?.first ?? null;
    row.brokerDate = observed?.last ?? null;
    if (detail) {
      row.entryDate = detail.openedFrom; row.entryThrough = detail.openedTo;
      const gross = detail.stoGrossPremium ?? detail.openingGrossPremium;
      row.premium = gross === undefined ? null : String(gross);
      row.netCash = row.side === 'short' && detail.stoNetPremium !== null ? String(detail.stoNetPremium) : null;
      row.executions = fills.filter(e => e.channel === terms.channel && e.account_id === terms.account_id && detail.openingExecutionIds.includes(e.execution_id))
        .map(e => ({ ...e, id:executionId(state, e), option_id:optionId(state, e) }));
      row.feeBasis = row.netCash === null ? 'unknown' : 'net';
      if (row.side === 'long' && row.executions.every(e => e.commission !== null)) {
        // Opening cash is allocated to remaining contracts; do not sum consumed fill quantities.
        row.notes.push('Net opening cash for long options is not available on the reconciled remaining-lot basis.');
      }
    } else row.notes.push('Opening fills do not fully reconcile to this holding. Entry date and opening cash are unavailable.');
    if (row.entryDate && row.entryDate !== row.entryThrough) row.notes.push('Entry date spans multiple opening fills; the earliest confirmed date is shown.');
    if (!terms.currency) row.notes.push('Native currency is unknown; money totals exclude this row.');
    row.returnsPct = returns(row);
    attachOrderFees(state, row);
    rows.push(row);
  }
  return { rows:rows.sort((a,b) => (b.entryDate ?? '').localeCompare(a.entryDate ?? '') || a.id.localeCompare(b.id)),
    identityVersion:1, identityMigrated:rawState.option_identities?.version === 1 };
}

/** Flat-to-flat execution cycles, independent of current snapshots. No expiry/assignment inference. */
export function tradesHistory(rawState: InvestorState, relationships: OptionRelationship[] = []) {
  const state = { ...rawState, option_identities:buildOptionIdentityIndex(rawState) };
  const fills = mergeOptionExecutions([], state.option_executions ?? []);
  const events = mergeOptionLifecycleEvents([], state.option_events ?? []);
  type Cycle = { row:TradeJournalRow; balance:string; complete:boolean; gross:string; fees:string | null; opened:string; closedCash:string; kinds:Set<string> };
  const active = new Map<string, Cycle>(), cycles:Cycle[] = [];
  const actionTimes = new Map<string, Set<string>>(), fillDays = new Set<string>();
  for (const fill of fills) {
    const side = (fill.effect === 'open' ? fill.side === 'sell' : fill.side === 'buy') ? 'short' : 'long';
    const pk = optionId(state,fill), key = JSON.stringify([pk,side,fill.executed_at]);
    fillDays.add(JSON.stringify([pk,fill.executed_at.slice(0,10)]));
    if (!actionTimes.has(key)) actionTimes.set(key,new Set());
    actionTimes.get(key)!.add(fill.effect);
  }
  const timeline = [...fills.map(fill => ({ at:fill.executed_at, fill, event:null })),
    ...events.map(event => ({ at:`${event.date}T23:59:59`, fill:null, event }))]
    .sort((a,b) => a.at.localeCompare(b.at) || (a.fill?.execution_id ?? a.event!.id).localeCompare(b.fill?.execution_id ?? b.event!.id));
  for (const item of timeline) {
    const e = item.fill, event = item.event, t = e ?? event!, option = optionId(state, t);
    const side = e ? (e.effect === 'open' ? e.side === 'sell' : e.side === 'buy') ? 'short' : 'long'
      : event!.kind === 'assignment' ? 'short' : event!.kind === 'exercise' ? 'long' : null;
    const candidates = side ? [`${option}:${side}`] : ['short','long'].map(s => `${option}:${s}`).filter(k => active.has(k));
    let key = candidates.length === 1 ? candidates[0] : `${option}:unknown:${event!.id}`;
    const sameDayFills = event && fillDays.has(JSON.stringify([option,event.date]));
    if (sameDayFills) {
      const ambiguous = active.get(key);
      if (ambiguous) {
        ambiguous.complete = false;
        ambiguous.row.notes.push('A date-only lifecycle event overlaps same-day fills; intraday ordering is unavailable.');
      }
      key = `${option}:dated-event:${event!.id}`;
    }
    if (!side && candidates.length !== 1) for (const candidate of candidates) {
      const ambiguous = active.get(candidate)!;
      ambiguous.complete = false;
      ambiguous.row.notes.push('A lifecycle event has ambiguous position side. Subsequent realized profit is withheld.');
    }
    let cycle = active.get(key);
    if (!cycle) {
      const row = base(state, t, side ?? 'unknown');
      row.id = optionSystemId(state.user.id, 'cycle', e ? executionId(state,e) : JSON.stringify([event!.channel,event!.account_id,event!.id]));
      cycle = { row, balance:'0', complete:!!e && e.effect === 'open', gross:'0', fees:'0', opened:'0', closedCash:'0', kinds:new Set() };
      active.set(key, cycle); cycles.push(cycle);
    }
    const row = cycle.row, opening = e?.effect === 'open';
    if (e && actionTimes.get(JSON.stringify([option,side,e.executed_at]))!.size > 1) {
      cycle.complete = false;
      if (!row.notes.includes('Opening and closing fills share a timestamp; their order cannot be verified.')) row.notes.push('Opening and closing fills share a timestamp; their order cannot be verified.');
    }
    row.lastTrade = item.at.slice(0,10);
    if (e) row.executions.push({ ...e, id:executionId(state,e), option_id:option });
    if (e && row.executions.some(prior => prior.contract_id !== e.contract_id)) {
      cycle.complete = false;
      row.notes.push('Different broker contract IDs share these economic terms; realized profit requires reconciliation.');
    }
    if (event) { row.events.push(event); cycle.kinds.add(event.kind); }
    if (opening) {
      row.entryDate ??= e!.executed_at.slice(0,10); row.entryThrough = e!.executed_at.slice(0,10);
      cycle.opened = addDecimals(cycle.opened, t.contracts);
      row.premium = addDecimals(row.premium ?? '0', e!.gross_premium);
    } else if (e) cycle.closedCash = addDecimals(cycle.closedCash, e.gross_premium);
    cycle.balance = addDecimals(cycle.balance, opening ? t.contracts : neg(t.contracts));
    if (cycle.balance.startsWith('-')) cycle.complete = false;
    cycle.gross = addDecimals(cycle.gross, e?.gross_premium ?? event?.proceeds ?? '0');
    const fee = e ? e.commission : event!.fees;
    cycle.fees = cycle.fees === null || fee == null ? null : addDecimals(cycle.fees, fee);
    row.contracts = zero(cycle.opened) ? t.contracts : cycle.opened;
    row.netCash = row.premium !== null && row.executions.filter(f => f.effect === 'open').every(f => f.commission !== null)
      ? addDecimals('0', ...row.executions.filter(f => f.effect === 'open').map(f => addDecimals(f.gross_premium, f.commission!))) : null;
    row.paidToClose = row.side === 'short' && row.premium !== null ? neg(cycle.closedCash) : null;
    row.returnsPct = returns(row);
    if (zero(cycle.balance) || cycle.balance.startsWith('-')) {
      active.delete(key);
      const physical = row.events.some(v => v.kind === 'assignment' || v.kind === 'exercise');
      const missingSettlement = row.events.some(v => v.kind === 'cash_settlement' && v.proceeds === undefined);
      row.status = cycle.kinds.size > 1 ? 'Mixed outcomes' :
        cycle.kinds.has('assignment') ? 'Assigned' : cycle.kinds.has('exercise') ? 'Exercised' :
        cycle.kinds.has('expiration') ? 'Expired' : cycle.kinds.has('cash_settlement') ? 'Cash settled' : !cycle.complete ? 'Incomplete history' : 'Closed';
      const brokerReported = !sameDayFills && !row.executions.some(e => e.effect === 'close') && row.events.length > 0 &&
        row.events.every(e => e.broker_realized_pl !== undefined);
      if (brokerReported) {
        row.realizedPnl = addDecimals(...row.events.map(e => e.broker_realized_pl!));
        row.feeBasis = 'broker';
        row.notes.push('Option P&L is reported by the broker for these lifecycle events; no fee basis or stock profit is inferred.');
      } else if (cycle.complete && !physical && !missingSettlement) {
        row.realizedPnl = cycle.fees === null ? cycle.gross : addDecimals(cycle.gross,cycle.fees);
        row.feeBasis = cycle.fees === null ? 'gross' : 'net';
      } else {
        row.notes.push(physical ? 'Physical delivery may transfer premium into stock basis. Option profit is not inferred.' : 'Complete matching opening and closing evidence is unavailable.');
      }
    } else row.status = 'Open in recorded fills';
  }
  // Incomplete history never becomes closed merely because the calendar passed expiry.
  const accounts = optionAccounts(state), liveOptions = new Set(Object.entries(getPortfolio(state)).flatMap(([key,h]) =>
    h.instrument === 'option' && h.option ? [`${optionId(state,holdingIdentityTerms(state,key,accounts))}:${h.option.side}`] : []));
  for (const { row } of active.values()) {
    row.notes.push('Recorded fills are not flat. Current holdings can differ when history is incomplete.');
    if (!liveOptions.has(`${row.optionId}:${row.side}`)) row.status = 'Unverified';
  }
  const rows = cycles.map(c => c.row);
  for (const row of rows) {
    const closes = row.executions.filter(e => e.effect === 'close');
    row.rolled = row.status === 'Closed' && closes.length > 0 && closes.every(e => relationships.some(r =>
      r.channel === row.channel && r.account_id === row.accountId && ['order','execution'].includes(r.evidence) &&
      r.side === row.side && r.closing_fills.includes(e.execution_id)));
    if (row.rolled) row.notes.push('Closing fills are linked to replacement openings by verified broker order or execution evidence.');
  }
  for (const episode of buildOptionEpisodes(state)) {
    const c = episode.contract, t = { ...c, strike:String(c.strike), multiplier:String(c.multiplier), channel:episode.channel, account_id:episode.account_id };
    const pk = optionId(state,t);
    if (rows.some(r => r.optionId === pk && r.side === c.side &&
      (r.entryDate ?? r.lastTrade ?? '') <= (episode.first_seen_absent ?? episode.last_seen_open) &&
      (r.lastTrade ?? '') >= episode.first_seen)) continue;
    const row = base(state,t,c.side);
    row.id = optionSystemId(state.user.id,'cycle',episode.id);
    row.observedSince = episode.first_seen; row.brokerDate = episode.last_seen_open;
    row.lastTrade = null; row.contracts = String(c.units);
    row.status = ({ no_longer_observed:'No longer observed', unverified:'Unverified', open:'Observed open',
      assigned:'Assigned', expired:'Expired', exercised:'Exercised', cash_settled:'Cash settled',
      closed_by_fills:'Closed', conflicting_evidence:'Conflicting evidence' } as Record<string,string>)[episode.status] ?? 'Review required';
    row.events = episode.events;
    row.notes.push('Snapshot evidence only. First seen is not the entry date; disappearance does not prove a close or assignment.');
    rows.push(row);
  }
  for (const row of rows) attachOrderFees(state, row);
  return { rows:rows.sort((a,b) => (b.lastTrade ?? b.brokerDate ?? '').localeCompare(a.lastTrade ?? a.brokerDate ?? '') || a.id.localeCompare(b.id)),
    available:state.option_executions !== undefined || events.length > 0 };
}
