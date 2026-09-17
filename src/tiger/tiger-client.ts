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
  const json = (await res.json()) as TigerGatewayEnvelope;
  if (typeof json.sign === 'string' && json.sign) {
    const { sign, ...rest } = json as TigerGatewayEnvelope & { sign: string };
    const content = compactJson(rest);
    if (!verifyTigerResponse({ hostname: host, content, sign })) {
      throw new BrokerHttpError(`Tiger ${args.method} response signature is invalid.`);
    }
  }
  return json;
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
  };
}
