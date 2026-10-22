import { addDecimals, decimal, validDate, mergeOptionExecutions, type OptionExecution } from './option-executions.js';

export interface BrokerHistoryScope { broker_id: string; channel: string; account_id: string; }
export interface BrokerHistoryExecution extends BrokerHistoryScope {
  id: string; order_id: string | null; native_symbol: string; symbol: string | null;
  instrument: 'security' | 'option'; side: 'buy' | 'sell'; effect: 'open' | 'close' | 'mixed' | 'unknown';
  executed_at: string; clock: string; currency: string | null;
  quantity: string; price: string | null; multiplier: string | null; gross_cash: string | null; fee_cash: string | null;
  option: { right: 'call' | 'put'; expiry: string; strike: string } | null;
}
export interface BrokerHistoryOrderLeg {
  native_symbol: string; side: 'buy' | 'sell'; effect: 'open' | 'close' | 'mixed' | 'unknown';
  ratio: string; multiplier: string | null;
}
/** Broker-reported order charges, never additional execution cash flows. */
export interface BrokerOrderFees {
  currency: string | null; total: string; items: Array<{ type: string; amount: string }>;
}
export interface BrokerHistoryOrder extends BrokerHistoryScope {
  id: string; native_symbol: string; side: 'buy' | 'sell' | 'unknown'; status: string;
  created_at: string; updated_at: string; clock: string; currency: string | null;
  quantity: string | null; limit_price: string | null; filled_quantity: string | null; filled_price: string | null;
  order_type: string; time_in_force: string | null; session: string | null; legs: BrokerHistoryOrderLeg[];
  fees?: BrokerOrderFees;
}
export interface BrokerHistoryGap {
  kind: 'metadata' | 'orders' | 'coverage'; reference: string | null; reason: string;
}
export interface BrokerHistorySyncPlan { mode: 'full' | 'incremental'; from: string; through: string; }
export interface BrokerHistorySync extends BrokerHistorySyncPlan {
  historical_imported?: boolean;
  version: 1; status: 'complete' | 'partial'; full_history_synced: boolean;
  fees: 'available' | 'partial' | 'unavailable'; gaps: BrokerHistoryGap[];
}
/** All returned executions and orders survive independently of today's portfolio. */
export interface BrokerHistory extends BrokerHistoryScope {
  executions: BrokerHistoryExecution[]; orders: BrokerHistoryOrder[]; sync: BrokerHistorySync;
}

function obj(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid broker history object');
  return raw as Record<string, any>;
}
function keys(o: Record<string, any>, allowed: string[]) {
  if (Object.keys(o).some(k => !allowed.includes(k))) throw new Error('Unknown broker history field');
}
function text(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Broker history text is required');
  return raw;
}
function nullableText(raw: unknown): string | null { return raw === null ? null : text(raw); }
function amount(raw: unknown, positive = false): string {
  const value = decimal(raw);
  if (positive && (value.startsWith('-') || !/[1-9]/.test(value))) throw new Error('Broker history quantity/multiplier must be positive');
  return value;
}
function nullableAmount(raw: unknown, positive = false): string | null { return raw === null ? null : amount(raw, positive); }
function nonnegative(raw: unknown): string {
  const value = amount(raw); if (value.startsWith('-')) throw new Error('Broker history price/quantity cannot be negative'); return value;
}
function choice<T extends string>(raw: unknown, allowed: T[]): T {
  if (!allowed.includes(raw as T)) throw new Error('Invalid broker history classification');
  return raw as T;
}
function stamp(raw: unknown): string {
  const value = text(raw);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid broker history timestamp');
  return value;
}
function scope(raw: Record<string, any>): BrokerHistoryScope {
  return { broker_id: text(raw.broker_id), channel: text(raw.channel), account_id: text(raw.account_id) };
}
function currency(raw: unknown): string | null {
  if (raw === null) return null;
  const value = text(raw); if (!/^[A-Z]{3,4}$/.test(value)) throw new Error('Invalid broker history currency'); return value;
}
function economicEqual(a: string | null, b: string | null) {
  return a === null || b === null || /^0(?:\.0+)?$/.test(addDecimals(a, b.startsWith('-') ? b.slice(1) : `-${b}`));
}

