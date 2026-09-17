import type {
  AdapterTransport,
  BrokerConnectorAdapter,
  BrokerRawPayload,
} from '../brokers/adapter.js';
import { BrokerParseError } from '../brokers/errors.js';
import { fetchTigerRawBundle, type TigerCredentials } from './tiger-client.js';
import { mapTigerBundleToStatement } from './tiger-map.js';
import type { TigerRawBundle } from './tiger-types.js';

function credentialsFrom(raw: Record<string, string>): TigerCredentials {
  const creds: TigerCredentials = {
    tiger_id: raw.tiger_id ?? '',
    account: raw.account ?? '',
    license: raw.license ?? '',
    private_key: raw.private_key ?? '',
  };
  if (raw.token?.trim()) creds.token = raw.token.trim();
  if (raw.secret_key?.trim()) creds.secret_key = raw.secret_key.trim();
  return creds;
}

function fetchImpl(opts?: { transport?: AdapterTransport }): typeof fetch {
  const t = opts?.transport;
  if (t?.kind === 'http') return t.fetch;
  return fetch;
}

export const tigerAdapter: BrokerConnectorAdapter = {
  id: 'tiger',
  usesCsvTables: false,
  async fetchRaw(credentials, opts) {
    const bundle = await fetchTigerRawBundle(credentialsFrom(credentials), {
      fetchImpl: fetchImpl(opts),
    });
    return { kind: 'json', body: Buffer.from(JSON.stringify(bundle)), meta: { gateway: bundle.gateway } };
  },
  parseToStatement(raw: BrokerRawPayload, channel: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.body.toString('utf8'));
    } catch {
      throw new BrokerParseError('Tiger raw body is not JSON.');
    }
    return mapTigerBundleToStatement(parsed as TigerRawBundle, channel);
  },
};
