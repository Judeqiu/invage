import type { BrokerHistoryExecution, BrokerHistoryGap } from '../brokers/history.js';
import { addDecimals, negateDecimal } from '../brokers/option-executions.js';
import { historyProduct } from '../brokers/history-values.js';

/** Exact finite decimal division: no floating-point rounding or assumed lot size. */
function ratio(numerator: string, denominator: string): string | null {
  const parts = (v: string) => ({ units: BigInt(v.replace('.', '')), scale: v.split('.')[1]?.length ?? 0 });
  const n = parts(numerator), d = parts(denominator);
  let top = n.units * 10n ** BigInt(d.scale), bottom = d.units * 10n ** BigInt(n.scale);
  if (!bottom || top * bottom <= 0n) return null;
  if (bottom < 0n) { top = -top; bottom = -bottom; }
  const gcd = (a: bigint, b: bigint): bigint => { while (b) [a,b] = [b,a % b]; return a; };
  const divisor = gcd(top,bottom); top /= divisor; bottom /= divisor;
  let twos = 0, fives = 0;
  while (bottom % 2n === 0n) { bottom /= 2n; twos++; }
  while (bottom % 5n === 0n) { bottom /= 5n; fives++; }
  if (bottom !== 1n) return null;
  const scale = Math.max(twos,fives);
  const units = top * 2n ** BigInt(scale-twos) * 5n ** BigInt(scale-fives);
  const digits = units.toString().padStart(scale+1,'0');
  return scale ? `${digits.slice(0,-scale)}.${digits.slice(-scale)}` : digits;
}
const equal = (a: string, b: string) => !/[1-9]/.test(addDecimals(a,negateDecimal(b)));

/** Approved Tiger interpretation: signed fill cash / (quantity * price) is the
 * exact contract multiplier only when every observed fill and known size agree.
 * Unknown/contradictory evidence never changes reported cash or known metadata.
 */
export function recoverTigerHistoryMultipliers(rows: BrokerHistoryExecution[]) {
  const groups = new Map<string,BrokerHistoryExecution[]>();
  for (const row of rows) if (row.broker_id === 'tiger' && row.instrument === 'option') {
    const key = JSON.stringify([row.channel,row.account_id,row.native_symbol,row.currency]);
    groups.set(key,[...(groups.get(key) ?? []),row]);
  }
  const recovered = new Map<BrokerHistoryExecution,string>(), gaps: BrokerHistoryGap[] = [];
  for (const group of groups.values()) {
    let size: string | null = null, conflict = false;
    const observe = (value: string) => { if (size !== null && !equal(size,value)) conflict = true; else size = value; };
    for (const row of group) {
      if (row.multiplier !== null) observe(row.multiplier);
      if (row.price === null || row.gross_cash === null) continue;
      const product = historyProduct(row.quantity,row.price);
      const cash = row.side === 'buy' ? negateDecimal(row.gross_cash) : row.gross_cash;
      if (equal(product,'0')) { if (!equal(cash,'0')) conflict = true; continue; }
      const derived = ratio(cash,product);
      if (derived === null) conflict = true;
      else observe(derived);
    }
    if (conflict) {
      gaps.push({kind:'coverage',reference:group[0].native_symbol,
        reason:'Tiger cash-derived contract multiplier conflicts with fill evidence or reported metadata; original values retained.'});
      continue;
    }
    if (size !== null) for (const row of group) if (row.multiplier === null) recovered.set(row,size);
  }
  return { executions:rows.map(row => recovered.has(row) ? {...row,multiplier:recovered.get(row)!} : row),
    recovered:[...recovered.keys()].map(row => row.id), gaps };
}
