/**
 * IBKR Flex catalog adapter. Fetch + Flex XML parse only.
 * csv_tables is a syncBrokerConnection overlay (usesCsvTables signal).
 */

import type {
  AdapterTransport,
  BrokerConnectorAdapter,
  BrokerRawPayload,
} from '../brokers/adapter.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import { createFlexTransport, fetchFlexStatement } from './flex-client.js';
import { mapFlexDocToStatement } from './flex-map.js';
import { parseFlexQueryXml } from './flex-parse.js';

function flexTransport(opts?: { transport?: AdapterTransport }) {
  const t = opts?.transport;
  if (t?.kind === 'ibkr') return t.flex;
  return createFlexTransport();
}

export const ibkrFlexAdapter: BrokerConnectorAdapter = {
  id: 'ibkr',
  usesCsvTables: true,
  async fetchRaw(credentials, opts) {
    const queryField = getBrokerConnector('ibkr').syncQueryFieldId;
    if (!queryField) {
      throw new Error('Broker connector "ibkr" has no sync query field.');
    }
    const xml = await fetchFlexStatement(
      { token: credentials.token ?? '', queryId: credentials[queryField] ?? '' },
      flexTransport(opts),
    );
    return { kind: 'xml', body: xml };
  },
  parseToStatement(raw: BrokerRawPayload, channel: string) {
    return mapFlexDocToStatement(parseFlexQueryXml(raw.body), channel);
  },
};
