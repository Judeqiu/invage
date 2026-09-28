import { randomBytes } from 'node:crypto';
import { BrokerHttpError, BrokerParseError } from '../brokers/errors.js';
import { signWebullRequest, webullSignContent } from './webull-sign.js';
import {
  WEBULL_ALLOW_HOSTS,
  WEBULL_API_HOSTS,
  WEBULL_REGIONS,
  type WebullRawBundle,
  type WebullRegion,
} from './webull-types.js';

export interface WebullCredentials {
  app_key: string;
  app_secret: string;
  region: WebullRegion;
  account_id?: string;
  access_token?: string;
}

const SKIP_ACCOUNT_CLASS = new Set(['FUTURES', 'CRYPTO', 'EVENTS_CASH']);

export function parseWebullRegion(raw: string | undefined): WebullRegion {
  const t = (raw ?? '').trim().toLowerCase();
  if ((WEBULL_REGIONS as readonly string[]).includes(t)) return t as WebullRegion;
  throw new Error(
    `Webull region must be one of ${WEBULL_REGIONS.join(', ')} (got "${raw ?? ''}").`,
  );
}

function isoTimestamp(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function errorFromBody(json: unknown, status: number, path: string): BrokerHttpError {
  const rec = asRecord(json);
  const code = rec ? String(rec.error_code ?? rec.code ?? '') : '';
  const message = rec ? String(rec.message ?? rec.msg ?? rec.error ?? '') : '';
  const hint =
    /token|2fa|verif/i.test(`${code} ${message}`) || status === 401
      ? ' If an access token is required, open Settings → Brokers → Webull, click Create token, approve it in the Webull app, check for NORMAL status, and Sync again.'
      : '';
  return new BrokerHttpError(
    `Webull ${path} HTTP ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}.${hint}`,
    code || String(status),
  );
}

export async function webullGet(args: {
  host: string;
  path: string;
  query?: Record<string, string>;
  credentials: WebullCredentials;
  fetchImpl: typeof fetch;
  timestamp?: string;
  nonce?: string;
}): Promise<unknown> {
  if (!WEBULL_ALLOW_HOSTS.has(args.host)) {
    throw new BrokerParseError(`Webull host "${args.host}" is not allow-listed.`);
  }
  const query = args.query ?? {};
  const timestamp = args.timestamp ?? isoTimestamp();
  const nonce = args.nonce ?? randomBytes(16).toString('hex');
  const encoded = webullSignContent({
    path: args.path,
    query,
    host: args.host,
    appKey: args.credentials.app_key,
    timestamp,
    nonce,
  });
  const signature = signWebullRequest(encoded, args.credentials.app_secret);
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k]!)}`)
    .join('&');
  const url = `https://${args.host}${args.path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-app-key': args.credentials.app_key,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    'x-version': 'v3',
  };
  if (args.credentials.access_token) headers['x-access-token'] = args.credentials.access_token;
  const res = await args.fetchImpl(url, { method: 'GET', headers });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw errorFromBody(json, res.status, args.path);
  return json;
}

async function webullTokenRequest(args: {
  credentials: WebullCredentials;
  path: '/auth/tokens/create' | '/auth/tokens/check';
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const host = WEBULL_API_HOSTS[args.credentials.region];
  const timestamp = isoTimestamp();
  const nonce = randomBytes(16).toString('hex');
  const signature = signWebullRequest(webullSignContent({
    path: args.path,
    query: {},
    host,
    appKey: args.credentials.app_key,
    timestamp,
    nonce,
  }), args.credentials.app_secret);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-app-key': args.credentials.app_key,
    'x-timestamp': timestamp,
    'x-signature': signature,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-version': '1.0',
    'x-signature-nonce': nonce,
    'x-version': 'v3',
  };
  if (args.path === '/auth/tokens/check') {
    if (!args.credentials.access_token) throw new BrokerParseError('Webull access token is missing. Create a token first.');
    headers['x-access-token'] = args.credentials.access_token;
  }
  const res = await (args.fetchImpl ?? fetch)(`https://${host}${args.path}`, {
    method: 'POST',
    headers,
  });
  const raw = await res.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw errorFromBody(json, res.status, args.path);
  const record = asRecord(json);
  if (!record) throw new BrokerParseError(`Webull ${args.path} returned an invalid response.`);
  return record;
}

function tokenPayload(json: Record<string, unknown>): Record<string, unknown> {
  return asRecord(json.data) ?? json;
}

