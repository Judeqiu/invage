import { decimal, validDate } from './option-executions.js';

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
  source: 'ibkr_flex' | 'tiger_api' | 'moomoo_api' | 'webull_api';
}

export function assertOptionLifecycleEvent(raw: unknown): OptionLifecycleEvent {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Option lifecycle event must be an object');
  const event = raw as OptionLifecycleEvent;
  const required = ['id', 'broker_id', 'channel', 'account_id', 'underlying', 'right', 'strike',
    'expiry', 'multiplier', 'date', 'kind', 'settlement', 'contracts', 'currency', 'source'] as const;
  const allowed = new Set<string>([...required, 'contract_id', 'proceeds', 'fees', 'broker_realized_pl']);
  for (const key of Object.keys(event)) if (!allowed.has(key)) throw new Error(`Unknown option lifecycle event field: ${key}`);
  for (const key of required) if (typeof event[key] !== 'string' || !event[key]) throw new Error(`Option lifecycle event ${key} is required`);
  if (!['put', 'call'].includes(event.right) ||
      !['expiration', 'assignment', 'exercise', 'cash_settlement'].includes(event.kind) ||
      !['cash', 'physical', 'unknown'].includes(event.settlement) ||
      !['ibkr_flex', 'tiger_api', 'moomoo_api', 'webull_api'].includes(event.source)) {
    throw new Error('Invalid option lifecycle event classification');
  }
  const brokerForSource = { ibkr_flex: 'ibkr', tiger_api: 'tiger',
    moomoo_api: 'moomoo', webull_api: 'webull' } as const;
  if (event.broker_id !== brokerForSource[event.source]) {
    throw new Error('Option lifecycle event source disagrees with broker');
  }
  if (!validDate(event.date) || !validDate(event.expiry)) throw new Error('Invalid option lifecycle event date');
  if (!/^[A-Z]{3,4}$/.test(event.currency)) throw new Error('Invalid option lifecycle event currency');
  for (const value of [event.strike, event.multiplier, event.contracts]) {
    decimal(value);
    if (value.startsWith('-') || !/[1-9]/.test(value)) throw new Error('Option lifecycle event contract terms must be positive');
  }
  for (const value of [event.proceeds, event.fees, event.broker_realized_pl]) if (value !== undefined) decimal(value);
  return event;
}

export function mergeOptionLifecycleEvents(existing: unknown, incoming: unknown): OptionLifecycleEvent[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Option lifecycle events must be arrays');
  const byId = new Map<string, OptionLifecycleEvent>();
  for (const raw of [...existing, ...incoming]) {
    const event = assertOptionLifecycleEvent(raw);
    const key = JSON.stringify([event.channel, event.account_id, event.id]);
    const previous = byId.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error(`Option lifecycle event conflict: ${key}`);
    byId.set(key, event);
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
