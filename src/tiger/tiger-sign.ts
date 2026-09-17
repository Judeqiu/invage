import { createPrivateKey, createSign, createVerify } from 'node:crypto';
import { tigerPublicKeyForHost } from './tiger-keys.js';

export function shanghaiTimestamp(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

/** Sort remaining keys (exclude sign) lexicographically; join key=value with &. */
export function tigerSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] != null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function signTigerRequest(params: Record<string, string>, privateKeyPem: string): string {
  const content = tigerSignContent(params);
  const signer = createSign('SHA1');
  signer.update(content, 'utf8');
  return signer.sign(createPrivateKey(privateKeyPem), 'base64');
}

export function verifyTigerResponse(args: {
  hostname: string;
  content: string;
  sign: string;
}): boolean {
  const verifier = createVerify('SHA1');
  verifier.update(args.content, 'utf8');
  return verifier.verify(tigerPublicKeyForHost(args.hostname), args.sign, 'base64');
}