function tokenStatus(json: Record<string, unknown>): string {
  const status = tokenPayload(json).status ?? tokenPayload(json).token_status;
  return typeof status === 'string' ? status.trim().toUpperCase() : '';
}

export async function createWebullToken(
  credentials: WebullCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<{ token: string; status: string }> {
  const json = await webullTokenRequest({ credentials, path: '/auth/tokens/create', fetchImpl: opts?.fetchImpl });
  const data = tokenPayload(json);
  const token = data.token ?? data.access_token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new BrokerParseError('Webull Create Token returned no token.');
  }
  return { token: token.trim(), status: tokenStatus(json) || 'PENDING' };
}

export async function checkWebullToken(
  credentials: WebullCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<{ status: string }> {
  const json = await webullTokenRequest({ credentials, path: '/auth/tokens/check', fetchImpl: opts?.fetchImpl });
  const status = tokenStatus(json);
  if (!status) throw new BrokerParseError('Webull Check Token returned no status.');
  return { status };
}

function accountIdOf(row: unknown): string {
  if (row == null || typeof row !== 'object') return '';
  return String((row as { account_id?: unknown }).account_id ?? '').trim();
}

function accountClassOf(row: unknown): string {
  if (row == null || typeof row !== 'object') return '';
  return String((row as { account_class?: unknown }).account_class ?? '').trim().toUpperCase();
}

export function accountsFromList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const rec = asRecord(json);
  if (!rec) throw new BrokerParseError('Webull account list is not an array.');
  const inner = rec.data ?? rec.accounts ?? rec.account_list;
  if (Array.isArray(inner)) return inner;
  throw new BrokerParseError('Webull account list is not an array.');
}

export function pickAccountId(accounts: unknown[], stored?: string): string {
  const rows = accounts.filter((a) => accountIdOf(a));
  const ids = rows.map(accountIdOf);
  if (stored?.trim()) {
    if (!ids.includes(stored.trim())) {
      throw new BrokerParseError(`account_id ${stored.trim()} is not in the Webull account list.`);
    }
    return stored.trim();
  }
  const tradable = rows.filter((a) => !SKIP_ACCOUNT_CLASS.has(accountClassOf(a)));
  const pick = tradable.length > 0 ? tradable : rows;
  const pickedIds = [...new Set(pick.map(accountIdOf))];
  if (pickedIds.length === 1) return pickedIds[0]!;
  if (pickedIds.length === 0) throw new BrokerParseError('Webull returned no trading accounts.');
  throw new BrokerParseError('multiple Webull accounts — paste account_id');
}

export async function fetchWebullRawBundle(
  credentials: WebullCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<WebullRawBundle> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const host = WEBULL_API_HOSTS[credentials.region];
  const accounts = await webullGet({
    host,
    path: '/trading/accounts/list',
    credentials,
    fetchImpl,
  });
  const account_id = pickAccountId(accountsFromList(accounts), credentials.account_id);
  const balances = await webullGet({
    host,
    path: '/trading/assets/balances/get',
    query: { account_id },
    credentials,
    fetchImpl,
  });
  const positions = await webullGet({
    host,
    path: '/trading/assets/positions/list',
    query: { account_id },
    credentials,
    fetchImpl,
  });
  return {
    schema: 'invage.webull.raw.v1',
    fetched_at: new Date().toISOString(),
    region: credentials.region,
    host,
    account_id,
    accounts,
    balances,
    positions,
  };
}

/** Account choices for Settings; positions and balances are not fetched. */
export async function listWebullAccounts(credentials: {
  app_key: string; app_secret: string; region: string; access_token?: string;
}, opts?: { fetchImpl?: typeof fetch }): Promise<Array<{ account_id: string; account_class: string }>> {
  const selected: WebullCredentials = {
    app_key: credentials.app_key,
    app_secret: credentials.app_secret,
    region: parseWebullRegion(credentials.region),
  };
  if (credentials.access_token) selected.access_token = credentials.access_token;
  const accounts = accountsFromList(await webullGet({
    host: WEBULL_API_HOSTS[selected.region], path: '/trading/accounts/list',
    credentials: selected, fetchImpl: opts?.fetchImpl ?? fetch,
  }));
  return accounts.map(row => ({ account_id: accountIdOf(row), account_class: accountClassOf(row) }))
    .filter(row => row.account_id && !SKIP_ACCOUNT_CLASS.has(row.account_class));
}
