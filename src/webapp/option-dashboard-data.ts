import type { OptionExecution } from '../brokers/option-executions.js';
import type { Holding } from '../market/types.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import type { OptionLifecycleEvent } from '../brokers/option-events.js';

export interface OpenOptionTradeDetail {
  openedFrom: string;
  openedTo: string;
  /** Net proceeds from the still-open STO fills, including their allocated commissions. */
  stoNetPremium: number | null;
  /** Opening proceeds before fees, when the broker omits commissions. */
  stoGrossPremium?: number;
  currency: string | null;
}

function sameContract(row: Pick<OptionExecution, 'channel' | 'account_id' | 'underlying' | 'right' | 'expiry' | 'strike' | 'multiplier'> & { contract_id?: string }, holding: Holding, accountId?: string): boolean {
  const option = holding.option;
  if (!option || row.channel !== holding.channel || accountId && row.account_id !== accountId) return false;
  if (holding.broker_ref?.native_id && row.contract_id !== holding.broker_ref.native_id) return false;
  let underlying: string;
  try { underlying = canonicalOptionUnderlying(option.underlying, option); }
  catch { return false; }
  return row.underlying.trim().toUpperCase() === underlying &&
    row.right === option.right && row.expiry === option.expiry &&
    Number(row.strike) === option.strike && Number(row.multiplier) === option.multiplier;
}

/** Match outstanding contracts to their opening fills; a quantity gap means history is incomplete. */
export function openOptionTradeDetails(
  portfolio: Record<string, Holding>,
  executions: OptionExecution[] | undefined,
  accountsByChannel: Record<string, string> = {},
  events: OptionLifecycleEvent[] = [],
): Record<string, OpenOptionTradeDetail> {
  if (!executions?.length) return {};
  const out: Record<string, OpenOptionTradeDetail> = {};
  for (const [key, holding] of Object.entries(portfolio)) {
    if (holding.instrument !== 'option' || !holding.option || !holding.channel) continue;
    const channel = holding.channel;
    const short = holding.option.side === 'short';
    const rows = executions.filter(row => sameContract(row, holding, accountsByChannel[channel]))
      .sort((a, b) => a.executed_at.localeCompare(b.executed_at) || a.execution_id.localeCompare(b.execution_id));
    if (new Set(rows.map(row => row.account_id)).size > 1) continue;
    const terminal = events.filter(event => sameContract(event, holding, accountsByChannel[channel]) &&
      (event.kind !== 'assignment' || short) && (event.kind !== 'exercise' || !short));
    if (new Set([...rows, ...terminal].map(row => row.account_id)).size > 1) continue;
    const timeline = [...rows.map(row => ({ at: row.executed_at, id: row.execution_id, row })),
      ...terminal.map(event => ({ at: `${event.date}T23:59:59`, id: event.id, row: {
        ...event, executed_at: `${event.date}T23:59:59`, effect: 'close' as const, side: short ? 'buy' as const : 'sell' as const,
        gross_premium: '0', commission: null,
      } }))].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const lots: Array<{ date: string; remaining: number; netPerContract: number | null; grossPerContract: number; currency: string }> = [];
    let invalid = false;
    for (const { row } of timeline) {
      const opening = row.effect === 'open' && row.side === (short ? 'sell' : 'buy');
      const closing = row.effect === 'close' && row.side === (short ? 'buy' : 'sell');
      if (!opening && !closing) continue;
      const contracts = Number(row.contracts);
      if (!Number.isFinite(contracts) || contracts <= 0) { invalid = true; break; }
      if (opening) {
        lots.push({ date: row.executed_at.slice(0, 10), remaining: contracts,
          netPerContract: row.commission === null ? null : (Number(row.gross_premium) + Number(row.commission)) / contracts,
          grossPerContract: Number(row.gross_premium) / contracts,
          currency: row.currency });
      } else {
        let toClose = contracts;
        for (const lot of lots) {
          const used = Math.min(lot.remaining, toClose);
          lot.remaining -= used;
          toClose -= used;
          if (toClose < 1e-9) break;
        }
        if (toClose > 1e-9) { invalid = true; break; }
      }
    }
    const open = lots.filter(lot => lot.remaining > 1e-9);
    const remaining = open.reduce((sum, lot) => sum + lot.remaining, 0);
    if (invalid || !open.length || Math.abs(remaining - holding.units) > 1e-9) continue;
    if (new Set(open.map(lot => lot.currency)).size !== 1) continue;
    out[key] = {
      openedFrom: open[0].date,
      openedTo: open[open.length - 1].date,
      stoNetPremium: short && open.every(lot => lot.netPerContract !== null)
        ? open.reduce((sum, lot) => sum + lot.remaining * lot.netPerContract!, 0) : null,
      ...(short && open.some(lot => lot.netPerContract === null)
        ? { stoGrossPremium: open.reduce((sum, lot) => sum + lot.remaining * lot.grossPerContract, 0) } : {}),
      currency: short ? open[0].currency : null,
    };
  }
  return out;
}
