/**
 * Pull a catalog connector statement into recon without applying books.
 * Already-have Flex: fetch now; compare happens in sourceReconStatement.
 */

import { ChannelOffError, readBrokerConnections } from '../brokers/connections.js';
import { BROKER_CATALOG, getBrokerConnector } from '../brokers/catalog.js';
import { holdingInstrument } from '../state/portfolio-state.js';
import type { BrokerStatement } from '../brokers/statement.js';
import {
  createFlexTransport,
  fetchFlexStatement,
  type FlexTransport,
} from '../ibkr/flex-client.js';
import { mapFlexDocToStatement } from '../ibkr/flex-map.js';
import { parseFlexQueryXml } from '../ibkr/flex-parse.js';
import { cashSlotKey, type InvestorState } from '../state/portfolio-state.js';
import { sourceReconStatement } from './apply.js';
import type { ReconStatement } from './types.js';

export function reconStatementFromBroker(stmt: BrokerStatement): ReconStatement {
  return {
    cash: stmt.cash.map((c) => ({ currency: c.currency, amount: c.amount })),
    lots: stmt.lots.map((l) => ({
      ticker: l.ticker.trim().toUpperCase(),
      units: l.holding.units,
      avg_price: l.holding.avg_price,
      instrument: holdingInstrument(l.holding),
    })),
    deposits: [],
  };
}

export async function sourceReconConnector(
  state: InvestorState,
  channel: string,
  transport?: FlexTransport,
): Promise<void> {
  const ch = cashSlotKey(channel);
  const conns = readBrokerConnections(state);
  const match = BROKER_CATALOG.find((d) => cashSlotKey(d.channel) === ch);
  if (!match) {
    throw new Error(
      `No catalog connector for channel ${ch || '(unassigned)'}. Paste the statement (cash, lots, deposits).`,
    );
  }
  const conn = conns[match.id];
  if (!conn?.enabled) {
    throw new ChannelOffError(match.displayName);
  }
  const def = getBrokerConnector(match.id);
  const queryField = def.syncQueryFieldId;
  if (!queryField) {
    throw new Error(`Broker connector "${match.id}" has no sync query field.`);
  }
  const queryId = conn.credentials[queryField];
  const token = conn.credentials.token;
  if (!queryId || !token) {
    throw new Error(
      `${def.displayName} is on but credentials are incomplete. Finish Settings → Brokers or paste the statement.`,
    );
  }
  const xml = await fetchFlexStatement({ token, queryId }, transport ?? createFlexTransport());
  const doc = parseFlexQueryXml(xml);
  const brokerStmt = mapFlexDocToStatement(doc, def.channel);
  sourceReconStatement(state, channel, reconStatementFromBroker(brokerStmt), 'connector');
}
