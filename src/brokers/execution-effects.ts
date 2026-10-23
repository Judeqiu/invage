import { addDecimals } from './option-executions.js';
import type { BrokerHistory } from './history.js';
import type { OptionObservation } from './option-history.js';
import type { OptionLifecycleEvent } from './option-events.js';

/** Unknown is missing evidence, never a contradictory assertion. */
export function mergeExecutionEffect<T extends 'open' | 'close' | 'mixed' | 'unknown'>(a: T, b: T): T {
  if (a === b || b === 'unknown') return a;
  if (a === 'unknown') return b;
  throw new Error(`Conflicting execution effects: ${a} / ${b}`);
}
const subtract = (a: string, b: string) => addDecimals(a, b.startsWith('-') ? b.slice(1) : `-${b}`);
const sign = (a: string) => !/[1-9]/.test(a) ? 0 : a.startsWith('-') ? -1 : 1;
const equal = (a: string, b: string) => sign(subtract(a, b)) === 0;
function localTime(instant: string, clock: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: clock, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Derive effects only inside an interval bounded by two real broker snapshots.
 * Both endpoint quantities and every intervening fill must reconcile exactly.
 * No initial-zero assumption, order-side inference or present-day position guess.
 */
export function reconcileExecutionEffects(history: BrokerHistory, observations: OptionObservation[], events: OptionLifecycleEvent[] = []): BrokerHistory {
  const result = structuredClone(history);
  // Missing transaction coverage or unrepresented lifecycle delivery breaks a quantity proof.
  if (history.sync.gaps.some(g => g.kind === 'coverage' && !g.reason.startsWith('Order fees unavailable or invalid;'))) return result;
  const anchors = observations.filter(o => o.source === 'broker' && o.complete && o.skipped_positions === 0 &&
    o.broker_id === history.broker_id && o.channel === history.channel && o.account_id === history.account_id &&
    Date.parse(o.observed_at) >= Date.parse(history.sync.from) && Date.parse(o.observed_at) <= Date.parse(history.sync.through))
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const times = new Map<string, string>();
  const offsets = new Map<string, string | undefined>();
  const offset = (instant: string, clock: string) => {
    const key = JSON.stringify([instant, clock]);
    if (!offsets.has(key)) offsets.set(key, new Intl.DateTimeFormat('en', {timeZone: clock, timeZoneName:'longOffset'}).formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName')?.value);
    return offsets.get(key);
  };
  const time = (instant: string, clock: string) => {
    const key = JSON.stringify([instant, clock]);
    if (!times.has(key)) times.set(key, localTime(instant, clock));
    return times.get(key)!;
  };
  const groups = new Map<string, typeof result.executions>();
  for (const row of result.executions) {
    if (!row.option || !row.symbol || !row.multiplier || !row.currency) continue;
    const key = JSON.stringify([row.native_symbol, row.clock]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const contract = rows[0];
    // Flex may intentionally retain a local clock without a verified zone.
    // Keep broker-reported effects; do not infer UTC or block history ingestion.
    try { new Intl.DateTimeFormat('en', {timeZone:contract.clock}); }
    catch(error) { if(error instanceof RangeError)continue;throw error; }
    const terms = contract.option!;
    const matches = (o: OptionObservation['options'][number]) => o.underlying === contract.symbol && o.right === terms.right &&
      o.expiry === terms.expiry && equal(String(o.strike), terms.strike) && equal(String(o.multiplier), contract.multiplier!) && o.currency === contract.currency;
    const balance = (o: OptionObservation): string | undefined => {
      const matched = o.options.filter(matches);
      if (matched.some(p => !Number.isSafeInteger(p.units) || p.units < 0)) return undefined;
      return addDecimals('0', ...matched.map(p => `${p.side === 'short' ? '-' : ''}${p.units}`));
    };
    for (let i = 1; i < anchors.length; i++) {
      const before = anchors[i - 1], after = anchors[i];
      const from = time(before.observed_at, contract.clock), through = time(after.observed_at, contract.clock);
      // Local timestamps cannot safely order a daylight-saving clock change.
      if (offset(before.observed_at, contract.clock) !== offset(after.observed_at, contract.clock)) continue;
      // Avoid an ambiguous execution/snapshot ordering at second precision.
      if (from >= through || rows.some(r => r.executed_at === from || r.executed_at === through)) continue;
      if (events.some(e => e.channel === history.channel && e.account_id === history.account_id && e.underlying === contract.symbol &&
        e.right === terms.right && e.expiry === terms.expiry && equal(e.strike, terms.strike) && e.date >= from.slice(0, 10) && e.date <= through.slice(0, 10))) continue;
      const fills = rows.filter(r => r.executed_at > from && r.executed_at < through).sort((a, b) => a.executed_at.localeCompare(b.executed_at) || a.id.localeCompare(b.id));
      // Same-second opposite fills cannot be safely ordered by execution ID.
      if (fills.some((r, j) => fills.some((other, k) => k !== j && other.executed_at === r.executed_at && other.side !== r.side))) continue;
      let current = balance(before);
      const ending = balance(after);
      if (current === undefined || ending === undefined || !fills.length) continue;
      const effects: Array<'open' | 'close' | 'mixed'> = [];
      for (const fill of fills) {
        const delta = `${fill.side === 'sell' ? '-' : ''}${fill.quantity}`;
        const next = addDecimals(current, delta);
        effects.push(sign(current) === 0 || sign(current) === sign(delta) ? 'open' : sign(next) !== 0 && sign(next) !== sign(current) ? 'mixed' : 'close');
        current = next;
      }
      if (!equal(current, ending)) continue;
      // Reject inconsistent explicit classifications before enriching any row.
      const merged = fills.map((fill, j) => mergeExecutionEffect(fill.effect, effects[j]));
      fills.forEach((fill, j) => { fill.effect = merged[j]; });
    }
  }
  return result;
}
