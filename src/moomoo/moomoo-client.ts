import { BrokerHttpError, BrokerParseError } from '../brokers/errors.js';
import { moomooNonce, moomooSignContent, parseSignAlg, signMooMooRequest, type MooMooSignAlg } from './moomoo-sign.js';
import { envelopeOk, type MooMooEnvelope, type MooMooRawBundle } from './moomoo-types.js';

export const MOOMOO_HOST = 'webapi.moomoo.com';
export const MOOMOO_ORIGIN = `https://${MOOMOO_HOST}`;

const CLOCK_SKEW = -12006;

export interface MooMooCredentials {
  app_key: string;
  private_key: string;
  acc_id?: string;
  sign_alg: MooMooSignAlg;
}

function asEnvelope(json: unknown): MooMooEnvelope {
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    throw new BrokerParseError('MooMoo response is not an envelope.');
  }
  const rec = json as Record<string, unknown>;
  const env: MooMooEnvelope = { s: String(rec.s ?? '') };
  if ('d' in rec) env.d = rec.d;
  if (typeof rec.errcode === 'number') env.errcode = rec.errcode;
  if (typeof rec.errmsg === 'string') env.errmsg = rec.errmsg;
  return env;
}

function logRateHeaders(res: Response): void {
  const bits: string[] = [];
  res.headers.forEach((v, k) => {
    if (/^x-ratelimit/i.test(k) || k.toLowerCase() === 'retry-after') bits.push(`${k}=${v}`);
  });
  if (bits.length) console.info('broker_sync moomoo', bits.join(' '));
}

export async function moomooGet(args: {
  path: string;
  query?: string;
  credentials: MooMooCredentials;
  fetchImpl: typeof fetch;
  timestampMs?: string;
}): Promise<MooMooEnvelope> {
  const query = args.query ?? '';
  const url = `${MOOMOO_ORIGIN}${args.path}${query ? `?${query}` : ''}`;
  const timestampMs = args.timestampMs ?? String(Date.now());
  const nonce = moomooNonce();
  const content = moomooSignContent({
    timestampMs,
    method: 'GET',
    path: args.path,
    query,
    body: undefined,
  });
  const signature = signMooMooRequest(content, args.credentials.private_key, args.credentials.sign_alg);
  const res = await args.fetchImpl(url, {
    method: 'GET',
    headers: {
      'X-Api-Key': args.credentials.app_key,
      Authorization: signature,
      'X-Timestamp': timestampMs,
      'X-Nonce': nonce,
    },
  });
  logRateHeaders(res);
  if (!res.ok) {
    throw new BrokerHttpError(`MooMoo ${args.path} HTTP ${res.status}`, String(res.status));
  }
  // Moomoo sends uint64 account IDs as JSON numbers. Preserve their source
  // digits before JavaScript rounds them beyond Number.MAX_SAFE_INTEGER.
  const json = JSON.parse(await res.text(), (key, value, context?: { source?: string }) => {
    if (key !== 'account_id' || typeof value !== 'number') return value;
    if (context?.source && /^\d+$/.test(context.source)) return context.source;
    if (Number.isSafeInteger(value)) return String(value);
    throw new BrokerParseError('MooMoo account_id cannot be read without precision loss. Use a Node.js runtime supporting JSON.parse source context.');
  });
  return asEnvelope(json);
}

