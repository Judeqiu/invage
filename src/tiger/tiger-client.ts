import { BrokerHttpError, BrokerParseError } from '../brokers/errors.js';
import { shanghaiTimestamp, signTigerRequest, verifyTigerResponse } from './tiger-sign.js';
import {
  envelopeOk,
  type TigerGatewayEnvelope,
  type TigerHttpMethod,
  type TigerRawBundle,
} from './tiger-types.js';

export const TIGER_ALLOW_HOSTS = new Set([
  'cg.play-analytics.com',
  'openapi.tigerfintech.com',
  'openapi-sandbox.tigerfintech.com',
  'openapi.tradeup.com',
]);

const GARDEN_URL = 'https://cg.play-analytics.com';

const FALLBACK = {
  liveCommon: 'https://openapi.tigerfintech.com/gateway',
  liveHkg: 'https://openapi.tigerfintech.com/hkg/gateway',
  paperCommon: 'https://openapi-sandbox.tigerfintech.com/gateway',
  paperHkg: 'https://openapi-sandbox.tigerfintech.com/hkg/gateway',
} as const;

const HKG_LICENSES = new Set(['TBSG', 'TBNZ', 'TBHK']);

export interface TigerCredentials {
  tiger_id: string;
  account: string;
  license: string;
  private_key: string;
  token?: string;
  secret_key?: string;
}

export function isPaperAccountId(account: string): boolean {
  return /^\d{17}$/.test(account.trim());
}

function hostnameOf(url: string): string {
  return new URL(url).hostname;
}

