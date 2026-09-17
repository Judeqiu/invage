/**
 * Pull a catalog connector statement into recon without applying books.
 * Already-have Flex: fetch now; compare happens in sourceReconStatement.
 * Never loadBrokerParserSpec / runCsvTablesSpec — Flex XML parse only for IBKR.
 */

import {
  getBrokerAdapter,
  type AdapterTransport,
} from '../brokers/adapter.js';
import { BROKER_CATALOG, getBrokerConnector } from '../brokers/catalog.js';
import {
  ChannelOffError,
  readBrokerConnections,
  requiredCredentialsComplete,
} from '../brokers/connections.js';
import type { BrokerStatement } from '../brokers/statement.js';
import { cashSlotKey, holdingInstrument, type InvestorState } from '../state/portfolio-state.js';
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
  transport?: AdapterTransport,
): Promise<void> {
  const ch = cashSlotKey(channel);
  const conns = readBrokerConnections(state);
  const match = BROKER_CATALOG.find((d) => cashSlotKey(d.channel) === ch);
  if (!match) {
    if (ch === 'jude_futu') {
      throw new Error(
        'No catalog connector for channel jude_futu. Connector moomoo fetches Cloud Open API into channel moomoo only. It never reads jude_futu. To move Futu-tagged lots onto moomoo, recon the jude_futu sleeve (paste or update_holding) and the moomoo sleeve (connector fetch) separately. take on one does not delete the other. Fixed deposits stay on their channel; broker sync does not mature or move FDs. Paste the statement (cash, lots, deposits).',
      );
    }
    throw new Error(
      `No catalog connector for channel ${ch || '(unassigned)'}. Paste the statement (cash, lots, deposits).`,
    );
  }
  const conn = conns[match.id];
  if (!conn?.enabled) {
    throw new ChannelOffError(match.displayName);
  }
  const def = getBrokerConnector(match.id);
  if (!requiredCredentialsComplete(def, conn.credentials)) {
    throw new Error(
      `${def.displayName} is on but credentials are incomplete. Finish Settings → Brokers or paste the statement.`,
    );
  }
  const adapter = getBrokerAdapter(match.id);
  const raw = await adapter.fetchRaw(
    conn.credentials,
    transport ? { transport } : undefined,
  );
  const brokerStmt = adapter.parseToStatement(raw, def.channel);
  sourceReconStatement(state, channel, reconStatementFromBroker(brokerStmt), 'connector');
}
