import type {
  AdapterTransport,
  BrokerConnectorAdapter,
  BrokerRawPayload,
} from '../brokers/adapter.js';
import { BrokerParseError } from '../brokers/errors.js';
import { fetchMooMooRawBundle, type MooMooCredentials } from './moomoo-client.js';
import { mapMooMooBundleToStatement } from './moomoo-map.js';
import { parseSignAlg } from './moomoo-sign.js';
import type { MooMooRawBundle } from './moomoo-types.js';

function credentialsFrom(raw: Record<string, string>): MooMooCredentials {
  const creds: MooMooCredentials = {
    app_key: raw.app_key ?? '',
    private_key: raw.private_key ?? '',
    sign_alg: parseSignAlg(raw.sign_alg),
  };
  if (raw.acc_id?.trim()) creds.acc_id = raw.acc_id.trim();
  return creds;
}

function fetchImpl(opts?: { transport?: AdapterTransport }): typeof fetch {
  const t = opts?.transport;
  if (t?.kind === 'http') return t.fetch;
  return fetch;
}

export const moomooAdapter: BrokerConnectorAdapter = {
  id: 'moomoo',
  usesCsvTables: false,
  async fetchRaw(credentials, opts) {
    const bundle = await fetchMooMooRawBundle(credentialsFrom(credentials), {
      fetchImpl: fetchImpl(opts),
    });
    return { kind: 'json', body: Buffer.from(JSON.stringify(bundle)), meta: { acc_id: bundle.acc_id } };
  },
  parseToStatement(raw: BrokerRawPayload, channel: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.body.toString('utf8'));
    } catch {
      throw new BrokerParseError('MooMoo raw body is not JSON.');
    }
    return mapMooMooBundleToStatement(parsed as MooMooRawBundle, channel);
  },
};
