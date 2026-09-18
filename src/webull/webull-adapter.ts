import type {
  AdapterTransport,
  BrokerConnectorAdapter,
  BrokerRawPayload,
} from '../brokers/adapter.js';
import { BrokerParseError } from '../brokers/errors.js';
import { fetchWebullRawBundle, parseWebullRegion, type WebullCredentials } from './webull-client.js';
import { mapWebullBundleToStatement } from './webull-map.js';
import type { WebullRawBundle } from './webull-types.js';

function credentialsFrom(raw: Record<string, string>): WebullCredentials {
  const creds: WebullCredentials = {
    app_key: raw.app_key ?? '',
    app_secret: raw.app_secret ?? '',
    region: parseWebullRegion(raw.region),
  };
  if (raw.account_id?.trim()) creds.account_id = raw.account_id.trim();
  if (raw.access_token?.trim()) creds.access_token = raw.access_token.trim();
  return creds;
}

function fetchImpl(opts?: { transport?: AdapterTransport }): typeof fetch {
  const t = opts?.transport;
  if (t?.kind === 'http') return t.fetch;
  return fetch;
}

export const webullAdapter: BrokerConnectorAdapter = {
  id: 'webull',
  usesCsvTables: false,
  async fetchRaw(credentials, opts) {
    const bundle = await fetchWebullRawBundle(credentialsFrom(credentials), {
      fetchImpl: fetchImpl(opts),
    });
    return {
      kind: 'json',
      body: Buffer.from(JSON.stringify(bundle)),
      meta: { host: bundle.host, account_id: bundle.account_id },
    };
  },
  parseToStatement(raw: BrokerRawPayload, channel: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.body.toString('utf8'));
    } catch {
      throw new BrokerParseError('Webull raw body is not JSON.');
    }
    return mapWebullBundleToStatement(parsed as WebullRawBundle, channel);
  },
};
