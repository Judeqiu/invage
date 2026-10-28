import type { BrokerHistory, BrokerHistorySyncPlan } from '../brokers/history.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const adjacentBridge = fileURLToPath(new URL('./opend_bridge.py', import.meta.url));
const bridge = existsSync(adjacentBridge) ? adjacentBridge : join(process.cwd(), 'src/futubull/opend_bridge.py');
const marker = 'INVAGE_FUTU_JSON:';
const firms = new Set(['FUTUSECURITIES', 'FUTUINC', 'FUTUSG']);

export interface FutubullCredentials {
  opend_port: string;
  security_firm: string;
  acc_id?: string;
}

function validated(credentials: FutubullCredentials) {
  const port = Number(credentials.opend_port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('OpenD port must be 1–65535.');
  const security_firm = credentials.security_firm?.trim().toUpperCase();
  if (!firms.has(security_firm)) throw new Error('Securities firm must be FUTUSECURITIES, FUTUINC, or FUTUSG.');
  return { opend_port: port, security_firm };
}

async function bridgeCall(credentials: FutubullCredentials, mode: 'discover' | 'snapshot', history?:BrokerHistorySyncPlan, historicalBackfill=false): Promise<Record<string, unknown>> {
  const config = validated(credentials);
  if (mode === 'snapshot' && !/^\d+$/.test(credentials.acc_id ?? '')) {
    throw new Error('Futubull trading account ID must be numeric.');
  }
  const payload = JSON.stringify({ ...config, mode, acc_id: credentials.acc_id, history });
  const child = await new Promise<{ stdout: string; error?: Error }>((resolve) => {
    const proc = execFile('python3', [bridge], { timeout: history?.mode === 'full' || historicalBackfill ? 120_000 : 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve({ stdout, ...(error ? { error } : {}) }));
    proc.stdin?.end(payload);
  });
  const line = child.stdout.split('\n').reverse().find((value: string) => value.startsWith(marker));
  if (!line) throw new Error(child.error ? 'Futubull OpenD bridge failed. Install Python futu-api and check the local gateway.'
    : 'Futubull OpenD bridge returned no result.');
  let result: Record<string, unknown> | undefined;
  for (const candidate of child.stdout.split('\n').reverse().filter(value=>value.startsWith(marker))) {
    try { result=JSON.parse(candidate.slice(marker.length)) as Record<string,unknown>;break; }
    catch { if(!history)throw new Error('Futubull OpenD bridge returned invalid JSON.'); }
  }
  if(!result)throw new Error('Futubull OpenD bridge returned invalid JSON.');
  if (history && (child.error || result.error)) {
    for (const earlier of child.stdout.split('\n').reverse().filter(value=>value.startsWith(marker))) {
      try {
        const core=JSON.parse(earlier.slice(marker.length));
        if(core.schema==='invage.futubull.raw.v1' && core.history_error && !core.error) return core;
      } catch { /* A truncated history result cannot invalidate a complete earlier snapshot. */ }
    }
  }
  if (child.error || result.error) throw new Error(String(result.error ?? 'Futubull OpenD bridge failed.'));
  return result;
}

export async function discoverFutubullAccounts(credentials: FutubullCredentials) {
  const result = await bridgeCall(credentials, 'discover');
  if (!Array.isArray(result.accounts)) throw new Error('Futubull account response is invalid.');
  return result.accounts.map(row => {
    const value = row as Record<string, unknown>;
    return { account_id: String(value.acc_id), trd_env: 'REAL', security_firm: value.security_firm,
      card_num: value.card_num, uni_card_num: value.uni_card_num };
  });
}

export async function fetchFutubullSnapshot(credentials: FutubullCredentials, history?:BrokerHistorySyncPlan, retainedHistory?:BrokerHistory) {
  if(retainedHistory&&(retainedHistory.account_id!==credentials.acc_id||retainedHistory.broker_id!=='futubull'))throw new Error('OpenD retained fee history scope mismatch');
  const backfill=!!(history&&retainedHistory&&retainedHistory.executions.some(e=>e.fee_cash===null)&&retainedHistory.sync.from<history.from);
  if(backfill)history={...history!,from:retainedHistory!.sync.from};
  return bridgeCall(credentials, 'snapshot',history,backfill);
}
