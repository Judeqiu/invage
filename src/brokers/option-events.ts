import { decimal, validDate } from './option-executions.js';
import { canonicalOptionUnderlying } from './option-symbol.js';

/** An explicit broker lifecycle record. Position disappearance is never an event. */
export interface OptionLifecycleEvent {
  id: string;
  broker_id: string;
  channel: string;
  account_id: string;
  contract_id?: string;
  underlying: string;
  right: 'put' | 'call';
  strike: string;
  expiry: string;
  multiplier: string;
  /** Broker event date, not the date the event was imported. */
  date: string;
  kind: 'expiration' | 'assignment' | 'exercise' | 'cash_settlement';
  settlement: 'cash' | 'physical' | 'unknown';
  /** Positive option contract count affected by this event. */
  contracts: string;
  currency: string;
  proceeds?: string;
  fees?: string;
  /** Broker-reported option P&L. This can be zero/absent for physical delivery. */
  broker_realized_pl?: string;
  source: 'ibkr_flex' | 'tiger_api' | 'moomoo_api' | 'webull_api' | 'broker_statement';
  source_ref?: string;
  /** Explicit links prevent counting broker zero-price lifecycle fills twice. */
  replaces_execution_ids?: string[];
}

export function assertOptionLifecycleEvent(raw: unknown): OptionLifecycleEvent {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Option lifecycle event must be an object');
  const event = raw as OptionLifecycleEvent;
  const required = ['id', 'broker_id', 'channel', 'account_id', 'underlying', 'right', 'strike',
    'expiry', 'multiplier', 'date', 'kind', 'settlement', 'contracts', 'currency', 'source'] as const;
  const allowed = new Set<string>([...required, 'contract_id', 'proceeds', 'fees', 'broker_realized_pl', 'source_ref', 'replaces_execution_ids']);
  for (const key of Object.keys(event)) if (!allowed.has(key)) throw new Error(`Unknown option lifecycle event field: ${key}`);
  for (const key of required) if (typeof event[key] !== 'string' || !event[key]) throw new Error(`Option lifecycle event ${key} is required`);
  if (!['put', 'call'].includes(event.right) ||
      !['expiration', 'assignment', 'exercise', 'cash_settlement'].includes(event.kind) ||
      !['cash', 'physical', 'unknown'].includes(event.settlement) ||
      !['ibkr_flex', 'tiger_api', 'moomoo_api', 'webull_api', 'broker_statement'].includes(event.source)) {
    throw new Error('Invalid option lifecycle event classification');
  }
  const brokerForSource = { ibkr_flex: 'ibkr', tiger_api: 'tiger',
    moomoo_api: 'moomoo', webull_api: 'webull' } as const;
  if (event.source === 'broker_statement' && (!event.source_ref || !/^[a-f0-9]{64}$/.test(event.source_ref) || !Array.isArray(event.replaces_execution_ids) || event.replaces_execution_ids.some(id => typeof id !== 'string' || !id))) throw new Error('Statement event source and execution links are required');
  if (event.source !== 'broker_statement' && event.broker_id !== brokerForSource[event.source]) {
    throw new Error('Option lifecycle event source disagrees with broker');
  }
  if (!validDate(event.date) || !validDate(event.expiry)) throw new Error('Invalid option lifecycle event date');
  if (!/^[A-Z]{3,4}$/.test(event.currency)) throw new Error('Invalid option lifecycle event currency');
  for (const value of [event.strike, event.multiplier, event.contracts]) {
    decimal(value);
    if (value.startsWith('-') || !/[1-9]/.test(value)) throw new Error('Option lifecycle event contract terms must be positive');
  }
  for (const value of [event.proceeds, event.fees, event.broker_realized_pl]) if (value !== undefined) decimal(value);
  // PostgreSQL jsonb does not preserve insertion order. Normalize every read
  // and import before comparing overlapping broker events.
  const underlying = canonicalOptionUnderlying(event.underlying, { ...event, strike: Number(event.strike) });
  return Object.fromEntries([...allowed].filter(key => event[key as keyof OptionLifecycleEvent] !== undefined)
    .map(key => [key, key === 'underlying' ? underlying : event[key as keyof OptionLifecycleEvent]])) as unknown as OptionLifecycleEvent;
}

export function mergeOptionLifecycleEvents(existing: unknown, incoming: unknown): OptionLifecycleEvent[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Option lifecycle events must be arrays');
  const byId = new Map<string, OptionLifecycleEvent>();
  for (const raw of [...existing, ...incoming]) {
    const event = assertOptionLifecycleEvent(raw);
    const key = JSON.stringify([event.channel, event.account_id, event.id]);
    const previous = byId.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      const fields = [...new Set([...Object.keys(previous), ...Object.keys(event)])]
        .filter(field => previous[field as keyof OptionLifecycleEvent] !== event[field as keyof OptionLifecycleEvent]);
      throw new Error(`Option lifecycle event conflict: ${key}; differing fields: ${fields.join(', ')}`);
    }
    byId.set(key, event);
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Explicit lifecycle evidence supersedes only its linked zero-price projection fills. Raw records survive. */
export function withoutLifecycleReplacements<T extends { channel:string; account_id:string; execution_id:string }>(fills:T[], events:OptionLifecycleEvent[]):T[] {
  const ids=new Set(events.flatMap(e=>(e.replaces_execution_ids??[]).map(id=>JSON.stringify([e.channel,e.account_id,id]))));
  return fills.filter(e=>!ids.has(JSON.stringify([e.channel,e.account_id,e.execution_id])));
}
