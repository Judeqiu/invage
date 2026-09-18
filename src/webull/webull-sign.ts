import { createHash, createHmac } from 'node:crypto';

/** Percent-encode like Python urllib.parse.quote(s, safe=''): unreserved A-Za-z0-9-._~ only. */
export function rfc3986Encode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function webullSignContent(args: {
  path: string;
  query: Record<string, string>;
  host: string;
  appKey: string;
  timestamp: string;
  nonce: string;
  body?: string;
}): string {
  const params: Record<string, string> = {
    ...args.query,
    'x-app-key': args.appKey,
    'x-timestamp': args.timestamp,
    'x-signature-algorithm': 'HMAC-SHA256',
    'x-signature-version': '1.0',
    'x-signature-nonce': args.nonce,
    host: args.host,
  };
  const str1 = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  let str3 = `${args.path}&${str1}`;
  if (args.body) {
    str3 += `&${createHash('sha256').update(args.body).digest('hex').toUpperCase()}`;
  }
  return rfc3986Encode(str3);
}

export function signWebullRequest(encoded: string, appSecret: string): string {
  return createHmac('sha256', `${appSecret}&`).update(encoded, 'utf8').digest('base64');
}
