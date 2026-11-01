import { formatBrokerSkip, HISTORY_PENDING_REASON, HISTORY_REVIEW_REASON } from './statement.js';
import { reconcileExecutionEffects } from './execution-effects.js';
import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import { mergeOptionExecutions } from './option-executions.js';
import { mergeOptionLifecycleEvents } from './option-events.js';
import { appendOptionObservation } from './option-history.js';
import { normalizeBrokerOptionLot } from './statement.js';
import { cashSnapshotPolicy, deferredSnapshotSections, invalidCashSkip, reconciledHistorySkips } from './snapshot-validation.js';
import { mergeBrokerHistory, optionExecutionsFromHistory } from './history.js';
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
  partial = false,
): CashBalance[] {
  const ch = cashSlotKey(channel);
  const reported = new Set(sleeves.map(row => row.currency));
  const kept = cashes.filter((c) => cashSlotKey(c.channel) !== ch || partial && !reported.has(c.currency));
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
    ? state.broker_connections[connectorId].last_sync.positions_as_of ?? state.broker_connections[connectorId].last_sync.as_of : undefined;
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
  observation?: { syncId?: string; observedAt?: string; rawDataId?: string; deferHistoryConflicts?: boolean; historyError?: string; requireCompleteSnapshot?: boolean },
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
  if (observation?.requireCompleteSnapshot) {
    const blocking = doc.skipped.filter(s => (s.kind === 'position' || s.kind === 'cash') && s.blocking !== false && !s.defer);
    if (blocking.length) throw new Error('Broker current snapshot is incomplete; retained the previous holdings and cash for automatic retry. Details: ' + blocking.map(formatBrokerSkip).join('; '));
  }
  const channel = connection?.channel ?? getBrokerConnector(connectorId).channel;
  const priorCash = getCashes(state).filter(row => cashSlotKey(row.channel) === cashSlotKey(channel));
  // An empty optional group is normal on first observation. Once this account
  // has reported that currency, its disappearance is a real freshness gap.
  const missingKnown = (doc.cash_omitted ?? []).filter(currency => priorCash.some(row => row.currency === currency));
  if (missingKnown.length) doc = {...doc, skipped:[...doc.skipped,
    ...missingKnown.filter(currency => !doc.skipped.some(skip => skip.defer === 'cash' && skip.currency === currency)).map(invalidCashSkip)]};
  const deferred = deferredSnapshotSections(doc.skipped);
  const cashPolicy = cashSnapshotPolicy(doc);
  const keepCash = cashPolicy.all, keepPositions = deferred.includes('positions');
  const priorSync = state.broker_connections?.[connectorId]?.last_sync;
  const priorPositionDate = priorSync?.positions_as_of ?? (priorSync?.snapshot_deferred?.includes('positions') ? undefined : priorSync?.as_of) ?? (state.option_observations ?? [])
    .filter(row => row.connection_id === connectorId && row.source === 'broker')
    .map(row => row.as_of).sort().at(-1);
  const positionsAsOf = keepPositions ? priorPositionDate : doc.as_of;
  assertStatementNotOlder(state, connectorId, channel, doc.as_of);
  const updatingCash = new Set(cashPolicy.cash.map(row => row.currency));
  if (!keepCash && priorCash.some(row => (!cashPolicy.partial || updatingCash.has(row.currency)) && row.updated_at > doc.as_of)) throw new Error('Broker cash statement is older than retained cash; balances were not replaced.');
  // All adapters and custom parsers pass through this before any books writes.
  doc = { ...doc, lots: doc.lots.map(normalizeBrokerOptionLot) };
  if (doc.history && (doc.history.channel !== channel || doc.history.account_id !== doc.account_id || doc.history.broker_id !== (connection?.brokerId ?? connectorId))) throw new Error('History broker/channel/account differs from broker statement');
  // Prepare observation history on a copy, so replay conflicts fail before
  // ledger writes and a failed books transaction leaves the snapshot untouched.
  const observedState = { ...state };
  if (!keepPositions) appendOptionObservation(observedState, {
    statement: doc, brokerId: connection?.brokerId ?? connectorId,
    connectionId: connectorId, channel,
    syncId: observation?.syncId, observedAt: observation?.observedAt,
    rawDataId: observation?.rawDataId,
  });

  // Account binding remains a hard boundary; only historical enrichment can be deferred.
  if (doc.option_executions?.some(row => row.channel !== channel || row.account_id !== doc.account_id) ||
      doc.option_events?.some(row => row.channel !== channel || row.account_id !== doc.account_id || row.broker_id !== (connection?.brokerId ?? connectorId))) {
    throw new Error('Historical evidence differs from broker statement account/channel');
  }
  let history: BrokerStatement['history'];
  let executions: BrokerStatement['option_executions'];
  let optionEvents: BrokerStatement['option_events'];
  let historyError: string | undefined = observation?.historyError;
  let historyReconciliationDeferred = false;
  try {
    optionEvents = doc.option_events === undefined ? undefined : mergeOptionLifecycleEvents(state.option_events ?? [], doc.option_events);
    history = doc.history ? reconcileExecutionEffects(mergeBrokerHistory(state.broker_history?.[channel], doc.history),
      observedState.option_observations ?? [], optionEvents ?? state.option_events ?? []) : undefined;
    // History has proved the whole-order fee allocation above. Keep its retained
    // rounding remainder in the option projection too, but only if the source
    // option fee agrees exactly with that same source history execution.
    const retainedFees = new Map(history?.executions.map(row => [row.id, row.fee_cash]));
    const sourceFees = new Map(doc.history?.executions.map(row => [row.id, row.fee_cash]));
    const optionInput = doc.option_executions?.map(row => row.commission !== null &&
      sourceFees.get(row.execution_id) === row.commission && retainedFees.get(row.execution_id) != null
      ? { ...row, commission: retainedFees.get(row.execution_id)! } : row);
    const incoming = history ? mergeOptionExecutions(optionInput ?? [], optionExecutionsFromHistory(history)) : optionInput;
    executions = incoming === undefined ? undefined : mergeOptionExecutions(state.option_executions ?? [], incoming);
    // Share the validated classification across both database projections. Merging
    // above has checked identity, quantities, time and all reported money first.
    if (history && executions) {
      const byId = new Map(executions.filter(e => e.channel === channel && e.account_id === doc.account_id).map(e => [e.execution_id, e]));
      history.executions = history.executions.map(e => byId.has(e.id) ? { ...e, effect: byId.get(e.id)!.effect } : e);
    }
  } catch (error) {
    if (!observation?.deferHistoryConflicts || !observation.rawDataId) throw error;
    historyError = error instanceof Error ? error.message : String(error);
    historyReconciliationDeferred = true;
    history = undefined; executions = undefined; optionEvents = undefined;
  }
  const stamped = stampLots(doc.lots, channel);
  // The raw parser may lack expired-contract metadata already verified in the
  // retained history. Only a successful account-bound merge resolves its notice.
  doc = { ...doc, skipped: reconciledHistorySkips(doc.skipped, doc.history, history) };
  if (new Set(stamped.map((lot) => lot.mapKey)).size !== stamped.length) {
    throw new Error(`Broker statement has duplicate lot keys on channel ${channel}.`);
  }
  const portfolio = { ...getPortfolio(state) };
  const { next, removedKeys } = keepPositions ? {next:portfolio,removedKeys:[]} : replaceChannelHoldings(portfolio, stamped, channel);
  const today = doc.as_of;
  const existing = getPortfolio(state);
  const removed = removedKeys.filter((k) => !stamped.some((l) => l.mapKey === k)).length;

  if (isBooksEnabled()) {
    const fingerprint = createHash('sha256').update(_raw ?? JSON.stringify(doc)).digest('hex');
    await booksApplyBrokerSnapshot(state, channel, doc, stamped,
      `broker:${connectorId}:${doc.account_id}:${today}:${fingerprint}`);
  }

  if (observedState.option_observations !== undefined) state.option_observations = observedState.option_observations;
  setPortfolio(state, next);
  if (!keepCash) setCashes(state, replaceChannelCash(getCashes(state), cashPolicy.cash, channel, today, cashPolicy.partial));
  writeConnectionMetrics(state, connectorId, doc);
  if (executions !== undefined) state.option_executions = executions;
  if (optionEvents !== undefined) state.option_events = optionEvents;
  if (history) state.broker_history = { ...state.broker_history, [channel]: history };

  if (historyError) state.log.push({ ts: today, action: 'broker_history_deferred',
    connector_id: connectorId, account_id: doc.account_id, reason: historyError,
    raw_data_id: observation!.rawDataId!, sync_id: observation!.syncId ?? '',
  });
  state.log.push({
    ts: today,
    action: 'broker_sync',
    connector_id: connectorId,
    account_id: doc.account_id,
    lots: keepPositions ? 0 : stamped.length,
    removed,
    not_imported: doc.skipped.length,
  });
  const retentionNotes: BrokerApplyResult['skipped'] = [];
  if (keepCash) retentionNotes.push({kind:'event',reason:priorCash.length
    ? `Cash update deferred. Retained cash dates: ${priorCash.map(row => `${row.currency} ${row.updated_at}`).join('; ')}. Automatic retry is queued.`
    : 'Cash update deferred. No previous verified cash balance is available; cash remains unknown. Automatic retry is queued.'});
  else if (deferred.includes('cash')) {
    const retained = priorCash.filter(row => !updatingCash.has(row.currency));
    const missing = [...new Set(doc.skipped.filter(skip => skip.defer === 'cash').map(skip => skip.currency!))]
      .filter(currency => !priorCash.some(row => row.currency === currency));
    retentionNotes.push({kind:'event',reason:`Cash updated only for readable currencies: ${cashPolicy.cash.map(row => row.currency).join(', ') || 'none'}.` +
      (retained.length ? ` Retained cash dates: ${retained.map(row => `${row.currency} ${row.updated_at}`).join('; ')}.` : '') +
      (missing.length ? ` Cash remains unknown: ${missing.join(', ')}; no zero balance was substituted.` : '') +
      ' Unavailable cash will be retried at the next sync.'});
  }
  if (keepPositions) retentionNotes.push({kind:'event',reason:priorPositionDate
    ? `Position update deferred. Retained positions are from ${priorPositionDate}; they are not a current snapshot. Automatic retry is queued.`
    : 'Position update deferred. No previous verified position snapshot is available. Automatic retry is queued.'});
  const appliedCash = getCashes(state).filter(row => cashSlotKey(row.channel) === cashSlotKey(channel));
  const verifiedDates = [positionsAsOf, ...appliedCash.map(row => row.updated_at)].filter((date):date is string => !!date).sort();
  const result: BrokerApplyResult = {
    accountId: doc.account_id,
    asOf: deferred.length ? verifiedDates[0] ?? today : today,
    ...(positionsAsOf ? {positionsAsOf} : {}),
    ...(deferred.length ? {deferred} : {}),
    channel,
    lotsUpserted: keepPositions ? 0 : stamped.length,
    lotsRemoved: removed,
    cash: appliedCash.map(({currency,amount,settled_amount,accrued_interest}) => ({currency,amount,
      ...(settled_amount !== undefined ? {settled_amount} : {}), ...(accrued_interest !== undefined ? {accrued_interest} : {})})),
    skipped: historyReconciliationDeferred
      ? [...doc.skipped.filter(s => s.reason !== HISTORY_PENDING_REASON), { kind: 'event', reason: HISTORY_REVIEW_REASON }]
      : historyError && !doc.skipped.some(s=>s.reason===HISTORY_PENDING_REASON) ? [...doc.skipped, { kind: 'event', reason: HISTORY_PENDING_REASON }] : doc.skipped,
    ...(historyReconciliationDeferred ? { historyReconciliationDeferred: true as const } : {}),
    ...(history ? { historySync:history.sync } : {}),
  };
  result.skipped = [...result.skipped, ...retentionNotes];
  if (beforeSave) beforeSave(result);
  await saveInvestor(snapshot);
  return result;
}