function allowlistedGateway(url: string): string | null {
  try {
    const u = new URL(url);
    if (!TIGER_ALLOW_HOSTS.has(u.hostname)) return null;
    if (u.protocol !== 'https:') return null;
    if (!u.pathname || u.pathname === '/') u.pathname = '/gateway';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function fallbackGateway(license: string, paper: boolean): string {
  const hkg = HKG_LICENSES.has(license.toUpperCase());
  if (paper) return hkg ? FALLBACK.paperHkg : FALLBACK.paperCommon;
  return hkg ? FALLBACK.liveHkg : FALLBACK.liveCommon;
}

export function parseGardenGateways(body: unknown, paper: boolean, license: string): string | null {
  const items = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : null;
  if (!items) return null;
  const licenseKey = license.toUpperCase();
  const want = paper
    ? [`${licenseKey}-PAPER`, 'COMMON']
    : [licenseKey, 'COMMON'];
  const field = paper ? 'openapi-sandbox' : 'openapi';
  for (const key of want) {
    for (const item of items) {
      if (item == null || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (String(rec.license ?? rec.name ?? rec.key ?? '') !== key && rec[key] == null) {
        const nested = rec[key];
        if (typeof nested === 'string') {
          const ok = allowlistedGateway(nested);
          if (ok) return ok;
        }
        continue;
      }
      const url = rec[field] ?? rec.openapi ?? rec.url;
      if (typeof url === 'string') {
        const ok = allowlistedGateway(url);
        if (ok) return ok;
      }
    }
  }
  return null;
}

export async function resolveTigerGateway(args: {
  license: string;
  paper: boolean;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const fallback = fallbackGateway(args.license, args.paper);
  const garden =
    args.license.toUpperCase() === 'TBUS'
      ? `${GARDEN_URL}?appName=tradeup`
      : GARDEN_URL;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1000);
    const res = await args.fetchImpl(garden, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const json: unknown = await res.json();
    return parseGardenGateways(json, args.paper, args.license) ?? fallback;
  } catch {
    return fallback;
  }
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export async function tigerExecute(args: {
  gateway: string;
  credentials: TigerCredentials;
  method: TigerHttpMethod;
  version?: string;
  biz: Record<string, unknown>;
  fetchImpl: typeof fetch;
  timestamp?: string;
}): Promise<TigerGatewayEnvelope> {
  const host = hostnameOf(args.gateway);
  if (!TIGER_ALLOW_HOSTS.has(host)) {
    throw new BrokerHttpError(`Tiger gateway host ${host} is not allow-listed.`);
  }
  const params: Record<string, string> = {
    tiger_id: args.credentials.tiger_id,
    method: args.method,
    charset: 'UTF-8',
    sign_type: 'RSA',
    timestamp: args.timestamp ?? shanghaiTimestamp(),
    version: args.version ?? '1.0',
    biz_content: compactJson(args.biz),
  };
  if (args.credentials.token) params.access_token = args.credentials.token;
  if (args.credentials.secret_key) params.secret_key = args.credentials.secret_key;
  params.sign = signTigerRequest(params, args.credentials.private_key);
  const res = await args.fetchImpl(args.gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new BrokerHttpError(`Tiger ${args.method} HTTP ${res.status}`, String(res.status));
  }
  const history = args.method === 'orders' || args.method === 'order_transactions';
  const exactFields = new Set(['id', 'orderId', 'accountId', 'filledQuantity', 'filledPrice',
    'filledAmount', 'commission', 'gst', 'avgFillPrice', 'strike', 'multiplier']);
  const parse = (text: string) => JSON.parse(text, (key, value, context?: { source?: string }) => {
    if (!history || !exactFields.has(key) || typeof value !== 'number') return value;
    if (context?.source && /^-?\d+(?:\.\d+)?$/.test(context.source)) return context.source;
    if (['id', 'orderId', 'accountId'].includes(key) && !Number.isSafeInteger(value)) {
      throw new BrokerParseError('Tiger history ID cannot be read without precision loss.');
    }
    return String(value);
  });
  const json = parse(await res.text()) as TigerGatewayEnvelope;
  if (typeof json.sign === 'string' && json.sign) {
    const sign = json.sign;
    // Tiger signs the original request timestamp, not the response JSON.
    // Match TigerOpenClient.__parse_response in the official Python SDK.
    const content = params.timestamp;
    if (!verifyTigerResponse({ hostname: host, content, sign })) {
      throw new BrokerHttpError(`Tiger ${args.method} response signature is invalid.`);
    }
  }
  // Tiger may encode data as a JSON string (as handled by TigerResponse in its SDK).
  if (typeof json.data === 'string') {
    try {
      json.data = parse(json.data);
    } catch {
      throw new BrokerHttpError(`Tiger ${args.method} response data is not valid JSON.`);
    }
  }
  return json;
}

async function fetchOptionHistory(args: {
  gateway: string; credentials: TigerCredentials; fetchImpl: typeof fetch; timestamp?: string;
}): Promise<NonNullable<TigerRawBundle['option_history']>> {
  const start = 946684800000;
  const end = Date.now();
  async function pages(method: 'orders' | 'order_transactions', limit: number) {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let token = '';
    for (let page = 0; ; page++) {
      if (page >= 1000) throw new BrokerParseError('Tiger option history exceeded the page limit.');
      // order_transactions is limited to 60 requests/minute. Orders allow 120.
      if (page) await new Promise(resolve => setTimeout(resolve, method === 'orders' ? 500 : 1000));
      const env = await tigerExecute({ ...args, method, biz: {
        account: args.credentials.account, sec_type: method === 'orders' ? 'ALL' : 'OPT',
        start_date: start, end_date: end, limit, page_token: token,
      } });
      if (!envelopeOk(env)) throw new BrokerHttpError(`Tiger ${method} history failed: ${env.message ?? env.code}`, String(env.code));
      const data = env.data as { items?: unknown; nextPageToken?: unknown } | undefined;
      if (!Array.isArray(data?.items) || data.items.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new BrokerParseError(`Tiger ${method} history response is incomplete.`);
      }
      rows.push(...data.items as Record<string, unknown>[]);
      if (data.nextPageToken == null || data.nextPageToken === '') break;
      if (typeof data.nextPageToken !== 'string' || seen.has(data.nextPageToken)) {
        throw new BrokerParseError(`Tiger ${method} history pagination did not advance.`);
      }
      seen.add(data.nextPageToken);
      token = data.nextPageToken;
    }
    return rows;
  }
  const orders = await pages('orders', 300);
  const transactions = await pages('order_transactions', 100);
  return { start, end, orders, transactions };
}

function skippedSleeve(env: TigerGatewayEnvelope): TigerGatewayEnvelope {
  return {
    code: env.code,
    message: env.message,
    data: { items: [] },
  };
}

function accountKindFromManaged(
  env: TigerGatewayEnvelope | null,
  account: string,
): TigerRawBundle['account_kind'] {
  const data = env?.data;
  const items = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : [];
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (String(rec.account ?? '') !== account) continue;
    const t = String(rec.account_type ?? rec.accountType ?? '').toUpperCase();
    if (t === 'PAPER') return 'paper';
    if (t === 'GLOBAL') return 'global';
    if (t === 'STANDARD' || t === 'PRIME') return 'prime';
  }
  if (isPaperAccountId(account)) return 'paper';
  if (account.toUpperCase().startsWith('U')) return 'global';
  return 'prime';
}

export async function fetchTigerRawBundle(
  credentials: TigerCredentials,
  opts?: { fetchImpl?: typeof fetch; timestamp?: string; gateway?: string },
): Promise<TigerRawBundle> {
  if (credentials.license.toUpperCase() === 'TBHK' && !credentials.token?.trim()) {
    throw new BrokerParseError(
      'TBHK license requires a token. Generate it on the developer portal and paste it (expires ~30 days).',
    );
  }
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const paperGuess = isPaperAccountId(credentials.account);
  const gateway =
    opts?.gateway ??
    (await resolveTigerGateway({
      license: credentials.license,
      paper: paperGuess,
      fetchImpl,
    }));
  const fetched_at = new Date().toISOString();
  const account = credentials.account;
  let managed: TigerGatewayEnvelope | null = null;
  try {
    managed = await tigerExecute({
      gateway,
      credentials,
      method: 'accounts',
      biz: { account },
      fetchImpl,
      timestamp: opts?.timestamp,
    });
    if (!envelopeOk(managed)) managed = null;
  } catch {
    managed = null;
  }
  const account_kind = accountKindFromManaged(managed, account);
  const assetMethod: 'assets' | 'prime_assets' =
    account_kind === 'global' ? 'assets' : 'prime_assets';
  const assetsEnv = await tigerExecute({
    gateway,
    credentials,
    method: assetMethod,
    biz:
      assetMethod === 'prime_assets'
        ? { account, base_currency: 'USD', consolidated: true }
        : { account, segment: true, market_value: true },
    fetchImpl,
    timestamp: opts?.timestamp,
  });
  if (!envelopeOk(assetsEnv)) {
    throw new BrokerHttpError(
      `Tiger ${assetMethod} failed: ${assetsEnv.message ?? assetsEnv.code}`,
      String(assetsEnv.code),
    );
  }
  async function positions(secType: 'STK' | 'OPT' | 'FUND'): Promise<TigerGatewayEnvelope> {
    const env = await tigerExecute({
      gateway,
      credentials,
      method: 'positions',
      biz: { account, sec_type: secType, currency: 'ALL', market: 'ALL' },
      fetchImpl,
      timestamp: opts?.timestamp,
    });
    if (secType === 'STK' && !envelopeOk(env)) {
      throw new BrokerHttpError(
        `Tiger positions STK failed: ${env.message ?? env.code}`,
        String(env.code),
      );
    }
    if (!envelopeOk(env)) return skippedSleeve(env);
    return env;
  }
  const STK = await positions('STK');
  const OPT = await positions('OPT');
  const FUND = await positions('FUND');
  const optionRows = Array.isArray(OPT.data) ? OPT.data :
    OPT.data && typeof OPT.data === 'object' ? (OPT.data as { items?: unknown }).items : undefined;
  const hasOptions = envelopeOk(OPT) && Array.isArray(optionRows) && optionRows.length > 0;
  const option_history = hasOptions && account_kind !== 'global'
    ? await fetchOptionHistory({ gateway, credentials, fetchImpl, timestamp: opts?.timestamp }) : undefined;
  return {
    schema: 'invage.tiger.raw.v1',
    fetched_at,
    gateway,
    account,
    license: credentials.license,
    account_kind,
    managed_accounts: managed,
    assets: { method: assetMethod, envelope: assetsEnv },
    positions: { STK, OPT, FUND },
    ...(option_history ? { option_history } : {}),
  };
}
