import { mergeExecutionEffect } from './execution-effects.js';
import { canonicalOptionUnderlying } from './option-symbol.js';

/** Execution history is independent of current holding snapshots. Money is exact decimal text. */
export interface OptionExecution {
  channel: string;
  account_id: string;
  execution_id: string;
  contract_id: string;
  /** Broker-local clock. No timezone is inferred from a Flex report. */
  executed_at: string;
  underlying: string;
  right: 'call' | 'put';
  expiry: string;
  strike: string;
  multiplier: string;
  contracts: string;
  side: 'buy' | 'sell';
  effect: 'open' | 'close' | 'mixed' | 'unknown';
  currency: string;
  gross_premium: string;
  /** Signed cash effect: negative fee, positive rebate; null if not reported. Same currency as proceeds. */
  commission: string | null;
  /** Manual journal provenance. Date-only records never claim a broker timestamp. */
  spreadsheet_source?: { sha256: string; file_id: string; sheet: string; row: number; date_precision: 'day'; multiplier_basis: 'user_approved' };
}

export function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Expected decimal string, received ${String(value)}`);
  }
  return value;
}

export function addDecimals(...values: string[]): string {
  values.forEach(decimal);
  const scale = Math.max(0, ...values.map(v => v.includes('.') ? v.length - v.indexOf('.') - 1 : 0));
  const sum = values.reduce((total, value) => {
    const [integer, fraction = ''] = value.split('.');
    const negative = integer.startsWith('-');
    const digits = integer.replace('-', '') + fraction.padEnd(scale, '0');
    return total + BigInt(digits) * (negative ? -1n : 1n);
  }, 0n);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  const result = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return `${sum < 0n ? '-' : ''}${result}`;
}

/** Negate decimal text without manufacturing a double minus for broker rebates. */
export function negateDecimal(value: string): string {
  decimal(value);
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function assertOptionExecution(raw: unknown): OptionExecution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Option execution must be an object');
  const r = raw as Record<string, unknown>;
  const fields = ['channel', 'account_id', 'execution_id', 'contract_id', 'executed_at', 'underlying', 'right', 'expiry', 'strike', 'multiplier', 'contracts', 'side', 'effect', 'currency', 'gross_premium', 'commission'];
  for (const key of Object.keys(r)) if (!fields.includes(key) && key !== 'spreadsheet_source') throw new Error(`Unknown execution field: ${key}`);
  for (const key of fields) if (!(key === 'commission' && r[key] === null) && (typeof r[key] !== 'string' || !r[key].trim())) throw new Error(`Execution ${key} is required`);
  const e = r as unknown as OptionExecution;
  if (!['call', 'put'].includes(e.right) || !['buy', 'sell'].includes(e.side) || !['open', 'close', 'mixed', 'unknown'].includes(e.effect)) throw new Error('Invalid execution action or right');
  if (!/^[A-Z]{3,4}$/.test(e.currency)) throw new Error('Invalid execution currency');
  if (e.spreadsheet_source !== undefined) {
    const s = e.spreadsheet_source;
    if (!s || Object.keys(s).sort().join(',') !== 'date_precision,file_id,multiplier_basis,row,sha256,sheet' ||
      !/^[a-f0-9]{64}$/.test(s.sha256) || !s.file_id?.trim() || !s.sheet?.trim() ||
      !Number.isSafeInteger(s.row) || s.row < 1 || s.date_precision !== 'day' || s.multiplier_basis !== 'user_approved' ||
      !e.execution_id.startsWith(`manual:spreadsheet:${s.sha256}:`) || !validDate(e.executed_at) || e.effect !== 'unknown') {
      throw new Error('Invalid manual spreadsheet provenance or date');
    }
  }
  const dateOnly = e.spreadsheet_source !== undefined && validDate(e.executed_at);
  if (!validDate(e.expiry) || (!dateOnly && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(e.executed_at)) || !validDate(e.executed_at.slice(0, 10))) throw new Error('Invalid execution date/time');
  for (const value of [e.strike, e.multiplier, e.contracts]) {
    decimal(value);
  }
  decimal(e.gross_premium);
  if (e.commission !== null) decimal(e.commission);
  // Canonical property order makes duplicate comparison independent of object key order.
  const underlying = canonicalOptionUnderlying(e.underlying, { ...e, strike: Number(e.strike) });
  const source = e.spreadsheet_source;
  return { ...Object.fromEntries(fields.map(key => [key, key === 'underlying' ? underlying : r[key]])),
    ...(source ? { spreadsheet_source: { sha256:source.sha256, file_id:source.file_id, sheet:source.sheet,
      row:source.row, date_precision:source.date_precision, multiplier_basis:source.multiplier_basis } } : {}) } as unknown as OptionExecution;
}

export function mergeOptionExecutions(existing: unknown, incoming: unknown): OptionExecution[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Option executions must be arrays');
  const byId = new Map<string, OptionExecution>();
  for (const raw of [...existing, ...incoming]) {
    const row = assertOptionExecution(raw);
    const key = JSON.stringify([row.channel, row.account_id, row.execution_id]);
    const prior = byId.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) {
      const normalized = (e: OptionExecution) => Object.fromEntries(Object.entries(e).map(([k,v]) => {
        if (['strike','multiplier','contracts','gross_premium','commission'].includes(k) && v !== null) {
          const value=addDecimals(v,'0');
          return [k,/^-?0(?:\.0+)?$/.test(value) ? '0' : value.replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1')];
        }
        return [k,v];
      }));
      // An unreported fee may become available after settlement. Keep known
      // fees when an overlapping source still omits them; never revise money.
      const effect = mergeExecutionEffect(prior.effect, row.effect);
      if (JSON.stringify(normalized({ ...prior,commission:null,effect })) === JSON.stringify(normalized({ ...row,commission:null,effect })) &&
          (prior.commission === null || row.commission === null || JSON.stringify(normalized({...prior,effect})) === JSON.stringify(normalized({...row,effect})))) {
        byId.set(key, { ...prior, effect, commission: prior.commission ?? row.commission });
        continue;
      }
      throw new Error(`Execution conflict: ${key}`);
    }
    byId.set(key, row);
  }
  return [...byId.values()].sort((a, b) => b.executed_at.localeCompare(a.executed_at) || a.execution_id.localeCompare(b.execution_id));
}

export function buildExecutionJournal(records: unknown) {
  if (records === undefined) return { available: false, executions: [], daily: [], cumulative: [] };
  const sumNet = (a: string | null, b: string | null): string | null => a === null || b === null ? null : addDecimals(a, b);
  const executions = mergeOptionExecutions([], records).map(row => ({ ...row, net_premium: row.commission === null ? null : addDecimals(row.gross_premium, row.commission) }));
  const groups = new Map<string, { channel: string; account_id: string; date: string; currency: string; gross_premium: string; net_premium: string | null }>();
  for (const row of executions) {
    const date = row.executed_at.slice(0, 10);
    const key = JSON.stringify([row.channel, row.account_id, date, row.currency]);
    const prior = groups.get(key);
    groups.set(key, { channel: row.channel, account_id: row.account_id, date, currency: row.currency, gross_premium: prior ? addDecimals(prior.gross_premium, row.gross_premium) : row.gross_premium, net_premium: prior ? sumNet(prior.net_premium, row.net_premium) : row.net_premium });
  }
  const cumulative = new Map<string, { channel: string; account_id: string; currency: string; gross_premium: string; net_premium: string | null }>();
  for (const row of groups.values()) {
    const key = JSON.stringify([row.channel, row.account_id, row.currency]);
    const prior = cumulative.get(key);
    cumulative.set(key, { channel: row.channel, account_id: row.account_id, currency: row.currency, gross_premium: prior ? addDecimals(prior.gross_premium, row.gross_premium) : row.gross_premium, net_premium: prior ? sumNet(prior.net_premium, row.net_premium) : row.net_premium });
  }
  return { available: true, executions, daily: [...groups.values()], cumulative: [...cumulative.values()] };
}
