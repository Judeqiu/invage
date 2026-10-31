import type { BrokerSkip } from './statement.js';

export function invalidCashSkip(currency?: string): BrokerSkip {
  return {kind:'cash', defer:'cash', ...(currency ? {currency} : {}),
    reason:'Broker cash currency or amount is unavailable or unreadable. The previous cash snapshot is retained with its original dates; no cash from this response was applied.'};
}

export function invalidCostSkip(symbol?: string): BrokerSkip {
  return {kind:'position', defer:'positions', ...(symbol ? {symbol} : {}),
    reason:'Broker explicitly marks the reported cost basis invalid. The previous position snapshot is retained; no position quantities or costs from this response were applied.'};
}

export function deferredSnapshotSections(skipped: BrokerSkip[]): Array<'cash'|'positions'> {
  return [...new Set(skipped.flatMap(skip => skip.defer ? [skip.defer] : []))];
}
