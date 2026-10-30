import type { BrokerProjection } from '../report/broker-projections.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';
import type { InvestorState } from './portfolio-state.js';
import type { DashboardPayload } from '../webapp/dashboard-data.js';
import type { buildExecutionJournal } from '../brokers/option-executions.js';
import type { tradesOpenBook, tradesHistory } from '../webapp/trades-v2-data.js';
import type { optionHistoryForState } from '../webapp/option-history-data.js';
import type { optionRelationshipsForState } from '../webapp/option-relationships-data.js';

export const PROJECTION_VERSION = 8;
// Rebuild saved calculations when their rules change, retaining daily history.
const CALCULATION_VERSION = 5;
export interface PortfolioProjection {
  version: typeof PROJECTION_VERSION;
  userId: string;
  fingerprint: string;
  calculatedAt: string;
  dailyAggregateHistory?: import('../report/daily-changes.js').DailyAggregateHistory;
  dashboard: DashboardPayload;
  brokers: Record<string, BrokerProjection>;
  journal: ReturnType<typeof buildExecutionJournal>;
  openTrades: ReturnType<typeof tradesOpenBook> & { aggregates: Record<string, { totals: unknown[]; months: Record<string, unknown> }> };
  tradeHistory: ReturnType<typeof tradesHistory> & { gaps: unknown[]; aggregates: Record<string, { totals: unknown[]; months: Record<string, unknown> }> };
  optionHistory: ReturnType<typeof optionHistoryForState>;
  relationships: ReturnType<typeof optionRelationshipsForState>;
}
/** Excludes scheduler claims, logs and journal notes; these do not alter financial aggregates. */
export function portfolioFingerprint(state: InvestorState): string {
  const connections = Object.fromEntries(Object.entries(state.broker_connections ?? {}).map(([id, conn]) => {
    const { sync_schedule, ...rest } = conn as import('./portfolio-state.js').BrokerAccountConnection;
    return [id, rest];
  }));
  let snapshots: unknown = null;
  try {
    const directory = join(resolveDataRoot(), 'drive', state.user.id);
    const index = readFileSync(join(directory, 'snapshots.json'), 'utf8');
    const files: unknown = JSON.parse(index);
    snapshots = [index, Array.isArray(files) ? files.map(file => {
      if (typeof file !== 'string' || !/^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(file)) return null;
      const stat = statSync(join(directory, file), { bigint: true });
      return [file, stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString()];
    }) : null];
  } catch { /* Missing or corrupt snapshot history is reported by the calculation pipeline. */ }
  return createHash('sha256').update(JSON.stringify([PROJECTION_VERSION, CALCULATION_VERSION, state.user.id, state.profile.display_name,
    state.portfolio, state.cash, state.deposits, (state as unknown as { treasury: unknown }).treasury,
    connections, state.broker_history, state.option_executions, state.option_events,
    state.option_observations, state.option_identities, state.broker_statement_evidence, snapshots])).digest('hex');
}
function location(userId: string) {
  const directory = join(resolveDataRoot(), 'derived', 'portfolio');
  const key = createHash('sha256').update(userId).digest('hex');
  return { directory, file: join(directory, key + '.json') };
}
/** Read prior daily checkpoints even when source inputs have changed. Never used to serve page data. */
export function readDailyAggregateHistory(userId: string) {
  try {
    const entry = JSON.parse(readFileSync(location(userId).file, 'utf8')) as PortfolioProjection;
    return entry.userId === userId && entry.version === PROJECTION_VERSION ? entry.dailyAggregateHistory ?? {} : {};
  } catch { return {}; }
}
/** Prior quote evidence only; this unchecked generation must never serve page data. */
export function readPriorQuoteDashboard(userId: string): DashboardPayload | undefined {
  try {
    const entry = JSON.parse(readFileSync(location(userId).file, 'utf8')) as PortfolioProjection;
    return entry.userId === userId && entry.version === PROJECTION_VERSION ? entry.dashboard : undefined;
  } catch { return undefined; }
}
/** Durable private read model: no TTL, eviction, market calls or calculation on reads. */
export function readPortfolioProjection(state: InvestorState): PortfolioProjection | null {
  try {
    const entry = JSON.parse(readFileSync(location(state.user.id).file, 'utf8')) as PortfolioProjection;
    return entry && entry.brokers && entry.dashboard && entry.journal && entry.openTrades && entry.tradeHistory && entry.optionHistory && entry.relationships &&
      typeof entry.calculatedAt === 'string' && entry.version === PROJECTION_VERSION && entry.userId === state.user.id && entry.fingerprint === portfolioFingerprint(state)
      ? entry : null;
  } catch { return null; }
}
export function writePortfolioProjection(entry: PortfolioProjection): void {
  const { directory, file } = location(entry.userId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { try { unlinkSync(temporary); } catch { /* Atomic rename consumed it. */ } }
}
export class PortfolioProjectionUnavailable extends Error {
  constructor() { super('Portfolio totals are being prepared. Retry shortly or sync your brokers.'); }
}
export function requirePortfolioProjection(state: InvestorState): PortfolioProjection {
  const result = readPortfolioProjection(state);
  if (!result) throw new PortfolioProjectionUnavailable();
  return result;
}
