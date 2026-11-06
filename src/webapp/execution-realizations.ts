import type { buildExecutionJournal, OptionExecution } from '../brokers/option-executions.js';
import { addDecimals, negateDecimal } from '../brokers/option-executions.js';
import type { CloseRealization } from '../brokers/partial-close.js';
import type { TradeJournalRow } from './trades-v2-data.js';

const key = (e: {channel:string;account_id:string;execution_id:string}) => JSON.stringify([e.channel,e.account_id,e.execution_id]);
const equal = (a:string,b:string) => !/[1-9]/.test(addDecimals(a,negateDecimal(b)));
const sameContract = (a:OptionExecution,b:OptionExecution) => a.channel === b.channel && a.account_id === b.account_id &&
  a.contract_id === b.contract_id && a.underlying === b.underlying && a.right === b.right && a.expiry === b.expiry &&
  a.currency === b.currency && equal(a.strike,b.strike) && equal(a.multiplier,b.multiplier);

/** Join already-saved FIFO realizations onto their closing fills. Never calculate
 * profits in the request handler or change the underlying journal/fee totals. */
export function executionJournalWithRealizations(journal:ReturnType<typeof buildExecutionJournal>, history: {
  rows:TradeJournalRow[]; gaps?:unknown[];
}) {
  const fills = new Map(journal.executions.map(e => [key(e),e]));
  const matches = new Map<string,CloseRealization | null>();
  const blocked = new Set(history.gaps?.flatMap(g => g && typeof g === 'object' &&
    'blocksTotals' in g && g.blocksTotals === true && 'channel' in g && typeof g.channel === 'string' ? [g.channel] : []));
  for (const row of history.rows) {
    if (blocked.has(row.channel) || row.realizedPnl === null || !['Closed','Partially closed'].includes(row.status)) continue;
    for (const realization of row.realizations ?? []) {
      const id = key({channel:row.channel,account_id:row.accountId,execution_id:realization.executionId});
      const closing = fills.get(id);
      if (!closing || closing.effect !== 'close' || closing.executed_at.slice(0,10) !== realization.date ||
        !equal(closing.contracts,realization.contracts) || !realization.openingExecutionIds.length) continue;
      const openings = realization.openingExecutionIds.map(execution_id => fills.get(key({...closing,execution_id})));
      if (openings.some(open => !open || open.effect !== 'open' || open.side === closing.side || !sameContract(open,closing))) continue;
      if (matches.has(id)) {
        // A duplicate or conflicting cycle must never choose a profit arbitrarily.
        matches.set(id,null);
      } else matches.set(id,realization);
    }
  }
  return {...journal,executions:journal.executions.map(e => ({...e,realization:matches.get(key(e)) ?? null}))};
}
