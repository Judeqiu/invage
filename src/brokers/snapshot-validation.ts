import type { BrokerSkip, BrokerStatement } from './statement.js';
import type { BrokerHistory } from './history.js';

/** Report history gaps after reconciliation with retained account evidence. */
export function reconciledHistorySkips(skipped: BrokerSkip[], incoming?: BrokerHistory, reconciled?: BrokerHistory): BrokerSkip[] {
  if (!incoming || !reconciled) return skipped;
  return skipped.filter(skip => !incoming.sync.gaps.some(gap =>
    gap.kind === 'metadata' && skip.kind === 'event' && gap.reference === (skip.symbol ?? null) && gap.reason === skip.reason &&
    !reconciled.sync.gaps.some(current => current.kind === gap.kind && current.reference === gap.reference && current.reason === gap.reason)));
}

export function invalidCashSkip(currency?: string): BrokerSkip {
  return {kind:'cash', defer:'cash', ...(currency ? {currency} : {}),
    reason:currency
      ? 'Broker cash amount is unavailable or unreadable. This currency retains its previous balance and date, if available; its balance remains unknown otherwise.'
      : 'Broker cash currency is unavailable or unreadable. The previous cash snapshot is retained with its original dates; no cash from this response was applied.'};
}

/** An unidentifiable cash row can affect any currency, so retain the whole set.
 * With identifiable gaps, update only independently readable currencies and
 * retain every unreported sleeve; absence in a partial response never means zero.
 */
export function cashSnapshotPolicy(statement: Pick<BrokerStatement, 'cash' | 'skipped' | 'cash_omitted'>) {
  const gaps = statement.skipped.filter(skip => skip.defer === 'cash');
  const unavailable = new Set(gaps.map(skip => skip.currency?.trim().toUpperCase()));
  const all = [...unavailable].some(currency => !currency || !/^[A-Z]{3,4}$/.test(currency));
  return { partial:gaps.length > 0 || !!statement.cash_omitted?.length, all,
    cash:all ? [] : statement.cash.filter(row => !unavailable.has(row.currency)) };
}

export function invalidCostSkip(symbol?: string): BrokerSkip {
  return {kind:'position', defer:'positions', ...(symbol ? {symbol} : {}),
    reason:'Broker explicitly marks the reported cost basis invalid. The previous position snapshot is retained; no position quantities or costs from this response were applied.'};
}

export function deferredSnapshotSections(skipped: BrokerSkip[]): Array<'cash'|'positions'> {
  return [...new Set(skipped.flatMap(skip => skip.defer ? [skip.defer] : []))];
}
