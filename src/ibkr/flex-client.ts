import {
  FlexProtocolError,
  looksLikeCsv,
  parseFlexQueryXml,
  xmlElementText,
} from './flex-parse.js';

export const FLEX_BASE =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

const TRANSIENT_CODES = new Set([
  '1001',
  '1004',
  '1005',
  '1006',
  '1007',
  '1008',
  '1009',
  '1019',
  '1021',
]);

export class FlexHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`IBKR Flex [${code}] ${message}`);
    this.name = 'FlexHttpError';
  }
}

export interface FlexTransport {
  get(path: 'SendRequest' | 'GetStatement', params: Record<string, string>): Promise<Buffer>;
  sleepMs?(ms: number): Promise<void>;
}

export interface FlexFetchOpts {
  token: string;
  queryId: string;
  fromDate?:string; throughDate?:string;
  pollAttempts?: number;
  pollWaitMs?: number;
  minIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createFlexTransport(userAgent = 'walletstreet-ibkr-flex/1.0'): FlexTransport {
  let lastAt = 0;
  return {
    async get(path, params) {
      const minInterval = 1100;
      const wait = lastAt + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      const url = new URL(`${FLEX_BASE}/${path}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await fetch(url, {
        headers: { 'User-Agent': userAgent },
      });
      lastAt = Date.now();
      if (!res.ok) {
        throw new Error(`IBKR Flex ${path} HTTP ${res.status}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

function envelopeOrReport(buf: Buffer): { kind: 'report' } | { kind: 'error'; err: FlexHttpError } {
  const text = buf.toString('utf8');
  if (text.includes('<FlexQueryResponse')) return { kind: 'report' };
  if (looksLikeCsv(text)) return { kind: 'report' };
  try {
    parseFlexQueryXml(buf);
    return { kind: 'report' };
  } catch (e) {
    if (e instanceof FlexProtocolError) {
      return { kind: 'error', err: new FlexHttpError(e.code, e.message.replace(/^IBKR Flex \[[^\]]+\] /, '')) };
    }
    throw e;
  }
}

export async function fetchFlexStatement(
  opts: FlexFetchOpts,
  transport: FlexTransport,
): Promise<Buffer> {
  const token = opts.token.trim();
  const queryId = opts.queryId.trim();
  if (!token) throw new Error('IBKR Flex token is required.');
  if (!queryId) throw new Error('IBKR Flex query id is required.');
  const pollAttempts = opts.pollAttempts ?? 10;
  const pollWaitMs = opts.pollWaitMs ?? 6000;

  const sendBuf = await transport.get('SendRequest', { t: token, q: queryId, v: '3', ...(opts.fromDate&&opts.throughDate?{fd:opts.fromDate,td:opts.throughDate}:{}) });
  const sendText = sendBuf.toString('utf8');
  const sendStatus = xmlElementText(sendText, 'Status');
  const sendCode = xmlElementText(sendText, 'ErrorCode');
  const sendMessage = xmlElementText(sendText, 'ErrorMessage');
  if (sendStatus === 'Fail' || sendStatus === 'Error' || (sendCode && sendCode !== '0') ||
      sendStatus === 'Warn' && sendMessage && !xmlElementText(sendText, 'ReferenceCode')) {
    throw new FlexHttpError(
      sendCode ?? '?',
      sendMessage ?? 'SendRequest failed',
    );
  }
  const reference = xmlElementText(sendText, 'ReferenceCode');
  if (!reference) {
    if (/<html\b|<!doctype\s+html/i.test(sendText)) throw new Error('IBKR Flex SendRequest returned an HTML page instead of a Flex response.');
    throw new Error(`IBKR Flex SendRequest: missing ReferenceCode${sendStatus ? ` (status ${sendStatus})` : ''}.`);
  }

  for (let attempt = 1; attempt <= pollAttempts; attempt++) {
    const stmt = await transport.get('GetStatement', { t: token, q: reference, v: '3' });
    const classified = envelopeOrReport(stmt);
    if (classified.kind === 'report') return stmt;
    if (!TRANSIENT_CODES.has(classified.err.code) || attempt === pollAttempts) {
      throw classified.err;
    }
    const sleeper = transport.sleepMs ?? sleep;
    await sleeper(pollWaitMs);
  }
  throw new Error(`IBKR Flex GetStatement: not ready after ${pollAttempts} attempts.`);
}
