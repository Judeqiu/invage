import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { mergeOptionExecutions } from './option-executions.js';
/**
 * Channel snapshot apply — writes only public books types
 * (Holding, CashBalance, optional connection metrics).
 * Connector id selects the catalog channel; it does not choose a vendor schema.
 */


import {
  booksPostAdjustment,
  booksPostHoldingClose,
  booksPostHoldingOpen,
  booksPostOpeningBalance,
  isBooksEnabled,
} from '../books/index.js';
import type { Holding } from '../market/types.js';
import {
  assertHolding,
  buildHoldingKey,
  normalizeOptionalChannel,
} from '../market/position-value.js';
import {
  cashSlotKey,
  findCashForSlot,
  findCashesForChannel,
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
    const holding: Holding = { ...lot.holding, channel };
    const mapKey = buildHoldingKey(lot.ticker, channel);
    assertHolding(mapKey, holding);
    return { mapKey, holding, currency: lot.currency };
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

export async function applyBrokerStatement(
  snapshot: InvestorSnapshot,
  connectorId: string,
  doc: BrokerStatement,
  _raw?: Buffer,
  beforeSave?: (result: BrokerApplyResult) => void,
): Promise<BrokerApplyResult> {
  const { state } = snapshot;
  const def = getBrokerConnector(connectorId);
  const channel = def.channel;
  // Validate all incoming history before ledger writes or snapshot mutation.
  const executions = doc.option_executions === undefined ? undefined : mergeOptionExecutions(
    state.option_executions === undefined ? [] : state.option_executions,
    doc.option_executions,
  );
  if (doc.option_executions?.some(row => row.channel !== channel || row.account_id !== doc.account_id)) {
    throw new Error('Execution channel/account differs from broker statement');
  }
  const stamped = stampLots(doc.lots, channel);
  const portfolio = { ...getPortfolio(state) };
  const { next, removedKeys } = replaceChannelHoldings(portfolio, stamped, channel);
  const today = doc.as_of;
  const existing = getPortfolio(state);
  const removed = removedKeys.filter((k) => !stamped.some((l) => l.mapKey === k)).length;

  if (isBooksEnabled()) {
    for (const key of removedKeys) {
      const holding = existing[key];
      if (!holding) continue;
      if (stamped.some((l) => l.mapKey === key)) continue;
      await booksPostHoldingClose(state, {
        mapKey: key,
        holding,
        valueDate: today,
        adjustCash: false,
      });
    }
    for (const lot of stamped) {
      const prior = existing[lot.mapKey];
      if (prior && isChannelLot(prior, channel)) {
        await booksPostHoldingClose(state, {
          mapKey: lot.mapKey,
          holding: prior,
          valueDate: today,
          adjustCash: false,
        });
      }
      await booksPostHoldingOpen(state, {
        mapKey: lot.mapKey,
        holding: lot.holding,
        purchaseUnits: lot.holding.units,
        purchaseAvg: lot.holding.avg_price,
        valueDate: today,
        adjustCash: false,
        currency: lot.currency,
      });
    }
    const incoming = new Set(doc.cash.map((row) => row.currency));
    for (const prior of findCashesForChannel(getCashes(state), channel)) {
      if (incoming.has(prior.currency)) continue;
      if (prior.amount !== 0) {
        await booksPostAdjustment(state, {
          amount: -prior.amount,
          currency: prior.currency,
          channel,
          valueDate: today,
          memo: `Broker ${channel} statement ${today} close ${prior.currency}`,
          contra: 'adjustment',
        });
      }
    }
    for (const row of doc.cash) {
      const prior = findCashForSlot(getCashes(state), channel, row.currency);
      if (!prior) {
        await booksPostOpeningBalance(state, {
          amount: row.amount,
          currency: row.currency,
          channel,
          valueDate: today,
          memo: `Broker ${channel} statement ${today} opening ${row.currency}`,
        });
      } else {
        const delta = row.amount - prior.amount;
        if (delta !== 0) {
          await booksPostAdjustment(state, {
            amount: delta,
            currency: row.currency,
            channel,
            valueDate: today,
            memo: `Broker ${channel} statement ${today} reconcile`,
            contra: 'adjustment',
          });
        }
      }
    }
  }

  setPortfolio(state, next);
  if (!isBooksEnabled()) {
    setCashes(state, replaceChannelCash(getCashes(state), doc.cash, channel, today));
  }
  writeConnectionMetrics(state, connectorId, doc);
  if (executions !== undefined) state.option_executions = executions;

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