export function assertHistoryExecution(raw: unknown): BrokerHistoryExecution {
  const o = obj(raw);
  keys(o, ['broker_id','channel','account_id','id','order_id','native_symbol','symbol','instrument','side','effect','executed_at','clock','currency','quantity','price','multiplier','gross_cash','fee_cash','option']);
  const instrument = choice(o.instrument, ['security', 'option']);
  let option: BrokerHistoryExecution['option'] = null;
  if (o.option !== null) {
    const c = obj(o.option); keys(c, ['right','expiry','strike']);
    if (!validDate(c.expiry)) throw new Error('Invalid broker history option expiry');
    option = { right: choice(c.right, ['call','put']), expiry: c.expiry, strike: amount(c.strike, true) };
  }
  if ((instrument === 'option') !== (option !== null)) throw new Error('Broker history option terms required only for options');
  const row: BrokerHistoryExecution = { ...scope(o), id: text(o.id), order_id: nullableText(o.order_id), native_symbol: text(o.native_symbol), symbol: nullableText(o.symbol),
    instrument, side: choice(o.side, ['buy','sell']), effect: choice(o.effect, ['open','close','mixed','unknown']), executed_at: stamp(o.executed_at), clock: text(o.clock),
    currency: currency(o.currency), quantity: amount(o.quantity, true), price: o.price === null ? null : nonnegative(o.price), multiplier: nullableAmount(o.multiplier, true),
    gross_cash: nullableAmount(o.gross_cash), fee_cash: nullableAmount(o.fee_cash), option };
  if (row.gross_cash !== null && (!row.currency || !row.multiplier)) throw new Error('Broker history cash requires verified currency and multiplier');
  if (row.gross_cash !== null && /[1-9]/.test(row.gross_cash) && row.gross_cash.startsWith('-') !== (row.side === 'buy')) throw new Error('Broker history cash sign disagrees with side');
  return row;
}
export function assertHistoryOrder(raw: unknown): BrokerHistoryOrder {
  const o = obj(raw);
  keys(o, ['broker_id','channel','account_id','id','native_symbol','side','status','created_at','updated_at','clock','currency','quantity','limit_price','filled_quantity','filled_price','order_type','time_in_force','session','legs','fees']);
  let fees: BrokerOrderFees | undefined;
  if (o.fees !== undefined) {
    const f = obj(o.fees); keys(f, ['currency','total','items']);
    const denomination = currency(f.currency);
    if (!Array.isArray(f.items)) throw new Error('Invalid broker order fees');
    fees = { currency:denomination, total:nonnegative(f.total), items:f.items.map((raw: unknown) => {
      const item = obj(raw); keys(item, ['type','amount']);
      return { type:text(item.type), amount:amount(item.amount) };
    }) };
  }
  if (!Array.isArray(o.legs)) throw new Error('Broker history order legs must be an array');
  const legs = o.legs.map((raw: unknown) => {
    const l = obj(raw); keys(l, ['native_symbol','side','effect','ratio','multiplier']);
    return { native_symbol: text(l.native_symbol), side: choice(l.side, ['buy','sell']), effect: choice(l.effect, ['open','close','mixed','unknown']), ratio: amount(l.ratio, true), multiplier: nullableAmount(l.multiplier, true) };
  });
  return { ...scope(o), id: text(o.id), native_symbol: text(o.native_symbol), side: choice(o.side, ['buy','sell','unknown']), status: text(o.status),
    created_at: stamp(o.created_at), updated_at: stamp(o.updated_at), clock: text(o.clock), currency: currency(o.currency),
    quantity: o.quantity === null ? null : nonnegative(o.quantity), limit_price: nullableAmount(o.limit_price), filled_quantity: o.filled_quantity === null ? null : nonnegative(o.filled_quantity),
    filled_price: nullableAmount(o.filled_price), order_type: text(o.order_type), time_in_force: nullableText(o.time_in_force), session: nullableText(o.session), legs, ...(fees ? { fees } : {}) };
}
export function assertBrokerHistory(raw: unknown): BrokerHistory {
  const o = obj(raw); keys(o, ['broker_id','channel','account_id','executions','orders','sync']);
  if (!Array.isArray(o.executions) || !Array.isArray(o.orders)) throw new Error('Broker history requires execution/order arrays');
  const bound = scope(o), s = obj(o.sync);
  keys(s, ['historical_imported','version','mode','from','through','status','full_history_synced','fees','gaps']);
  if (s.version !== 1 || typeof s.full_history_synced !== 'boolean' || !Array.isArray(s.gaps)) throw new Error('Invalid broker history sync state');
  if (s.historical_imported !== undefined && typeof s.historical_imported !== 'boolean') throw new Error('Invalid historical import marker');
  const sync: BrokerHistorySync = { ...(s.historical_imported !== undefined ? { historical_imported:s.historical_imported } : {}), version: 1, mode: choice(s.mode, ['full','incremental']), from: stamp(s.from), through: stamp(s.through),
    status: choice(s.status, ['complete','partial']), full_history_synced: s.full_history_synced, fees: choice(s.fees, ['available','partial','unavailable']),
    gaps: s.gaps.map((raw: unknown) => { const g = obj(raw); keys(g, ['kind','reference','reason']); return { kind: choice(g.kind, ['metadata','orders','coverage']), reference: nullableText(g.reference), reason: text(g.reason) }; }) };
  if (Date.parse(sync.from) > Date.parse(sync.through) || sync.status === 'complete' && sync.gaps.length) throw new Error('Invalid broker history coverage');
  const executions = o.executions.map(assertHistoryExecution), orders = o.orders.map(assertHistoryOrder);
  for (const r of [...executions, ...orders]) if (r.broker_id !== bound.broker_id || r.channel !== bound.channel || r.account_id !== bound.account_id) throw new Error('Broker history account/channel mismatch');
  return { ...bound, executions, orders, sync };
}

