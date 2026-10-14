import { listRawData, fetchRawData, type RawFile } from '../raw-data/store.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { buildOptionRelationships, buildOptionVerticalSpreads, groupOptionRelationships, parseRelationshipArchive,
  type RollFill } from '../brokers/option-relationships.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { addDecimals } from '../brokers/option-executions.js';
import { assertBrokerHistory,verifiedHistoryMultipliers } from '../brokers/history.js';

const cache = new Map<string, RollFill[]>();
const MAX_ARCHIVES = 500;
const MAX_BYTES = 100 * 1024 * 1024;
function readArchive(user: string, file: RawFile): Buffer {
  if (file.bytes > 10 * 1024 * 1024) throw new Error('Archive exceeds the relationship reader size limit');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < file.bytes;) {
    const page = fetchRawData(user, file.id, file.version, offset, 65536, 'base64');
    chunks.push(Buffer.from(page.content, 'base64'));
    if (page.next_offset == null) break; offset = page.next_offset;
  }
  return Buffer.concat(chunks);
}
export interface RelationshipFilters { channel?: string; q?: string; evidence?: string; from?: string; to?: string; asOf?: string; }

/** Tenant-scoped, read-only archive backfill. No broker calls or current-lot restrictions. */
export function optionRelationshipsForState(state: InvestorState, filters: RelationshipFilters = {}) {
  const files: RawFile[] = [];
  for (let offset = 0;;) {
    const page = listRawData(state.user.id, offset, 100);
    files.push(...page.files);
    if (files.length > 5000) throw new Error('Too many retained files to scan safely');
    if (page.next_offset == null) break; offset = page.next_offset;
  }
  const connections = Object.values(readBrokerAccountModel(state).connections).filter(c => c.account_id &&
    ['ibkr', 'tiger', 'moomoo', 'webull'].includes(c.broker_id));
  const groups = []; const spreads = []; const historyGaps: Array<{ channel: string; reason: string; blocksTotals?: boolean }> = [];
  const gaps: Array<{ channel: string; source: string | null; reason: string }> = [];
  const coverage: Array<{ channel: string; broker_id: string; account_id: string; label: string;
    archives: number; history_available: boolean; first_trade: string | null; last_trade: string | null }> = [];
  let archives = 0, bytes = 0;
  for (const conn of connections) {
    if (filters.channel && conn.channel !== filters.channel) continue;
    const retained = state.broker_history?.[conn.channel];
    let verifiedMultipliers: Map<string,string> | undefined;
    if (retained && retained.account_id === conn.account_id) {
      const history = assertBrokerHistory(retained);
      verifiedMultipliers = verifiedHistoryMultipliers(history);
      for (const gap of history.sync.gaps) historyGaps.push({ channel:conn.channel, reason:gap.reason + (gap.reference ? ` (${gap.reference})` : '') });
      if (!history.sync.full_history_synced && !history.sync.gaps.length) historyGaps.push({ channel:conn.channel, reason:'Full available broker history has not been synced.' });
    }
    const selected = files.filter(f => (f.channel === conn.channel && f.source_kind === 'broker-sync' ||
      conn.channel === conn.broker_id && conn.broker_id === 'moomoo' && /^moomoo-executions\/[^/]+-moomoo\.json$/.test(f.id)) &&
      /\.(xml|json)$/.test(f.id) && !f.id.endsWith('-before.json'));
    archives += selected.length; bytes += selected.reduce((sum, f) => sum + f.bytes, 0);
    if (archives > MAX_ARCHIVES || bytes > MAX_BYTES) throw new Error('Retained history exceeds the relationship scan limit; narrow the broker filter');
    const fills: RollFill[] = [];
    let reconciliationBlocked = false;
    for (const file of selected) {
      const key = JSON.stringify([state.user.id, conn.channel, conn.account_id, file.id, file.version, [...(verifiedMultipliers ?? [])]]);
      try {
        let parsed = cache.get(key);
        if (!parsed) {
          parsed = parseRelationshipArchive(conn.broker_id, readArchive(state.user.id, file), conn.account_id!, { id: file.id, version: file.version }, verifiedMultipliers);
          if (cache.size >= 128) cache.delete(cache.keys().next().value!);
          cache.set(key, parsed);
        }
        fills.push(...parsed);
      } catch (error) {
        if (error instanceof Error && /correction|Changed|Conflicting|mismatch|needs reconciliation|disagrees/.test(error.message)) reconciliationBlocked = true;
        gaps.push({ channel: conn.channel, source: file.id,
          reason: error instanceof Error ? error.message : 'Archive could not be read' });
      }
    }
    if (fills.length > 250_000) throw new Error('Retained executions exceed the relationship scan limit');
    const trades = fills.filter(f => !f.terminal).map(f => f.at).sort();
    const recorded = new Map((state.option_executions ?? []).filter(e => e.channel === conn.channel && e.account_id === conn.account_id).map(e => [e.execution_id, e]));
    const missing = new Set(fills.filter(f => !f.terminal && (!filters.asOf || f.at.slice(0, 10) <= filters.asOf) && !recorded.has(f.id)).map(f => f.id));
    if (missing.size) historyGaps.push({ channel: conn.channel, reason: `${missing.size} archived option fills are missing from imported history. Refresh the broker or import a complete execution statement with contract metadata.` });
    const conflicts = new Set(fills.filter(f => {
      const e = recorded.get(f.id);
      if (!e || f.terminal || filters.asOf && f.at.slice(0, 10) > filters.asOf) return false;
      const gross = f.gross_cash ?? (f.basis === 'gross' ? f.cash : null);
      return e.side !== f.side || f.effect !== 'unknown' && e.effect !== f.effect ||
        e.executed_at !== f.at || e.underlying !== f.contract.underlying || e.right !== f.contract.right ||
        e.expiry !== f.contract.expiry || Number(e.strike) !== Number(f.contract.strike) ||
        e.currency !== f.contract.currency || Number(e.contracts) !== Number(f.quantity) ||
        gross != null && Number(e.multiplier) !== Number(f.contract.multiplier) ||
        gross != null && !/^0(?:\.0+)?$/.test(addDecimals(e.gross_premium, gross.startsWith('-') ? gross.slice(1) : `-${gross}`));
    }).map(f => f.id));
    if (conflicts.size) {
      historyGaps.push({ channel: conn.channel, blocksTotals: true, reason: `${conflicts.size} imported option fills disagree with archived broker records and need reconciliation.` });
      reconciliationBlocked = true;
    }
    if (!selected.length || !trades.length || gaps.some(g => g.channel === conn.channel)) historyGaps.push({ channel: conn.channel, reason: 'Retained option history could not be fully verified.' });
    coverage.push({ channel: conn.channel, broker_id: conn.broker_id, account_id: conn.account_id!,
      label: conn.label || conn.broker_id.toUpperCase(), archives: selected.length, history_available: trades.length > 0,
      first_trade: trades[0] ?? null, last_trade: trades.at(-1) ?? null });
    if (!trades.length) gaps.push({ channel: conn.channel, source: null, reason: 'No usable option execution history in the retained archives' });
    if (reconciliationBlocked) {
      historyGaps.push({ channel: conn.channel, blocksTotals: true, reason: 'Conflicting or corrected archive evidence needs reconciliation.' });
      gaps.push({ channel: conn.channel, source: null, reason: 'Relationships withheld until conflicting or corrected archive evidence is reconciled' });
      continue;
    }
    try {
      const all = buildOptionRelationships(conn.broker_id, conn.channel, conn.account_id!, fills);
      spreads.push(...buildOptionVerticalSpreads(conn.channel, conn.account_id!, fills).filter(s => !filters.asOf || s.through.slice(0, 10) <= filters.asOf));
      // Never expose future trades in a snapshot replay. Group only the resulting visible links.
      const visible = all.filter(r => (!filters.asOf || r.through.slice(0, 10) <= filters.asOf) &&
        (!filters.from || r.at.slice(0, 10) >= filters.from) && (!filters.to || r.through.slice(0, 10) <= filters.to) &&
        (!filters.evidence || r.evidence === filters.evidence) &&
        (!filters.q || `${r.old.underlying} ${r.old.strike} ${r.old.expiry} ${r.replacement.strike} ${r.replacement.expiry}`.toUpperCase().includes(filters.q.toUpperCase())));
      groups.push(...groupOptionRelationships(visible, fills));
    } catch (error) {
      historyGaps.push({ channel: conn.channel, blocksTotals: true, reason: 'Archived option executions could not be reconciled.' });
      gaps.push({ channel: conn.channel, source: null, reason: error instanceof Error ? error.message : 'Relationship reconciliation failed' });
    }
  }
  groups.sort((a, b) => b.last_at.localeCompare(a.last_at) || a.id.localeCompare(b.id));
  return { groups, spreads, historyGaps, coverage, gaps, as_of: filters.asOf ?? null,
    connections: connections.map(c => ({ channel: c.channel, broker_id: c.broker_id,
      account_id: c.account_id!, label: c.label || c.broker_id.toUpperCase() })) };
}
