import type { BrokerConnectorAdapter } from '../brokers/adapter.js';
import { BrokerParseError } from '../brokers/errors.js';
import { fetchFutubullSnapshot } from './futubull-client.js';
import { mapFutubullSnapshot } from './futubull-map.js';

export const futubullAdapter: BrokerConnectorAdapter = {
  id: 'futubull',
  usesCsvTables: false,
  async fetchRaw(credentials) {
    const bundle = await fetchFutubullSnapshot({ opend_port: credentials.opend_port,
      security_firm: credentials.security_firm, acc_id: credentials.acc_id });
    return { kind: 'json', body: Buffer.from(JSON.stringify(bundle)), meta: { account_id: String(bundle.acc_id ?? '') } };
  },
  parseToStatement(raw, channel) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.body.toString('utf8')); }
    catch { throw new BrokerParseError('Futubull raw body is not JSON.'); }
    return mapFutubullSnapshot(parsed, channel);
  },
};