/** Latest sync never triggers a backfill. Only an explicit Full sync requests all history. */
export function planBrokerHistorySync(previous: BrokerHistory | undefined, accountId: string, now = new Date(), full = false): BrokerHistorySyncPlan {
  const through = now.toISOString();
  if (full) return { mode:'full',from:'2000-01-01T00:00:00.000Z',through };
  if (!previous || previous.account_id !== accountId) return { mode:'incremental',from:new Date(now.getTime()-2*86400000).toISOString(),through };
  assertBrokerHistory(previous);
  if (Date.parse(previous.sync.through) > now.getTime()) throw new Error('Broker history checkpoint is in the future');
  return { mode: 'incremental', from: new Date(Math.max(Date.parse(previous.sync.from), Date.parse(previous.sync.through) - 2 * 86400000)).toISOString(), through };
}

export function mergeBrokerHistory(previous: BrokerHistory | undefined, incoming: BrokerHistory): BrokerHistory {
  const next = assertBrokerHistory(incoming);
  const old = previous ? assertBrokerHistory(previous) : undefined;
  if (old && (old.account_id !== next.account_id || old.channel !== next.channel || old.broker_id !== next.broker_id)) throw new Error('Broker history cannot change account binding');
  if (old && Date.parse(next.sync.through) < Date.parse(old.sync.through)) throw new Error('Broker history checkpoint cannot move backwards');
  const executions = new Map<string, BrokerHistoryExecution>();
  for (const row of [...(old?.executions ?? []), ...next.executions]) {
    const prior = executions.get(row.id);
    if (!prior) { executions.set(row.id, row); continue; }
    const canonical = (v:string) => addDecimals(v,'0').replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
    const core = (r: BrokerHistoryExecution) => ({ ...r, quantity:canonical(r.quantity),price:null, option:r.option ? { ...r.option,strike:canonical(r.option.strike) } : null, symbol: null, multiplier: null, gross_cash: null, fee_cash: null });
    if (JSON.stringify(core(prior)) !== JSON.stringify(core(row)) || !economicEqual(prior.price, row.price) || !economicEqual(prior.multiplier, row.multiplier) ||
      !economicEqual(prior.gross_cash, row.gross_cash) || !economicEqual(prior.fee_cash, row.fee_cash) || prior.symbol && row.symbol && prior.symbol !== row.symbol) throw new Error(`Conflicting broker history execution ${row.id}`);
    executions.set(row.id, { ...row, price: row.price ?? prior.price, symbol: row.symbol ?? prior.symbol, multiplier: row.multiplier ?? prior.multiplier, gross_cash: row.gross_cash ?? prior.gross_cash, fee_cash: row.fee_cash ?? prior.fee_cash });
  }
  const orders = new Map<string, BrokerHistoryOrder>();
  for (const row of [...(old?.orders ?? []), ...next.orders]) {
    const prior = orders.get(row.id);
    if (prior && (prior.native_symbol !== row.native_symbol || prior.side !== row.side)) throw new Error(`Conflicting broker history order ${row.id}`);
    const fees = row.fees ?? prior?.fees;
    if (!prior || row.updated_at >= prior.updated_at) orders.set(row.id, { ...row, legs: row.legs.length ? row.legs : prior?.legs ?? [], ...(fees ? { fees } : {}) });
    else if (fees) orders.set(row.id, { ...prior, fees });
  }
  const retainedGaps = next.sync.mode === 'incremental' ? [...(old?.sync.gaps ?? []), ...next.sync.gaps] : next.sync.gaps;
  const gaps = retainedGaps.filter((g,i,all) => all.findIndex(other => other.kind === g.kind && other.reference === g.reference && other.reason === g.reason) === i).filter(g => g.kind !== 'metadata' || !g.reference ||
    !([...executions.values()].some(r => r.native_symbol === g.reference) &&
      [...executions.values()].filter(r => r.native_symbol === g.reference).every(r => r.multiplier !== null && r.symbol !== null)))
    .filter(g => !(g.kind === 'coverage' && g.reason.startsWith('Order fees unavailable or invalid;') && g.reference && orders.get(g.reference)?.fees));
  const status = gaps.length ? 'partial' : next.sync.status === 'partial' && next.sync.gaps.length ? 'complete' : next.sync.status;
  const full = next.sync.mode === 'full' ? status === 'complete' : old?.sync.full_history_synced === true;
  return { ...next, executions: [...executions.values()].sort((a,b) => a.executed_at.localeCompare(b.executed_at) || a.id.localeCompare(b.id)),
    orders: [...orders.values()].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
    sync: { ...next.sync, ...(['moomoo','futubull','tiger','webull'].includes(next.broker_id) ? { fees: executions.size && [...executions.values()].every(e => e.fee_cash !== null)
      ? 'available' as const : [...executions.values()].some(e => e.fee_cash !== null) || [...orders.values()].some(o => o.fees) ? 'partial' as const : 'unavailable' as const } : {}),
      historical_imported: old?.sync.historical_imported === true || next.sync.historical_imported === true || old?.sync.full_history_synced === true, status, gaps, from: old && old.sync.from < next.sync.from ? old.sync.from : next.sync.from, full_history_synced: full } };
}

