import type { BrokerConnectorAdapter } from '../brokers/adapter.js';
import { BrokerParseError } from '../brokers/errors.js';
import { fetchFutubullSnapshot } from './futubull-client.js';
import { createCloudBrokerAdapter } from '../moomoo/moomoo-adapter.js';
import { mapFutubullSnapshot } from './futubull-map.js';

const cloudAdapter = createCloudBrokerAdapter('futubull');

export const futubullAdapter: BrokerConnectorAdapter = {
  id: 'futubull',
  usesCsvTables: false,
  async fetchRaw(credentials,opts) {
    if (credentials.app_key || !credentials.opend_port) return cloudAdapter.fetchRaw(credentials, opts);
    const bundle = await fetchFutubullSnapshot({ opend_port: credentials.opend_port,
      security_firm: credentials.security_firm, acc_id: credentials.acc_id },opts?.history);
    return { kind: 'json', body: Buffer.from(JSON.stringify(bundle)), meta: { account_id: String(bundle.acc_id ?? '') } };
  },
  parseToStatement(raw, channel, includeHistory = true) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.body.toString('utf8')); }
    catch { throw new BrokerParseError('Futubull raw body is not JSON.'); }
    if ((parsed as { schema?: string })?.schema === 'invage.futubull.cloud.raw.v1') {
      return cloudAdapter.parseToStatement(raw, channel, includeHistory = true);
    }
    return mapFutubullSnapshot(parsed, channel, includeHistory);
  },
};
