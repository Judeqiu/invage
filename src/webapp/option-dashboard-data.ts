import type { OptionExecution } from '../brokers/option-executions.js';
import type { Holding } from '../market/types.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import type { OptionLifecycleEvent } from '../brokers/option-events.js';
import type { OptionRelationship, OptionVerticalSpread } from '../brokers/option-relationships.js';

export interface OpenOptionTradeDetail {
  openedFrom: string;
  openedTo: string;
  openingExecutionIds: string[];
  /** Net proceeds from the still-open STO fills, including their allocated commissions. */
  stoNetPremium: number | null;
  /** Opening proceeds before fees, using the same basis across every broker. */
  stoGrossPremium?: number;
  currency: string | null;
  entrySpot?: { price: number; date: string; basis: 'execution' | 'adjusted_close' };
  rollPremium?: number | null;
  rollDate?: string;
  openingGrossPremium?: number;
  spread?: { id: string; grossPremium: number | null; quantity: number; longStrike: number; shortStrike: number };
}

function sameContract(row: Pick<OptionExecution, 'channel' | 'account_id' | 'underlying' | 'right' | 'expiry' | 'strike' | 'multiplier'> & { contract_id?: string }, holding: Holding, accountId?: string): boolean {
  const option = holding.option;
  if (!option || row.channel !== holding.channel || accountId && row.account_id !== accountId) return false;
  // Webull position IDs identify a holding cycle, not an option contract.
  if (holding.broker_ref?.native_id && !row.contract_id?.startsWith('webull:') && row.contract_id !== holding.broker_ref.native_id) return false;
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
    const lots: Array<{ id: string; date: string; remaining: number; netPerContract: number | null; grossPerContract: number; currency: string }> = [];
    let invalid = false;
    for (const { row } of timeline) {
      if (!['open', 'close'].includes(row.effect)) { invalid = true; break; }
      const opening = row.effect === 'open' && row.side === (short ? 'sell' : 'buy');
      const closing = row.effect === 'close' && row.side === (short ? 'buy' : 'sell');
      if (!opening && !closing) continue;
      const contracts = Number(row.contracts);
      if (!Number.isFinite(contracts) || contracts <= 0) { invalid = true; break; }
      if (opening) {
        lots.push({ id: row.execution_id, date: row.executed_at.slice(0, 10), remaining: contracts,
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
      openingExecutionIds: open.map(lot => lot.id),
      stoNetPremium: short && open.every(lot => lot.netPerContract !== null)
        ? open.reduce((sum, lot) => sum + lot.remaining * lot.netPerContract!, 0) : null,
      ...(short
        ? { stoGrossPremium: open.reduce((sum, lot) => sum + lot.remaining * lot.grossPerContract, 0) } : {}),
      currency: short ? open[0].currency : null,
    };
    if (!short) {
      out[key].openingGrossPremium = open.reduce((sum, lot) => sum + lot.remaining * lot.grossPerContract, 0);
      out[key].currency = open[0].currency;
    }
  }
  return out;
}

/** Attach a strategy only when both complete current lots reconcile to the same opening order. */
export function attachOpenVerticalSpreads(portfolio: Record<string, Holding>, details: Record<string, OpenOptionTradeDetail>, spreads: OptionVerticalSpread[], accounts: Record<string, string> = {}) {
  for (const spread of spreads) {
    const keys = (side: 'long' | 'short') => Object.keys(details).filter(key => {
      const holding = portfolio[key], detail = details[key];
      return holding.option?.side === side && holding.units === Number(spread.quantity) &&
        detail.openedFrom === spread.at.slice(0, 10) && detail.openedTo === spread.through.slice(0, 10) &&
        sameContract({ ...spread[side], channel: spread.channel, account_id: spread.account_id }, { ...holding, broker_ref: undefined }, accounts[spread.channel]);
    });
    const long = keys('long'), short = keys('short');
    if (long.length !== 1 || short.length !== 1) continue;
    const ids = [...details[long[0]].openingExecutionIds, ...details[short[0]].openingExecutionIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify([...spread.opening_fills].sort())) continue;
    // Reopened/multiple same-day orders cannot be assigned to today's lots by dates alone.
    if (spreads.filter(s => s.channel === spread.channel && s.account_id === spread.account_id &&
      s.long.expiry === spread.long.expiry && s.long.strike === spread.long.strike &&
      s.short.strike === spread.short.strike && s.long.underlying === spread.long.underlying &&
      s.through.slice(0, 10) === spread.through.slice(0, 10)).length !== 1) continue;
    for (const key of [...long, ...short]) details[key].spread = { id: spread.id,
      grossPremium: spread.gross_cash == null ? null : Number(spread.gross_cash), quantity: Number(spread.quantity),
      longStrike: Number(spread.long.strike), shortStrike: Number(spread.short.strike) };
  }
}

/** Attach only reconciled latest replacement cash flow; never promote candidate links. */
export function attachLatestRollPremium(portfolio: Record<string, Holding>, details: Record<string, OpenOptionTradeDetail>, relationships: OptionRelationship[], accounts: Record<string, string> = {}) {
  for (const [key, detail] of Object.entries(details)) {
    const holding = portfolio[key];
    if (holding.option?.side !== 'short') continue;
    const matches = relationships.filter(r => r.channel === holding.channel && r.side === 'short' &&
      r.replacement_effect === 'open' && sameContract({ ...r.replacement, channel: r.channel, account_id: r.account_id }, { ...holding, broker_ref: undefined }, accounts[r.channel]) &&
      r.through.slice(0, 10) >= detail.openedFrom && r.through.slice(0, 10) <= detail.openedTo);
    const latest = matches.sort((a, b) => b.through.localeCompare(a.through))[0];
    if (!latest) continue;
    detail.rollDate = latest.through.slice(0, 10);
    detail.rollPremium = ['order', 'execution'].includes(latest.evidence) &&
      Number(latest.opened_quantity) === holding.units && detail.openedFrom === detail.openedTo
      && JSON.stringify([...detail.openingExecutionIds].sort()) === JSON.stringify([...(latest.opening_fills ?? [])].sort())
      ? latest.gross_cash == null ? null : Number(latest.gross_cash) : null;
  }
}
