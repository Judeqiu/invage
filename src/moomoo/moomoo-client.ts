import { BrokerHttpError, BrokerParseError } from '../brokers/errors.js';
import { moomooNonce, moomooSignContent, parseSignAlg, signMooMooRequest, type MooMooSignAlg } from './moomoo-sign.js';
import { looksLikeOptionCode } from '../brokers/option-symbol.js';
import { envelopeOk, type MooMooEnvelope, type MooMooRawBundle } from './moomoo-types.js';
import type { BrokerHistorySyncPlan } from '../brokers/history.js';
import { parseMooMooOrderFees } from './moomoo-fees.js';

export const MOOMOO_HOST = 'webapi.moomoo.com';
export const MOOMOO_ORIGIN = `https://${MOOMOO_HOST}`;

function apiOrigin(credentials: MooMooCredentials): string {
  return credentials.broker === 'futubull' ? 'https://webapi.futunn.com' : MOOMOO_ORIGIN;
}

const CLOCK_SKEW = -12006;

export interface MooMooCredentials {
  /** Selects a fixed, trusted API host; never supplied by broker credentials. */
  broker?: 'moomoo' | 'futubull';
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

async function moomooRequest(args: {
  path: string;
  query?: string;
  credentials: MooMooCredentials;
  fetchImpl: typeof fetch;
  timestampMs?: string;
  method?: 'GET' | 'POST';
  body?: string;
}): Promise<unknown> {
  const method = args.method ?? 'GET';
  const query = args.query ?? '';
  const url = `${apiOrigin(args.credentials)}${args.path}${query ? `?${query}` : ''}`;
  const timestampMs = args.timestampMs ?? String(Date.now());
  const nonce = moomooNonce();
  const content = moomooSignContent({
    timestampMs,
    method,
    path: args.path,
    query,
    body: args.body,
  });
  const signature = signMooMooRequest(content, args.credentials.private_key, args.credentials.sign_alg);
  const res = await args.fetchImpl(url, {
    method,
    ...(args.body !== undefined ? { body: args.body } : {}),
    headers: {
      ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
  return json;
}

export async function moomooGet(args: {
  path: string;
  query?: string;
  credentials: MooMooCredentials;
  fetchImpl: typeof fetch;
  timestampMs?: string;
}): Promise<MooMooEnvelope> {
  return asEnvelope(await moomooRequest(args));
}

/** Read-only Cloud quote endpoints use ret_code/data rather than trade s/d. */
export async function moomooMarketData(args: {
  path: string; query?: string; body?: Record<string, unknown>;
  credentials: MooMooCredentials; fetchImpl?: typeof fetch;
}): Promise<Record<string, any>> {
  const post = ['/api/v1.0/quote/snapshot', '/api/v1.0/quote/stock-quote', '/api/v1.0/quote/stock-basicinfo', '/api/v1.0/quote/combo-option-quote'].includes(args.path);
  const get = /^\/api\/v1\.0\/quote\/US\.[A-Z][A-Z0-9.]*\/(?:option-chain|history-kline|option-volatility|corporate-actions\/dividends)$/.test(args.path);
  if (!post && !get || post !== (args.body !== undefined)) throw new Error('Unsupported read-only market-data request');
  const fetchImpl = args.fetchImpl ?? fetch;
  const request = { path: args.path, query: args.query, method: post ? 'POST' as const : 'GET' as const,
    body: args.body ? JSON.stringify(args.body) : undefined, credentials: args.credentials, fetchImpl };
  let raw = await moomooRequest(request) as Record<string, unknown>;
  if (raw?.errcode === CLOCK_SKEW) {
    const timestampMs = await serverTimeMs(fetchImpl, args.credentials);
    if (timestampMs) raw = await moomooRequest({ ...request, timestampMs }) as Record<string, unknown>;
  }
  if (raw?.ret_code !== 0 || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    throw new BrokerParseError('Connected broker market data unavailable or not authorized');
  }
  return raw.data as Record<string, any>;
}

/** Trade positions omit contract size; obtain it from exact-code static metadata. */
async function fetchOptionBasicInfo(
  positions: MooMooEnvelope, credentials: MooMooCredentials, fetchImpl: typeof fetch,
  history: Record<string, unknown>[] = [],
): Promise<Record<string, unknown>[]> {
  const codes = [...new Set([...(Array.isArray(positions.d) ? positions.d : []), ...history].flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const code = String(row.code ?? '').trim();
    const symbol = code.slice(code.indexOf('.') + 1);
    const hasMultiplier = row.contract_size != null || row.lot_size != null ||
      row.option_contract_multiplier != null || row.multiplier != null;
    return code.includes('.') && looksLikeOptionCode(symbol) && !hasMultiplier ? [code] : [];
  }))];
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < codes.length; start += 400) {
    const args = { path: '/api/v1.0/quote/stock-basicinfo', method: 'POST' as const,
      body: JSON.stringify({ code_list: codes.slice(start, start + 400) }), credentials, fetchImpl };
    let raw: Record<string, unknown>;
    try {
      raw = await moomooRequest(args) as Record<string, unknown>;
      if (raw?.errcode === CLOCK_SKEW) {
        const timestampMs = await serverTimeMs(fetchImpl, credentials);
        if (timestampMs) raw = await moomooRequest({ ...args, timestampMs }) as Record<string, unknown>;
      }
    } catch (error) {
      // Quote permissions are separate from trading-history access. Historical
      // fills can retain unknown size; the mapper still rejects missing held size.
      if (error instanceof BrokerHttpError && ['403','404'].includes(error.vendorCode ?? '')) continue;
      throw error;
    }
    const data = raw?.data as { basic_list?: unknown } | undefined;
    // Expired instruments can disappear from the quote directory. Preserve their fills.
    // The common resolver may still have exact parent-leg metadata. The mapper
    // rejects missing current-held size before snapshot replacement.
    if (raw?.ret_code === -7) continue;
    if (raw?.ret_code !== 0 || !Array.isArray(data?.basic_list)) {
      throw new BrokerParseError('MooMoo option contract metadata unavailable; snapshot was not applied.');
    }
    rows.push(...data.basic_list.filter((row): row is Record<string, unknown> =>
      row !== null && typeof row === 'object' && !Array.isArray(row)));
  }
  return rows;
}

async function serverTimeMs(fetchImpl: typeof fetch, credentials: MooMooCredentials): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${apiOrigin(credentials)}/api/v1.0/server-time`);
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
  const server = await serverTimeMs(args.fetchImpl, args.credentials);
  if (!server) return first;
  return moomooGet({ ...args, timestampMs: server });
}

/** Read all pages, rather than silently truncating at the default 50 fills / 90 days. */
async function fetchHistory(accId: string, credentials: MooMooCredentials, fetchImpl: typeof fetch,
  plan: BrokerHistorySyncPlan, resource: 'fills_history' | 'orders_history') {
  // Closed-only accounts must retain history too, even with no current options.
  const markets = ['US', 'HK'];
  const start = String(BigInt(Date.parse(plan.from)) * 1000n);
  const end = String(BigInt(Date.parse(plan.through)) * 1000n);
  const rows: Record<string, unknown>[] = [];
  for (const market of markets) {
    let pageFlag = '';
    const seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 1000) throw new BrokerParseError('MooMoo fill history exceeded the page limit; snapshot was not applied.');
      const args = { path: `/api/v1.0/accounts/${encodeURIComponent(accId)}/${resource}`,
        query: new URLSearchParams({ trd_market: market, start, end, page_flag: pageFlag, page_size: '50' }).toString(),
        credentials, fetchImpl };
      let env: MooMooEnvelope;
      for (let attempt = 0; ; attempt++) {
        try { env = await getWithSkewRetry(args); failIfError(env,resource); break; }
        catch (error) {
          if (!(error instanceof BrokerHttpError) || !['429','-12011'].includes(error.vendorCode ?? '') || attempt >= 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
      const data = env.d as { order_fills?: unknown; orders?: unknown; completed?: unknown; page_flag?: unknown } | undefined;
      const pageRows = resource === 'fills_history' ? data?.order_fills : data?.orders;
      if (!Array.isArray(pageRows) || typeof data?.completed !== 'boolean' ||
          pageRows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new BrokerParseError(`MooMoo ${resource} response is incomplete; snapshot was not applied.`);
      }
      rows.push(...pageRows as Record<string, unknown>[]);
      if (data.completed) break;
      if (typeof data.page_flag !== 'string' || !data.page_flag || seen.has(data.page_flag)) {
        throw new BrokerParseError('MooMoo fill history pagination did not advance; snapshot was not applied.');
      }
      seen.add(data.page_flag);
      pageFlag = data.page_flag;
    }
  }
  return { start, end, rows };
}

async function fetchOrderDetails(accId: string, orders: Record<string, unknown>[], credentials: MooMooCredentials, fetchImpl: typeof fetch) {
  const rows: Record<string, unknown>[] = [], gaps: NonNullable<MooMooRawBundle['history_gaps']> = [];
  for (const exchange of ['US','HK']) {
    const ids = [...new Set(orders.filter(o => String(o.exchange ?? String(o.code).split('.')[0]) === exchange).map(o => String(o.order_id)))];
    for (let start = 0; start < ids.length; start += 50) {
      const requested = ids.slice(start,start+50);
      const args = { path:`/api/v1.0/accounts/${encodeURIComponent(accId)}/orders/detail`, method:'POST' as const,
        body:JSON.stringify({ exchange, order_ids:requested }), credentials, fetchImpl };
      try {
        let result: MooMooEnvelope | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            let env = asEnvelope(await moomooRequest(args));
            if (env.errcode === CLOCK_SKEW) {
              const timestampMs = await serverTimeMs(fetchImpl, credentials);
              if (timestampMs) env = asEnvelope(await moomooRequest({ ...args, timestampMs }));
            }
            failIfError(env,'orders/detail'); result = env; break;
          } catch (error) {
            if (!(error instanceof BrokerHttpError) || !['429','-12011'].includes(error.vendorCode ?? '') || attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve,1000 * 2 ** attempt));
          }
        }
        if (!Array.isArray(result?.d)) throw new BrokerParseError('Order details missing');
        for (const row of result.d) {
          if (!row || typeof row !== 'object' || Array.isArray(row) || !requested.includes(String(row.order_id))) throw new BrokerParseError('Unexpected order details');
        }
        rows.push(...result.d);
        for (const id of requested) if (!result.d.some(r => String(r.order_id) === id)) gaps.push({ reference:id, reason:'Historical parent-order details are unavailable.' });
      } catch {
        for (const id of requested) gaps.push({ reference:id, reason:'Historical parent-order details could not be fetched; retry on the next sync.' });
      }
    }
  }
  return { rows, gaps };
}

async function fetchOrderFees(accId: string, orders: Record<string, unknown>[], fills: Record<string, unknown>[],
  credentials: MooMooCredentials, fetchImpl: typeof fetch) {
  const rows: Record<string, unknown>[] = [], gaps: NonNullable<MooMooRawBundle['fee_gaps']> = [];
  const ids = [...new Set([...fills, ...orders.filter(o => Number(o.dealt_qty) > 0)]
    .flatMap(row => typeof row.order_id === 'string' && row.order_id.trim() ? [row.order_id] : []))];
  for (const [index,id] of ids.entries()) {
    // Cloud quota is 100 requests/minute per IP. Leave headroom for history
    // requests, and handle the HTTP-200 rate-limit envelope as well as HTTP 429.
    if (index) await new Promise(resolve => setTimeout(resolve,650));
    try {
      let env: MooMooEnvelope;
      for (let attempt = 0; ; attempt++) {
        try {
          env = await getWithSkewRetry({ path:`/api/v1.0/accounts/${encodeURIComponent(accId)}/orders/${encodeURIComponent(id)}/fees`,
            credentials, fetchImpl });
          failIfError(env, 'order fees'); break;
        } catch (error) {
          if (!(error instanceof BrokerHttpError) || !['429','-12011'].includes(error.vendorCode ?? '') || attempt >= 3) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        }
      }
      if (!env.d || typeof env.d !== 'object' || Array.isArray(env.d)) throw new BrokerParseError('Missing order fees');
      const row = env.d as Record<string, unknown>;
      const currencies = new Set(orders.filter(o => o.order_id === id && typeof o.currency === 'string' && o.currency.trim())
        .map(o => String(o.currency)));
      const orderCurrency = currencies.size === 1 ? [...currencies][0] : undefined;
      parseMooMooOrderFees(row, id, accId, orderCurrency);
      rows.push(row);
    } catch {
      gaps.push({ reference:id, reason:'Order fees unavailable or invalid; retry with a later sync (Full sync for older orders).' });
    }
  }
  return { rows, gaps };
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
  opts?: { fetchImpl?: typeof fetch; history?: BrokerHistorySyncPlan },
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
  const plan = opts?.history ?? { mode:'full', from:'2000-01-01T00:00:00.000Z', through:new Date().toISOString() };
  const fills_history = await fetchHistory(acc_id, credentials, fetchImpl, plan, 'fills_history');
  const orders_history = await fetchHistory(acc_id, credentials, fetchImpl, plan, 'orders_history');
  // Recent fills may belong to orders created before the incremental window.
  const parents = [...orders_history.rows, ...fills_history.rows.filter(row => row.order_id != null)];
  const details = await fetchOrderDetails(acc_id, parents, credentials, fetchImpl);
  const fees = await fetchOrderFees(acc_id,
    [...orders_history.rows, ...details.rows], fills_history.rows, credentials, fetchImpl);
  const option_basicinfo = await fetchOptionBasicInfo(positions, credentials, fetchImpl, fills_history?.rows);
  return {
    schema: credentials.broker === 'futubull' ? 'invage.futubull.cloud.raw.v1' : 'invage.moomoo.raw.v1',
    fetched_at: new Date().toISOString(),
    acc_id,
    authorized,
    funds,
    positions,
    ...(option_basicinfo.length ? { option_basicinfo } : {}),
    ...(fills_history ? { fills_history } : {}),
    orders_history,
    orders_details:details.rows,
    history_mode:plan.mode,
    history_gaps:details.gaps,
    orders_fees:fees.rows,
    fee_gaps:fees.gaps,
  };
}
