import { applyFlexStatement, type FlexApplyResult } from '../ibkr/flex-apply.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { getBrokerConnector } from './catalog.js';
import { flexDocFromBrokerStatement, type BrokerStatement } from './statement.js';

export async function applyBrokerStatement(
  state: InvestorState,
  connectorId: string,
  doc: BrokerStatement,
  raw?: Buffer,
): Promise<FlexApplyResult> {
  const def = getBrokerConnector(connectorId);
  if (def.id !== 'ibkr') {
    throw new Error(
      `Broker connector "${connectorId}" has no apply path yet. Catalog apply is IBKR-only until the next connector ships.`,
    );
  }
  return applyFlexStatement(state, flexDocFromBrokerStatement(doc), raw);
}
