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
  effect: 'open' | 'close';
  currency: string;
  gross_premium: string;
  /** Signed cash effect: negative fee, positive rebate. Same currency as proceeds. */
  commission: string;
}

export function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 100) {
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

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function assertOptionExecution(raw: unknown): OptionExecution {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Option execution must be an object');
  const r = raw as Record<string, unknown>;
  const fields = ['channel', 'account_id', 'execution_id', 'contract_id', 'executed_at', 'underlying', 'right', 'expiry', 'strike', 'multiplier', 'contracts', 'side', 'effect', 'currency', 'gross_premium', 'commission'];
  for (const key of Object.keys(r)) if (!fields.includes(key)) throw new Error(`Unknown execution field: ${key}`);
  for (const key of fields) if (typeof r[key] !== 'string' || !r[key].trim()) throw new Error(`Execution ${key} is required`);
  const e = r as unknown as OptionExecution;
  if (!['call', 'put'].includes(e.right) || !['buy', 'sell'].includes(e.side) || !['open', 'close'].includes(e.effect)) throw new Error('Invalid execution action or right');
  if (!/^[A-Z]{3,4}$/.test(e.currency)) throw new Error('Invalid execution currency');
  if (!validDate(e.expiry) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(e.executed_at) || !validDate(e.executed_at.slice(0, 10))) throw new Error('Invalid execution date/time');
  for (const value of [e.strike, e.multiplier, e.contracts]) {
    decimal(value);
    if (value.startsWith('-') || !/[1-9]/.test(value)) throw new Error('Execution strike, multiplier and contracts must be positive');
  }
  decimal(e.gross_premium);
  decimal(e.commission);
  const nonzero = /[1-9]/.test(e.gross_premium);
  if (nonzero && (e.gross_premium.startsWith('-') !== (e.side === 'buy'))) throw new Error('Execution proceeds sign disagrees with buy/sell');
  // Canonical property order makes duplicate comparison independent of object key order.
  return Object.fromEntries(fields.map(key => [key, r[key]])) as unknown as OptionExecution;
}

export function mergeOptionExecutions(existing: unknown, incoming: unknown): OptionExecution[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('Option executions must be arrays');
  const byId = new Map<string, OptionExecution>();
  for (const raw of [...existing, ...incoming]) {
    const row = assertOptionExecution(raw);
    const key = JSON.stringify([row.channel, row.account_id, row.execution_id]);
    const prior = byId.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error(`Execution conflict: ${key}`);
    byId.set(key, row);
  }
  return [...byId.values()].sort((a, b) => b.executed_at.localeCompare(a.executed_at) || a.execution_id.localeCompare(b.execution_id));
}

export function buildExecutionJournal(records: unknown) {
  if (records === undefined) return { available: false, executions: [], daily: [], cumulative: [] };
  const executions = mergeOptionExecutions([], records).map(row => ({ ...row, net_premium: addDecimals(row.gross_premium, row.commission) }));
  const groups = new Map<string, { channel: string; account_id: string; date: string; currency: string; net_premium: string }>();
  for (const row of executions) {
    if (!((row.side === 'sell' && row.effect === 'open') || (row.side === 'buy' && row.effect === 'close'))) continue;
    const date = row.executed_at.slice(0, 10);
    const key = JSON.stringify([row.channel, row.account_id, date, row.currency]);
    const prior = groups.get(key);
    groups.set(key, { channel: row.channel, account_id: row.account_id, date, currency: row.currency, net_premium: prior ? addDecimals(prior.net_premium, row.net_premium) : row.net_premium });
  }
  const cumulative = new Map<string, { channel: string; account_id: string; currency: string; net_premium: string }>();
  for (const row of groups.values()) {
    const key = JSON.stringify([row.channel, row.account_id, row.currency]);
    const prior = cumulative.get(key);
    cumulative.set(key, { channel: row.channel, account_id: row.account_id, currency: row.currency, net_premium: prior ? addDecimals(prior.net_premium, row.net_premium) : row.net_premium });
  }
  return { available: true, executions, daily: [...groups.values()], cumulative: [...cumulative.values()] };
}
