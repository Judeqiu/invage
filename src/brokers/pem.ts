import { createPrivateKey } from 'node:crypto';

/** Normalize a pasted PEM (newlines, escaped \\n, or headerless base64). */
export function normalizePem(value: string): string {
  let s = value.trim();
  if (!s) throw new Error('Private key is required.');
  if (s.includes('\\n') && !s.includes('\n')) s = s.replace(/\\n/g, '\n');
  if (!/BEGIN /.test(s)) {
    const b64 = s.replace(/\s+/g, '');
    if (!b64) throw new Error('Private key is required.');
    const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
    for (const header of ['PRIVATE KEY', 'RSA PRIVATE KEY'] as const) {
      const pem = `-----BEGIN ${header}-----\n${wrapped}\n-----END ${header}-----`;
      try {
        createPrivateKey(pem);
        return pem;
      } catch {
        /* try next header */
      }
    }
    throw new Error('Private key is not a valid PKCS#8 or PKCS#1 PEM.');
  }
  try {
    createPrivateKey(s);
    return s;
  } catch {
    throw new Error('Private key is not a valid PKCS#8 or PKCS#1 PEM.');
  }
}
