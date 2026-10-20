import { createHash } from 'node:crypto';
import type { InvestorState } from '../state/portfolio-state.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { readBrokerAccountModel } from './accounts.js';
import { canonicalOptionUnderlying } from './option-symbol.js';
import { addDecimals, decimal, mergeOptionExecutions, type OptionExecution } from './option-executions.js';

/** Additive identity index. Broker evidence and books remain unchanged. Keys are versioned. */
export interface OptionIdentityIndex {
  version: 1;
  options: Record<string, string>;
  executions: Record<string, { id: string; option_id: string }>;
}
export interface OptionIdentityTerms {
  channel: string; account_id: string; underlying: string; right: 'call' | 'put';
  strike: string; expiry: string; multiplier: string; currency: string;
}
export function normalizedDecimal(value: string): string {
  decimal(value);
  const n = addDecimals(value, '0').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return /^-?0$/.test(n) ? '0' : n;
}
export function optionIdentityKey(t: OptionIdentityTerms): string {
  return JSON.stringify([t.channel, t.account_id, canonicalOptionUnderlying(t.underlying, { ...t, strike:Number(t.strike) }),
    t.right, normalizedDecimal(t.strike), t.expiry, normalizedDecimal(t.multiplier), t.currency]);
}
export const executionIdentityKey = (e: Pick<OptionExecution, 'channel' | 'account_id' | 'execution_id'>) =>
  JSON.stringify([e.channel, e.account_id, e.execution_id]);

/** RFC 9562 UUIDv8: application-owned SHA-256 namespace, scoped to the immutable user UUID.
 * Determinism makes the read-only compatibility projection identical to the migration.
 * No money, dates of import, quantity, fee, or current mark enters an identity. */
export function optionSystemId(owner: string, kind: 'option' | 'execution' | 'cycle', key: string): string {
  const bytes = createHash('sha256').update(JSON.stringify(['invage-option-identities-v1', owner, kind, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function optionId(state: InvestorState, terms: OptionIdentityTerms): string {
  const key = optionIdentityKey(terms);
  return state.option_identities?.options[key] ?? optionSystemId(state.user.id, 'option', key);
}
export function executionId(state: InvestorState, e: OptionExecution): string {
  const key = executionIdentityKey(e);
  return state.option_identities?.executions[key]?.id ?? optionSystemId(state.user.id, 'execution', key);
}
export function optionAccounts(state: InvestorState): Record<string, string> {
  return Object.fromEntries(Object.values(readBrokerAccountModel(state).connections)
    .filter(c => c.account_id).map(c => [c.channel, c.account_id!]));
}
export function holdingIdentityTerms(state: InvestorState, key: string, accounts = optionAccounts(state)): OptionIdentityTerms {
  const h = getPortfolio(state)[key], o = h.option!;
  const channel = h.channel || 'default';
  // A missing account/currency remains explicitly unknown, never guessed from a different broker.
  return { channel, account_id:accounts[channel] || '', underlying:o.underlying, right:o.right,
    strike:String(o.strike), expiry:o.expiry, multiplier:String(o.multiplier), currency:h.currency || '' };
}

/** Pure, idempotent backfill; retains historical keys when holdings disappear. */
export function buildOptionIdentityIndex(state: InvestorState): OptionIdentityIndex {
  const prior = state.option_identities;
  if (prior && prior.version !== 1) throw new Error('Unsupported option identity index version');
  const next: OptionIdentityIndex = { version:1, options:{ ...prior?.options }, executions:{ ...prior?.executions } };
  const register = (t: OptionIdentityTerms) => {
    const key = optionIdentityKey(t);
    return next.options[key] ??= optionSystemId(state.user.id, 'option', key);
  };
  for (const e of mergeOptionExecutions([], state.option_executions ?? [])) {
    const option_id = register(e), key = executionIdentityKey(e);
    const existing = next.executions[key];
    if (existing && existing.option_id !== option_id) throw new Error('Execution identity points to conflicting option terms');
    next.executions[key] ??= { id:optionSystemId(state.user.id, 'execution', key), option_id };
  }
  const accounts = optionAccounts(state);
  for (const [key, h] of Object.entries(getPortfolio(state))) if (h.instrument === 'option' && h.option) register(holdingIdentityTerms(state, key, accounts));
  for (const run of state.option_observations ?? []) for (const o of run.options) register({ ...o, strike:String(o.strike), multiplier:String(o.multiplier), channel:run.channel, account_id:run.account_id });
  for (const event of state.option_events ?? []) register({ ...event, currency:event.currency ?? '' });
  const ids = [...Object.values(next.options), ...Object.values(next.executions).map(e => e.id)];
  if (ids.some(id => !/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid or duplicate system option identity');
  }
  const options = new Set(Object.values(next.options));
  if (Object.values(next.executions).some(e => !options.has(e.option_id))) throw new Error('System execution has an unknown option identity');
  return next;
}
