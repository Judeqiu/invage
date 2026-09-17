import { createHash, createPrivateKey, createSign, randomBytes, sign } from 'node:crypto';

export type MooMooSignAlg = 'Ed25519' | 'RSA-SHA256';

export function parseSignAlg(raw: string | undefined): MooMooSignAlg {
  const t = (raw ?? 'Ed25519').trim();
  if (!t || t.toLowerCase() === 'ed25519') return 'Ed25519';
  if (t === 'RSA-SHA256' || t.toLowerCase() === 'rsa-sha256' || t.toLowerCase() === 'rsa') {
    return 'RSA-SHA256';
  }
  throw new Error(`Signature algorithm must be Ed25519 or RSA-SHA256 (got "${raw}").`);
}

export function moomooNonce(): string {
  return randomBytes(16).toString('hex');
}

/** 5 fields joined by \\n. Trailing newline before empty body_part is required. */
export function moomooSignContent(args: {
  timestampMs: string;
  method: string;
  path: string;
  query: string;
  body: Buffer | string | undefined;
}): string {
  const bodyPart =
    args.body && Buffer.byteLength(args.body) > 0
      ? createHash('sha256').update(args.body).digest('hex')
      : '';
  return `${args.timestampMs}\n${args.method.toUpperCase()}\n${args.path}\n${args.query}\n${bodyPart}`;
}

export function signMooMooRequest(content: string, privateKeyPem: string, alg: MooMooSignAlg): string {
  const key = createPrivateKey(privateKeyPem);
  if (alg === 'Ed25519') {
    return sign(null, Buffer.from(content, 'utf8'), key).toString('base64');
  }
  const signer = createSign('SHA256');
  signer.update(content, 'utf8');
  return signer.sign(key, 'base64');
}
