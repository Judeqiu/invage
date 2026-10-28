import type { TradeJournalRow } from './trades-v2-data.js';

export function dashboardHistoryStatus(row: TradeJournalRow): string {
  return ({ Closed:'closed_by_fills', Expired:'expired', Assigned:'assigned', Exercised:'exercised',
    'Cash settled':'cash_settled', 'Mixed outcomes':'mixed_outcomes', 'No longer observed':'no_longer_observed',
    Unverified:'unverified', 'Conflicting evidence':'conflicting_evidence', 'Incomplete history':'incomplete',
    Unresolved:'incomplete', 'Open in recorded fills':'open', 'Observed open':'open' } as Record<string,string>)[row.status] ?? 'unverified';
}

/** Section 03 reads the same cycles and retained fills as Trades, including snapshot-only rows. */
export function selectDashboardTradeHistory(rows: TradeJournalRow[], filters: {
  right: string; status: string; from: string; to: string; q: string; asOf: string;
}, matchesScope: (row: TradeJournalRow) => boolean): TradeJournalRow[] {
  return rows.filter(row => {
    const status = dashboardHistoryStatus(row), date = row.lastTrade ?? row.brokerDate ?? row.observedSince ?? '';
    return matchesScope(row) && (!filters.right || row.right === filters.right) &&
      (!filters.status || (filters.status === 'historical' ? status !== 'open' : status === filters.status)) &&
      (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to) &&
      (!filters.asOf || date <= filters.asOf) &&
      (!filters.q || `${row.underlying} ${row.expiry} ${row.strike}`.toUpperCase().includes(filters.q));
  });
}
