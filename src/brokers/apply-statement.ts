import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { mergeOptionExecutions } from './option-executions.js';
import { mergeOptionLifecycleEvents } from './option-events.js';
import { appendOptionObservation } from './option-history.js';
import { createHash } from 'node:crypto';
/**
 * Channel snapshot apply — writes only public books types
 * (Holding, CashBalance, optional connection metrics).
 * Connector id selects the catalog channel; it does not choose a vendor schema.
 */


import { isBooksEnabled } from '../books/index.js';
import { booksApplyBrokerSnapshot } from '../books/broker-snapshot.js';
import { assertCurrency } from '../books/money.js';
import type { Holding } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  normalizeOptionalChannel,
} from '../market/position-value.js';
import {
  cashSlotKey,
  getCashes,
  getPortfolio,
  setCashes,
  setPortfolio,
  type CashBalance,
  type InvestorState,
} from '../state/portfolio-state.js';
import { getBrokerConnector } from './catalog.js';
import type {
  BrokerApplyResult,
  BrokerCashSleeve,
  BrokerLot,
  BrokerStatement,
} from './statement.js';

export function replaceChannelCash(
  cashes: CashBalance[],
  sleeves: BrokerCashSleeve[],
  channel: string,
  updatedAt: string,
): CashBalance[] {
  const ch = cashSlotKey(channel);
  const kept = cashes.filter((c) => cashSlotKey(c.channel) !== ch);
  return [
    ...kept,
    ...sleeves.map((row) => {
      const entry: CashBalance = {
        amount: row.amount,
        currency: row.currency,
        updated_at: updatedAt,
        channel,
      };
      if (row.settled_amount != null) entry.settled_amount = row.settled_amount;
      if (row.accrued_interest != null) entry.accrued_interest = row.accrued_interest;
      return entry;
    }),
  ];
}

function isChannelLot(holding: { channel?: string }, channel: string): boolean {
  return normalizeOptionalChannel(holding.channel, 'channel') === channel;
}

export function replaceChannelHoldings(
  portfolio: Record<string, Holding>,
  lots: Array<{ mapKey: string; holding: Holding }>,
  channel: string,
): {
  next: Record<string, Holding>;
  removedKeys: string[];
} {
  const removedKeys = Object.keys(portfolio).filter((k) => isChannelLot(portfolio[k], channel));
  const kept: Record<string, Holding> = {};
  for (const [k, h] of Object.entries(portfolio)) {
    if (!isChannelLot(h, channel)) kept[k] = h;
  }
  const next = { ...kept };
  for (const lot of lots) {
    next[lot.mapKey] = lot.holding;
  }
  return { next, removedKeys };
}

function stampLots(lots: BrokerLot[], channel: string): Array<{ mapKey: string; holding: Holding; currency: string }> {
  return lots.map((lot, i) => {
    const existingCh = normalizeOptionalChannel(lot.holding.channel, `lots[${i}].holding.channel`);
    if (existingCh != null && existingCh !== channel) {
      throw new Error(
        `Broker statement lots[${i}] (${lot.ticker}) channel "${existingCh}" does not match connector channel "${channel}".`,
      );
    }
    const currency = assertCurrency(lot.currency);
    if (lot.holding.currency != null && lot.holding.currency !== currency) {
      throw new Error(`Broker statement lots[${i}] currency differs from holding currency.`);
    }
    const holding: Holding = { ...lot.holding, channel, currency };
    const mapKey = buildHoldingKey(lot.ticker, channel);
    assertHolding(mapKey, holding);
    return { mapKey, holding, currency };
  });
}

function writeConnectionMetrics(state: InvestorState, connectorId: string, statement: BrokerStatement): void {
  if (statement.metrics == null) return;
  const raw = state.broker_connections;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw) || raw[connectorId] == null) {
    throw new Error(
      `Broker statement metrics require broker_connections.${connectorId} to already exist.`,
    );
  }
  const conn = raw[connectorId];
  if (conn == null || typeof conn !== 'object' || Array.isArray(conn)) {
    throw new Error(`broker_connections.${connectorId} must be an object.`);
  }
  (conn as { metrics?: BrokerStatement['metrics'] }).metrics = statement.metrics;
}