/** Existing option consumers share one projection; known proceeds do not require a unit price. */
export function optionExecutionsFromHistory(history: BrokerHistory): OptionExecution[] {
  return mergeOptionExecutions([], history.executions.filter(r => r.instrument === 'option' && r.option && r.symbol && r.currency &&
    r.multiplier && r.gross_cash !== null).map(r => ({ channel: r.channel, account_id: r.account_id, execution_id: r.id,
    contract_id: r.native_symbol, executed_at: r.executed_at, underlying: r.symbol!, right: r.option!.right, expiry: r.option!.expiry,
    strike: r.option!.strike, multiplier: r.multiplier!, contracts: r.quantity, side: r.side, effect: r.effect,
    currency: r.currency!, gross_premium: r.gross_cash!, commission: r.fee_cash })));
}

/** Verified exact-contract metadata can enrich older retained evidence without inventing sizes. */
export function verifiedHistoryMultipliers(history: BrokerHistory): Map<string,string> {
  const result = new Map<string,string>();
  for (const row of assertBrokerHistory(history).executions) {
    if (row.instrument !== 'option' || row.multiplier === null) continue;
    const prior = result.get(row.native_symbol);
    if (prior && !economicEqual(prior,row.multiplier)) throw new Error('Conflicting historical contract multipliers');
    result.set(row.native_symbol,row.multiplier);
  }
  return result;
}
