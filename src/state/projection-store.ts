import type { BrokerProjection } from '../report/broker-projections.js';
import { freezeReadModel,isFrozenReadModel } from './freeze-read-model.js';
import {projectionLocation as location,projectionFileSignature} from './projection-files.js';
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
const CALCULATION_VERSION = 9;
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
const frozenFingerprints=new WeakMap<InvestorState,{snapshots:string;fingerprint:string}>();
export function portfolioFingerprint(state: InvestorState): string {
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
  const frozen=isFrozenReadModel(state),snapshotKey=JSON.stringify(snapshots);
  const prior=frozen?frozenFingerprints.get(state):undefined;
  if(prior?.snapshots===snapshotKey)return prior.fingerprint;
  const connections = Object.fromEntries(Object.entries(state.broker_connections ?? {}).map(([id, conn]) => {
    const { sync_schedule, ...rest } = conn as import('./portfolio-state.js').BrokerAccountConnection;
    return [id, rest];
  }));
  const fingerprint=createHash('sha256').update(JSON.stringify([PROJECTION_VERSION, CALCULATION_VERSION, state.user.id, state.profile.display_name,
    state.portfolio, state.cash, state.deposits, (state as unknown as { treasury: unknown }).treasury,
    connections, state.broker_history, state.option_executions, state.option_events,
    state.option_observations, state.option_identities, state.broker_statement_evidence, snapshots])).digest('hex');
  if(frozen)frozenFingerprints.set(state,{snapshots:snapshotKey,fingerprint});
  return fingerprint;
}
const projectionFiles = new Map<string, { signature: string; entry: PortfolioProjection }>();
const projectionSignatures = new WeakMap<PortfolioProjection,string>();
export const portfolioProjectionSignature = (entry:PortfolioProjection) => projectionSignatures.get(entry);
function readProjectionFile(userId: string): PortfolioProjection {
  const file = location(userId).file;
  const signature = () => projectionFileSignature(file);
  const before = signature(), cached = projectionFiles.get(file);
  if (cached?.signature === before) return cached.entry;
  const entry = freezeReadModel(JSON.parse(readFileSync(file, 'utf8')) as PortfolioProjection);
  if (before !== signature()) throw new Error('Saved generation changed while reading');
  projectionSignatures.set(entry,before);
  projectionFiles.set(file, { signature: before, entry });
  return entry;
}
/** Read prior daily checkpoints even when source inputs have changed. Never used to serve page data. */
export function readDailyAggregateHistory(userId: string) {
  try {
    const entry = readProjectionFile(userId);
    return entry.userId === userId && entry.version === PROJECTION_VERSION ? structuredClone(entry.dailyAggregateHistory ?? {}) : {};
  } catch { return {}; }
}
/** Prior quote evidence only; this unchecked generation must never serve page data. */
export function readPriorQuoteDashboard(userId: string): DashboardPayload | undefined {
  try {
    const entry = readProjectionFile(userId);
    return entry.userId === userId && entry.version === PROJECTION_VERSION ? entry.dashboard : undefined;
  } catch { return undefined; }
}
/** Durable private read model: no TTL, eviction, market calls or calculation on reads. */
export function readPortfolioProjection(state: InvestorState): PortfolioProjection | null {
  try {
    const entry = readProjectionFile(state.user.id);
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
    projectionFiles.delete(file);
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