export function assertStatementNotOlder(
  state: Pick<InvestorState, 'broker_connections' | 'option_observations'>,
  connectorId: string,
  channel: string,
  asOf: string,
): void {
  const previousAsOf = state.broker_connections?.[connectorId]?.last_sync?.ok
    ? state.broker_connections[connectorId].last_sync.as_of : undefined;
  const observedAsOf = (state.option_observations ?? [])
    .filter(row => row.connection_id === connectorId && row.source === 'broker')
    .reduce<string | undefined>((latest, row) => !latest || row.as_of > latest ? row.as_of : latest, undefined);
  const latestAsOf = [previousAsOf, observedAsOf].filter((date): date is string => Boolean(date)).sort().at(-1);
  if (latestAsOf && asOf < latestAsOf) {
    throw new Error(`Broker statement as of ${asOf} is older than the current ${channel} position date ${latestAsOf}; open holdings were not replaced.`);
  }
}

export async function applyBrokerStatement(
  snapshot: InvestorSnapshot,
  connectorId: string,
  doc: BrokerStatement,
  _raw?: Buffer,
  beforeSave?: (result: BrokerApplyResult) => void,
  connection?: { brokerId: string; channel: string },
  observation?: { syncId?: string; observedAt?: string; rawDataId?: string },
): Promise<BrokerApplyResult> {
  const { state } = snapshot;
  if (state.broker_sources && !connection) throw new Error('Account connection ID and channel are required for broker apply.');
  if (connection) {
    const stored = state.broker_connections?.[connectorId];
    if (!stored || !('broker_id' in stored) || stored.broker_id !== connection.brokerId ||
        stored.channel !== connection.channel || stored.account_id !== doc.account_id) {
      throw new Error('Broker statement account/channel differs from selected connection.');
    }
  }
  const channel = connection?.channel ?? getBrokerConnector(connectorId).channel;
  assertStatementNotOlder(state, connectorId, channel, doc.as_of);
  // Validate all incoming history before ledger writes or snapshot mutation.
  const executions = doc.option_executions === undefined ? undefined : mergeOptionExecutions(
    state.option_executions === undefined ? [] : state.option_executions,
    doc.option_executions,
  );
  if (doc.option_executions?.some(row => row.channel !== channel || row.account_id !== doc.account_id)) {
    throw new Error('Execution channel/account differs from broker statement');
  }
  const optionEvents = doc.option_events === undefined ? undefined : mergeOptionLifecycleEvents(
    state.option_events === undefined ? [] : state.option_events, doc.option_events);
  if (doc.option_events?.some(row => row.channel !== channel || row.account_id !== doc.account_id ||
      row.broker_id !== (connection?.brokerId ?? connectorId))) {
    throw new Error('Option event broker/channel/account differs from broker statement');
  }
  const stamped = stampLots(doc.lots, channel);
  if (new Set(stamped.map((lot) => lot.mapKey)).size !== stamped.length) {
    throw new Error(`Broker statement has duplicate lot keys on channel ${channel}.`);
  }
  const portfolio = { ...getPortfolio(state) };
  const { next, removedKeys } = replaceChannelHoldings(portfolio, stamped, channel);
  const today = doc.as_of;
  const existing = getPortfolio(state);
  const removed = removedKeys.filter((k) => !stamped.some((l) => l.mapKey === k)).length;

  if (isBooksEnabled()) {
    const fingerprint = createHash('sha256').update(_raw ?? JSON.stringify(doc)).digest('hex');
    await booksApplyBrokerSnapshot(state, channel, doc, stamped,
      `broker:${connectorId}:${doc.account_id}:${today}:${fingerprint}`);
  }

  appendOptionObservation(state, {
    statement: doc, brokerId: connection?.brokerId ?? connectorId,
    connectionId: connectorId, channel,
    syncId: observation?.syncId, observedAt: observation?.observedAt,
    rawDataId: observation?.rawDataId,
  });
  setPortfolio(state, next);
  setCashes(state, replaceChannelCash(getCashes(state), doc.cash, channel, today));
  writeConnectionMetrics(state, connectorId, doc);
  if (executions !== undefined) state.option_executions = executions;
  if (optionEvents !== undefined) state.option_events = optionEvents;

  state.log.push({
    ts: today,
    action: 'broker_sync',
    connector_id: connectorId,
    account_id: doc.account_id,
    lots: stamped.length,
    removed,
    not_imported: doc.skipped.length,
  });
  const result: BrokerApplyResult = {
    accountId: doc.account_id,
    asOf: today,
    channel,
    lotsUpserted: stamped.length,
    lotsRemoved: removed,
    cash: doc.cash,
    skipped: doc.skipped,
  };
  if (beforeSave) beforeSave(result);
  await saveInvestor(snapshot);
  return result;
}
