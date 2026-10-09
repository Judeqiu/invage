import { brokerRawDataFile, fetchRawData } from '../raw-data/store.js';
import { readBrokerAccountModel, ibkrStatements } from '../brokers/accounts.js';
import { getBrokerAdapter } from '../brokers/adapter.js';
import { listBrokerSyncRuns } from '../brokers/sync-history.js';
import { buildOptionEpisodes, optionObservationFromStatement, type OptionObservation } from '../brokers/option-history.js';
import { mergeOptionLifecycleEvents, type OptionLifecycleEvent } from '../brokers/option-events.js';
import { loadBrokerParserSpec } from '../brokers/parser-store.js';
import { runCsvTablesSpec } from '../brokers/csv-tables.js';
import type { InvestorState } from '../state/portfolio-state.js';
import type { BrokerStatement } from '../brokers/statement.js';

const MAX_RAW_BYTES = 10 * 1024 * 1024;
const parsedArchiveCache = new Map<string, { observation: OptionObservation; events: OptionLifecycleEvent[] }>();

function archivedBytes(slug: string, channel: string, id: string): Buffer {
  const file = brokerRawDataFile(slug, channel, id);
  if (!file || file.bytes > MAX_RAW_BYTES) throw new Error('Archived broker response is missing or too large');
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < file.bytes) {
    const page = fetchRawData(slug, id, file.version, offset, 65536, 'base64');
    chunks.push(Buffer.from(page.content, 'base64'));
    if (page.next_offset == null) break;
    offset = page.next_offset;
  }
  return Buffer.concat(chunks);
}

function statementFromArchive(slug: string, connectionId: string, brokerId: string,
  channel: string, accountId: string, bytes: Buffer): BrokerStatement {
  const xml = brokerId === 'ibkr' && bytes.toString('utf8', 0, 128).trimStart().startsWith('<');
  const parser = brokerId === 'ibkr' && !xml ? loadBrokerParserSpec(slug, brokerId,
    channel === brokerId ? undefined : connectionId) : null;
  const statements = xml ? ibkrStatements(bytes, channel)
    : parser ? [runCsvTablesSpec(bytes.toString('utf8'), parser, channel)]
      : brokerId === 'ibkr' ? ibkrStatements(bytes, channel)
        : [getBrokerAdapter(brokerId).parseToStatement({ kind: 'json', body: bytes }, channel)];
  const selected = statements.find(row => row.account_id === accountId);
  if (!selected) throw new Error('Archived statement account differs from current binding');
  return selected;
}

/** Read old successful raw archives without mutating investor state. Gaps are reported. */
export function optionHistoryForState(state: InvestorState, now = new Date()) {
  const model = readBrokerAccountModel(state);
  const observations: OptionObservation[] = [...(state.option_observations ?? [])];
  const known = new Set(observations.map(row => row.id));
  const archivedEvents: OptionLifecycleEvent[] = [];
  const gaps: Array<{ channel: string; as_of: string; reason: string }> = [];
  for (const [id, conn] of Object.entries(model.connections)) {
    if (!conn.account_id) continue;
    let offset = 0;
    for (;;) {
      const page = listBrokerSyncRuns(state.user.id, conn.channel, offset, 100);
      for (const run of page.runs) {
        if (!run.ok) continue;
        const cacheKey = `${state.user.id}:${conn.channel}:${run.id}`;
        const cached = parsedArchiveCache.get(cacheKey);
        if (cached) {
          if (!known.has(run.id)) { observations.push(cached.observation); known.add(run.id); }
          archivedEvents.push(...cached.events);
          continue;
        }
        if (!run.raw_data_id || !run.as_of) {
          gaps.push({ channel: conn.channel, as_of: run.as_of ?? run.at.slice(0, 10),
            reason: 'Raw archive unavailable; lifecycle events cannot be checked' });
          continue;
        }
        try {
          const bytes = archivedBytes(state.user.id, conn.channel, run.raw_data_id);
          const statement = statementFromArchive(state.user.id, id, conn.broker_id,
            conn.channel, conn.account_id, bytes);
          if (statement.as_of !== run.as_of) throw new Error('Archive date differs from sync record');
          const observation = optionObservationFromStatement({
            statement, brokerId: conn.broker_id, connectionId: id,
            channel: conn.channel, observedAt: run.at, rawDataId: run.raw_data_id, syncId: run.id,
          });
          if (!known.has(run.id)) { observations.push(observation); known.add(run.id); }
          archivedEvents.push(...(statement.option_events ?? []));
          if (parsedArchiveCache.size >= 1000) parsedArchiveCache.clear();
          parsedArchiveCache.set(cacheKey, { observation, events: statement.option_events ?? [] });
        } catch (error) {
          gaps.push({ channel: conn.channel, as_of: run.as_of,
            reason: 'Archived response could not be reconstructed; lifecycle events cannot be checked' });
        }
      }
      if (page.next_offset == null) break;
      offset = page.next_offset;
    }
  }
  const events = mergeOptionLifecycleEvents(state.option_events ?? [], archivedEvents);
  const episodes = buildOptionEpisodes({ ...state, option_observations: observations, option_events: events }, now);
  return { episodes, observations, gaps };
}