async function serverTimeMs(fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${MOOMOO_ORIGIN}/api/v1.0/server-time`);
    if (!res.ok) return undefined;
    const json: unknown = await res.json();
    const rec = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
    const inner = rec.d && typeof rec.d === 'object' ? (rec.d as Record<string, unknown>) : rec;
    const v = inner.server_time_ms ?? rec.server_time_ms;
    if (v == null) return undefined;
    return String(v);
  } catch {
    return undefined;
  }
}

async function getWithSkewRetry(args: {
  path: string;
  query?: string;
  credentials: MooMooCredentials;
  fetchImpl: typeof fetch;
}): Promise<MooMooEnvelope> {
  const first = await moomooGet(args);
  if (envelopeOk(first) || first.errcode !== CLOCK_SKEW) return first;
  const server = await serverTimeMs(args.fetchImpl);
  if (!server) return first;
  return moomooGet({ ...args, timestampMs: server });
}

function failIfError(env: MooMooEnvelope, what: string): void {
  if (envelopeOk(env)) return;
  throw new BrokerHttpError(
    `MooMoo ${what} failed: ${env.errmsg ?? env.errcode ?? env.s}`,
    env.errcode != null ? String(env.errcode) : undefined,
  );
}

export interface AuthorizedAccount {
  account_id: string;
  security_firm: string;
  card_last4: string;
  trading_card_last4: string;
}

function authorizedAccounts(authorized: MooMooEnvelope): AuthorizedAccount[] {
  const d = authorized.d;
  const rows =
    d && typeof d === 'object' && !Array.isArray(d) && Array.isArray((d as { accounts?: unknown }).accounts)
      ? ((d as { accounts: unknown[] }).accounts)
      : Array.isArray(d)
        ? d
        : [];
  const out: AuthorizedAccount[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const account_id = String(rec.account_id ?? '').trim();
    if (!account_id) continue;
    const security_firm = typeof rec.security_firm === 'string' ? rec.security_firm.trim() : '';
    const card = String(rec.univs_account_card_number ?? rec.account_card_number ?? '').trim();
    const tradingCard = String(rec.account_card_number ?? '').trim();
    out.push({
      account_id,
      security_firm,
      card_last4: card.length >= 4 ? card.slice(-4) : '',
      trading_card_last4: tradingCard.length >= 4 ? tradingCard.slice(-4) : '',
    });
  }
  return out;
}

async function fetchAuthorizedEnvelope(credentials: MooMooCredentials, fetchImpl: typeof fetch): Promise<MooMooEnvelope> {
  const authorized = await getWithSkewRetry({
    path: '/api/v1.0/accounts/authorized_trd_accs',
    credentials,
    fetchImpl,
  });
  failIfError(authorized, 'authorized_trd_accs');
  return authorized;
}

/** Safe account metadata for the connection form; never returns credentials or full card numbers. */
export async function fetchMooMooAuthorizedAccounts(
  credentials: MooMooCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<AuthorizedAccount[]> {
  return authorizedAccounts(await fetchAuthorizedEnvelope(credentials, opts?.fetchImpl ?? fetch));
}

function describeAuthorized(accounts: AuthorizedAccount[]): string {
  const shown = accounts.slice(0, 8).map((a) => {
    const bits = [a.security_firm, a.card_last4 ? `card ••${a.card_last4}` : ''].filter(Boolean);
    return bits.length ? `${a.account_id} (${bits.join(', ')})` : a.account_id;
  });
  const more = accounts.length - shown.length;
  if (more > 0) shown.push(`${more} more`);
  return shown.join('; ');
}

function pickAccId(authorized: MooMooEnvelope, stored?: string): string {
  const accounts = authorizedAccounts(authorized);
  const ids = accounts.map((a) => a.account_id);
  const listed = describeAuthorized(accounts);
  if (stored?.trim()) {
    if (!ids.includes(stored.trim())) {
      const hint = listed
        ? ` Authorized account_id values: ${listed}.`
        : '';
      throw new BrokerParseError(
        `acc_id ${stored.trim()} is not in the authorized trading accounts list.${hint} Open Manage and refresh the discovered trading accounts to select an authorized account.`,
      );
    }
    return stored.trim();
  }
  if (ids.length === 1) return ids[0]!;
  if (ids.length === 0) {
    throw new BrokerParseError('MooMoo returned no authorized trading accounts.');
  }
  throw new BrokerParseError(
    `Multiple authorized trading accounts. Open Manage and select one of the discovered accounts. Authorized account_id values: ${listed}.`,
  );
}

export async function fetchMooMooRawBundle(
  credentials: MooMooCredentials,
  opts?: { fetchImpl?: typeof fetch },
): Promise<MooMooRawBundle> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const authorized = await fetchAuthorizedEnvelope(credentials, fetchImpl);
  const acc_id = pickAccId(authorized, credentials.acc_id);
  const funds = await getWithSkewRetry({
    path: `/api/v1.0/accounts/${encodeURIComponent(acc_id)}/funds`,
    query: 'currency=USD',
    credentials,
    fetchImpl,
  });
  failIfError(funds, 'funds');
  const positions = await getWithSkewRetry({
    path: `/api/v1.0/accounts/${encodeURIComponent(acc_id)}/positions`,
    credentials,
    fetchImpl,
  });
  failIfError(positions, 'positions');
  return {
    schema: 'invage.moomoo.raw.v1',
    fetched_at: new Date().toISOString(),
    acc_id,
    authorized,
    funds,
    positions,
  };
}
