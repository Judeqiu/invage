import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveDataRoot } from 'utarus';
import { loadInvestor, saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
import type {
  BrokerAccessSource,
  BrokerAccountConnection,
  BrokerConnectionLastSync,
  InvestorState,
} from '../state/portfolio-state.js';
import { assertBrokerConnectionMetrics } from '../state/portfolio-state.js';
import { getCashes, getPortfolio } from '../state/portfolio-state.js';
import { buildHoldingKey } from '../market/position-value.js';
import { getBrokerAdapter, type AdapterTransport } from './adapter.js';
import { applyBrokerStatement } from './apply-statement.js';
import { BROKER_CATALOG, getBrokerConnector, type BrokerConnectorDef } from './catalog.js';
import { parseLastSync, readBrokerConnections, redactSecrets } from './connections.js';
import { normalizePem } from './pem.js';
import type { BrokerStatement } from './statement.js';
import { formatBrokerSkip, type BrokerApplyResult } from './statement.js';
import { parseFlexQueryXml, xmlElementText } from '../ibkr/flex-parse.js';
import { mapFlexDocToStatement } from '../ibkr/flex-map.js';
import { loadBrokerParserSpec } from './parser-store.js';
import { runCsvTablesSpec } from './csv-tables.js';
import { recordBrokerSyncRun } from './sync-history.js';
import { brokerSyncFacts, captureBrokerSyncSnapshot, publishBrokerSyncFailure,
  publishBrokerSyncSuccess } from './sync-notification.js';

export interface BrokerAccountModel {
  sources: Record<string, BrokerAccessSource>;
  connections: Record<string, BrokerAccountConnection>;
}

const CONNECTION_FIELDS: Record<string, string[]> = {
  ibkr: ['activity_query_id', 'tradeconf_query_id'],
  tiger: ['account'],
  moomoo: ['acc_id'],
  futubull: ['acc_id'],
  webull: ['account_id'],
};
const ACCOUNT_FIELD: Record<string, string | undefined> = {
  ibkr: undefined,
  tiger: 'account',
  moomoo: 'acc_id',
  futubull: 'acc_id',
  webull: 'account_id',
};
const inflight = new Set<string>();
export function brokerSyncInProgress(slug: string, id: string): boolean {
  return inflight.has(`${slug}:${id}`);
}

function record(raw: unknown, name: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${name} must be a mapping.`);
  return raw as Record<string, unknown>;
}
function nonempty(raw: unknown, name: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${name} must be a non-empty string.`);
  return raw.trim();
}
function configFields(brokerId: string): Set<string> {
  getBrokerConnector(brokerId);
  return new Set(CONNECTION_FIELDS[brokerId] ?? []);
}
function sourceFields(def: BrokerConnectorDef): Set<string> {
  const onConnection = configFields(def.id);
  return new Set(def.credentialFields.filter(f => !onConnection.has(f.id)).map(f => f.id));
}
function validateValues(raw: unknown, def: BrokerConnectorDef, kind: 'source' | 'connection'): Record<string, string> {
  const fields = kind === 'source' ? sourceFields(def) : configFields(def.id);
  const o = record(raw, kind === 'source' ? 'credentials' : 'config');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(o)) {
    if (!fields.has(key)) throw new Error(`Unknown ${kind} field "${key}" for ${def.id}.`);
    const field = def.credentialFields.find(f => f.id === key)!;
    const v = nonempty(value, key);
    out[key] = field.format === 'pem' ? normalizePem(v) : v;
  }
  return out;
}
function parseSource(id: string, raw: unknown): BrokerAccessSource {
  const o = record(raw, `broker_sources.${id}`);
  if (Object.keys(o).some(k => k !== 'broker_id' && k !== 'credentials')) throw new Error(`broker_sources.${id} has unknown fields.`);
  const broker_id = nonempty(o.broker_id, 'broker_id');
  const def = getBrokerConnector(broker_id);
  return { broker_id, credentials: validateValues(o.credentials, def, 'source') };
}
function parseConnection(id: string, raw: unknown, sources: Record<string, BrokerAccessSource>): BrokerAccountConnection {
  const o = record(raw, `broker_connections.${id}`);
  const allowed = new Set(['broker_id', 'source_id', 'label', 'account_id', 'channel', 'enabled', 'config', 'last_sync', 'metrics', 'sync_schedule']);
  if (Object.keys(o).some(k => !allowed.has(k))) throw new Error(`broker_connections.${id} has unknown fields.`);
  const broker_id = nonempty(o.broker_id, 'broker_id');
  const def = getBrokerConnector(broker_id);
  const source_id = nonempty(o.source_id, 'source_id');
  if (sources[source_id]?.broker_id !== broker_id) throw new Error(`Connection ${id} has no matching access source.`);
  const channel = nonempty(o.channel, 'channel');
  if (!/^[a-z][a-z0-9_-]*$/.test(channel)) throw new Error(`Invalid broker channel "${channel}".`);
  if (typeof o.enabled !== 'boolean') throw new Error(`Connection ${id}.enabled must be boolean.`);
  const conn: BrokerAccountConnection = {
    broker_id, source_id, label: nonempty(o.label, 'label'), channel,
    enabled: o.enabled, config: validateValues(o.config, def, 'connection'),
  };
  if (o.account_id != null) conn.account_id = nonempty(o.account_id, 'account_id');
  const accountField = ACCOUNT_FIELD[broker_id];
  if (accountField && conn.account_id && conn.config[accountField] !== conn.account_id) {
    throw new Error(`Connection ${id} account binding differs from ${accountField}.`);
  }
  if (o.last_sync != null) conn.last_sync = parseLastSync(o.last_sync, `broker_connections.${id}.last_sync`);
  if (o.metrics != null) conn.metrics = assertBrokerConnectionMetrics(o.metrics, `broker_connections.${id}.metrics`);
  if (o.sync_schedule != null) {
    const schedule = record(o.sync_schedule, `broker_connections.${id}.sync_schedule`);
    if (Object.keys(schedule).some(k => k !== 'frequency' && k !== 'next_run_at') ||
        !isSyncFrequency(schedule.frequency) || typeof schedule.next_run_at !== 'string' ||
        !Number.isFinite(Date.parse(schedule.next_run_at))) {
      throw new Error(`broker_connections.${id}.sync_schedule is invalid.`);
    }
    conn.sync_schedule = { frequency: schedule.frequency, next_run_at: schedule.next_run_at };
  }
  return conn;
}
function accountNamespace(conn: BrokerAccountConnection, sources: Record<string, BrokerAccessSource>): string {
  const access = sources[conn.source_id]?.credentials ?? {};
  if (conn.broker_id === 'tiger') return `${access.license?.toUpperCase() ?? ''}:${/^\d{17}$/.test(conn.account_id ?? '') ? 'paper' : 'live'}`;
  if (conn.broker_id === 'webull') return access.region?.toLowerCase() ?? '';
  if (conn.broker_id === 'futubull') return access.security_firm?.toUpperCase() ?? '';
  return '';
}
function validateUniqueness(model: BrokerAccountModel): void {
  const channels = new Set<string>();
  const accounts = new Set<string>();
  for (const conn of Object.values(model.connections)) {
    if (channels.has(conn.channel)) throw new Error(`Duplicate broker channel "${conn.channel}".`);
    channels.add(conn.channel);
    if (!conn.account_id) continue;
    const key = [conn.broker_id, accountNamespace(conn, model.sources), conn.account_id.toUpperCase()].join(':');
    if (accounts.has(key)) throw new Error(`Duplicate broker account ${conn.broker_id} ${conn.account_id}.`);
    accounts.add(key);
  }
}
function canRebind(state: InvestorState, conn: BrokerAccountConnection): boolean {
  if (!conn.account_id) return true;
  return conn.last_sync?.ok !== true && !conn.last_sync?.account_id &&
    !Object.values(getPortfolio(state)).some(h => h.channel === conn.channel) &&
    !getCashes(state).some(c => c.channel === conn.channel) &&
    !(state.option_executions ?? []).some(e => e.channel === conn.channel) &&
    !(state.option_events ?? []).some(e => e.channel === conn.channel);
}

/** Read legacy connector-keyed state as one account connection per type, without mutating it. */
export function readBrokerAccountModel(state: InvestorState): BrokerAccountModel {
  const rawSources = state.broker_sources;
  if (rawSources == null) {
    const old = readBrokerConnections(state);
    const sources: BrokerAccountModel['sources'] = {};
    const connections: BrokerAccountModel['connections'] = {};
    for (const [id, previous] of Object.entries(old)) {
      const def = getBrokerConnector(id);
      const sourceId = `legacy-${id}`;
      const sourceCreds: Record<string, string> = {};
      const config: Record<string, string> = {};
      const connectionKeys = configFields(id);
      for (const [key, value] of Object.entries(previous.credentials)) {
        (connectionKeys.has(key) ? config : sourceCreds)[key] = value;
      }
      sources[sourceId] = { broker_id: id, credentials: sourceCreds };
      const conn: BrokerAccountConnection = {
        broker_id: id, source_id: sourceId, label: def.displayName, channel: def.channel,
        enabled: previous.enabled, config,
      };
      const accountField = ACCOUNT_FIELD[id];
      if (accountField && config[accountField]) conn.account_id = config[accountField];
      // Last sync is a suggestion, not an authoritative binding for IBKR.
      if (previous.last_sync) conn.last_sync = previous.last_sync;
      if (previous.metrics) conn.metrics = previous.metrics;
      connections[id] = conn;
    }
    return { sources, connections };
  }
  if ((state as InvestorState & { ibkr_flex?: unknown }).ibkr_flex != null) {
    throw new Error('Conflicting IBKR config: broker_sources and ibkr_flex are both set.');
  }
  const sources: BrokerAccountModel['sources'] = {};
  for (const [id, value] of Object.entries(record(rawSources, 'broker_sources'))) {
    sources[id] = parseSource(id, value);
  }
  const connections: BrokerAccountModel['connections'] = {};
  for (const [id, value] of Object.entries(record(state.broker_connections ?? {}, 'broker_connections'))) {
    connections[id] = parseConnection(id, value, sources);
  }
  const model = { sources, connections };
  validateUniqueness(model);
  return model;
}

export function persistBrokerAccountModel(state: InvestorState, model: BrokerAccountModel): void {
  validateUniqueness(model);
  state.broker_sources = model.sources;
  state.broker_connections = model.connections;
  delete (state as InvestorState & { ibkr_flex?: unknown }).ibkr_flex;
}

export function combinedCredentials(model: BrokerAccountModel, conn: BrokerAccountConnection): Record<string, string> {
  return { ...model.sources[conn.source_id].credentials, ...conn.config };
}
export function resolveBrokerAccountId(state: InvestorState, brokerId: string, connectionId?: string): string {
  getBrokerConnector(brokerId);
  const model = readBrokerAccountModel(state);
  if (connectionId) {
    const conn = model.connections[connectionId];
    if (!conn || conn.broker_id !== brokerId) throw new Error('Connection ID does not match the broker.');
    return connectionId;
  }
  const matches = Object.entries(model.connections).filter(([, c]) => c.broker_id === brokerId);
  if (matches.length !== 1) throw new Error(
    matches.length ? `Multiple ${brokerId} accounts. Supply connection_id.` : `No ${brokerId} account. Add one in Settings → Brokers.`,
  );
  return matches[0][0];
}
function requiredComplete(def: BrokerConnectorDef, values: Record<string, string>): boolean {
  return def.credentialFields.every(f => !f.required || Boolean(values[f.id]?.trim()));
}
export type SyncFrequency = 'hourly' | 'daily' | 'weekly';
export function isSyncFrequency(value: unknown): value is SyncFrequency {
  return value === 'hourly' || value === 'daily' || value === 'weekly';
}
export function nextBrokerSyncAt(frequency: SyncFrequency, from: Date): string {
  const hours = frequency === 'hourly' ? 1 : frequency === 'daily' ? 24 : 168;
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();
}
function publicValue(value: string | undefined, secret: boolean): { configured: boolean; value?: string; last4?: string } {
  if (!value) return { configured: false };
  if (!secret) return { configured: true, value };
  return value.length >= 4 ? { configured: true, last4: value.slice(-4) } : { configured: true };
}
export function publicBrokerAccounts(state: InvestorState) {
  const model = readBrokerAccountModel(state);
  return {
    catalog: BROKER_CATALOG.map(def => ({
      id: def.id, display_name: def.displayName, capability: def.capability,
      fields: def.credentialFields.map(f => ({ id: f.id, label: f.label, type: f.type, required: f.required,
        role: configFields(def.id).has(f.id) ? 'connection' : 'source', help: f.help, widget: f.widget, format: f.format })),
      help_steps: def.helpSteps, help_notes: def.helpNotes, help_href: def.helpHref,
      help_href_label: def.helpHrefLabel,
    })),
    sources: Object.entries(model.sources).map(([id, source]) => ({
      id, broker_id: source.broker_id,
      credentials: Object.fromEntries(getBrokerConnector(source.broker_id).credentialFields
        .filter(f => sourceFields(getBrokerConnector(source.broker_id)).has(f.id))
        .map(f => [f.id, publicValue(source.credentials[f.id], f.type === 'secret')])),
    })),
    connections: Object.entries(model.connections).map(([id, conn]) => {
      const def = getBrokerConnector(conn.broker_id);
      const credentials = combinedCredentials(model, conn);
      const secrets = def.credentialFields.filter(f => f.type === 'secret')
        .map(f => credentials[f.id]).filter((v): v is string => !!v);
      const status = !conn.enabled ? 'paused' : !requiredComplete(def, credentials) || !conn.account_id
        ? 'needs_setup' : conn.last_sync?.ok === false ? 'error' : conn.last_sync?.ok === true ? 'verified' : 'ready';
      return {
        id, broker_id: conn.broker_id, source_id: conn.source_id, label: conn.label,
        account_id: conn.account_id ?? null, channel: conn.channel, enabled: conn.enabled,
        sync_schedule: conn.sync_schedule ?? null,
        account_binding_editable: canRebind(state, conn),
        status, config: Object.fromEntries(def.credentialFields.filter(f => configFields(def.id).has(f.id))
          .map(f => [f.id, publicValue(conn.config[f.id], f.type === 'secret')])),
        last_sync: conn.last_sync ? { ...conn.last_sync,
          ...(conn.last_sync.error ? { error: redactSecrets(conn.last_sync.error, secrets) } : {}) } : null,
        metrics: conn.metrics ?? null,
      };
    }),
  };
}

export function addBrokerSource(state: InvestorState, brokerId: string, credentials: Record<string, string>): string {
  const def = getBrokerConnector(brokerId);
  const values = validateValues(credentials, def, 'source');
  if (def.credentialFields.some(f => sourceFields(def).has(f.id) && f.required && !values[f.id])) {
    throw new Error('Required broker access fields are incomplete.');
  }
  const model = readBrokerAccountModel(state);
  const id = `src_${randomUUID()}`;
  model.sources[id] = { broker_id: brokerId, credentials: values };
  persistBrokerAccountModel(state, model);
  return id;
}
export function patchBrokerSource(state: InvestorState, sourceId: string, patch: Record<string, string | null>): void {
  const model = readBrokerAccountModel(state);
  const source = model.sources[sourceId];
  if (!source) throw new Error('Unknown broker source.');
  const def = getBrokerConnector(source.broker_id);
  const next = { ...source.credentials };
  const allowed = sourceFields(def);
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new Error(`Unknown source field "${key}".`);
    const field = def.credentialFields.find(f => f.id === key)!;
    if (value === null) {
      if (field.required || field.type === 'secret') throw new Error(`${field.label} cannot be cleared here.`);
      delete next[key];
    } else {
      const v = nonempty(value, field.label);
      next[key] = field.format === 'pem' ? normalizePem(v) : v;
    }
  }
  source.credentials = next;
  persistBrokerAccountModel(state, model);
}
export function addBrokerAccount(state: InvestorState, args: {
  source_id: string; account_id: string; label: string; config: Record<string, string>;
}): string {
  const model = readBrokerAccountModel(state);
  const source = model.sources[args.source_id];
  if (!source) throw new Error('Unknown broker source.');
  const def = getBrokerConnector(source.broker_id);
  const config = validateValues(args.config, def, 'connection');
  const account_id = nonempty(args.account_id, 'account_id');
  const accountField = ACCOUNT_FIELD[def.id];
  if (accountField) config[accountField] = account_id;
  if (!requiredComplete(def, { ...source.credentials, ...config })) throw new Error('Required broker fields are incomplete.');
  const id = `conn_${randomUUID()}`;
  const channel = `${def.id}-${id.slice(-8)}`;
  model.connections[id] = {
    broker_id: def.id, source_id: args.source_id, label: nonempty(args.label, 'label'),
    account_id, channel, enabled: true, config,
  };
  persistBrokerAccountModel(state, model);
  return id;
}
export function patchBrokerAccount(state: InvestorState, id: string, patch: {
  label?: string; enabled?: boolean; account_id?: string; config?: Record<string, string | null>;
  sync_frequency?: SyncFrequency | null;
}): void {
  const model = readBrokerAccountModel(state);
  const conn = model.connections[id];
  if (!conn) throw new Error('Unknown broker connection.');
  if (patch.account_id !== undefined) {
    const selected = nonempty(patch.account_id, 'account_id');
    if (!conn.account_id && conn.last_sync?.account_id && conn.last_sync.account_id !== selected) {
      throw new Error('Selected account differs from the prior sync on this channel. Add a new connection.');
    }
    if (conn.account_id !== selected && !canRebind(state, conn)) {
      throw new Error('Account binding cannot be changed after this channel has imported data; add a new connection.');
    }
    conn.account_id = selected;
    const accountField = ACCOUNT_FIELD[conn.broker_id];
    if (accountField) conn.config[accountField] = conn.account_id;
  }
  if (patch.label !== undefined) conn.label = nonempty(patch.label, 'label');
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new Error('enabled must be boolean.');
    conn.enabled = patch.enabled;
  }
  if (patch.sync_frequency !== undefined) {
    if (patch.sync_frequency === null) delete conn.sync_schedule;
    else {
      if (!isSyncFrequency(patch.sync_frequency)) throw new Error('Invalid sync frequency.');
      if (!conn.account_id) throw new Error('Select a broker account before scheduling sync.');
      if (!requiredComplete(getBrokerConnector(conn.broker_id), combinedCredentials(model, conn))) {
        throw new Error('Required broker fields are incomplete.');
      }
      if (conn.sync_schedule?.frequency !== patch.sync_frequency) {
        conn.sync_schedule = { frequency: patch.sync_frequency, next_run_at: nextBrokerSyncAt(patch.sync_frequency, new Date()) };
      }
    }
  }
  if (patch.config) {
    const def = getBrokerConnector(conn.broker_id);
    const allowed = configFields(conn.broker_id);
    const accountField = ACCOUNT_FIELD[conn.broker_id];
    for (const [key, value] of Object.entries(patch.config)) {
      if (!allowed.has(key)) throw new Error(`Unknown connection field "${key}".`);
      if (key === accountField) throw new Error('Account binding cannot be changed; add a new connection.');
      if (value === null) {
        if (def.credentialFields.find(f => f.id === key)?.required) throw new Error(`${key} is required.`);
        delete conn.config[key];
      } else conn.config[key] = nonempty(value, key);
    }
  }
  persistBrokerAccountModel(state, model);
}

/** IBKR query may contain multiple accounts. Parse each statement in isolation. */
export function ibkrStatements(raw: Buffer, channel: string): BrokerStatement[] {
  const xml = raw.toString('utf8');
  if (/<(?:Error|FlexError)\b/.test(xml)) throw new Error('IBKR Flex returned an error envelope.');
  const status = xmlElementText(xml, 'Status');
  if (status === 'Fail' || status === 'Error' || (status === 'Warn' && xmlElementText(xml, 'ErrorCode'))) {
    throw new Error(`IBKR Flex returned ${status}: ${xmlElementText(xml, 'ErrorMessage') ?? 'unknown error'}`);
  }
  const matches = [...xml.matchAll(/<FlexStatement\b[^>]*>[\s\S]*?<\/FlexStatement>/g)];
  const openings = [...xml.matchAll(/<FlexStatement\b/g)].length;
  const closings = [...xml.matchAll(/<\/FlexStatement>/g)].length;
  if (openings !== matches.length || closings !== matches.length) {
    throw new Error('IBKR Flex response contains an incomplete FlexStatement.');
  }
  if (matches.length === 0) {
    // Preserve the detailed vendor/format error from the original parser.
    parseFlexQueryXml(raw);
    throw new Error('IBKR Flex response has no complete FlexStatement.');
  }
  const out = matches.map(m => {
    const statement = mapFlexDocToStatement(parseFlexQueryXml(m[0]), channel);
    if (statement.option_executions) statement.option_executions = statement.option_executions.map(row => ({ ...row, channel }));
    if (statement.option_events) statement.option_events = statement.option_events.map(row => ({ ...row, channel }));
    return statement;
  });
  const ids = new Set<string>();
  for (const statement of out) {
    if (ids.has(statement.account_id)) throw new Error(`Duplicate IBKR Flex account ${statement.account_id}.`);
    ids.add(statement.account_id);
  }
  return out;
}
async function fetchStatements(model: BrokerAccountModel, conn: BrokerAccountConnection, connectionId: string, slug: string, transport?: AdapterTransport,
  onRaw?: (body: Buffer) => void): Promise<{ raw: Buffer; statements: BrokerStatement[] }> {
  const adapter = getBrokerAdapter(conn.broker_id);
  const raw = await adapter.fetchRaw(combinedCredentials(model, conn), transport ? { transport } : undefined);
  onRaw?.(raw.body);
  const parser = adapter.usesCsvTables ? loadBrokerParserSpec(slug, conn.broker_id,
    conn.channel === conn.broker_id ? undefined : connectionId) : null;
  const statements = parser ? [runCsvTablesSpec(raw.body.toString('utf8'), parser, conn.channel)]
    : conn.broker_id === 'ibkr' ? ibkrStatements(raw.body, conn.channel)
    : [adapter.parseToStatement(raw, conn.channel)];
  return { raw: raw.body, statements };
}
export async function discoverBrokerAccounts(state: InvestorState, sourceId: string, config: Record<string, string>, transport?: AdapterTransport) {
  const model = readBrokerAccountModel(state);
  const source = model.sources[sourceId];
  if (!source) throw new Error('Unknown broker source.');
  const def = getBrokerConnector(source.broker_id);
  const parsed = validateValues(config, def, 'connection');
  if (source.broker_id === 'tiger') {
    throw new Error('Enter the Tiger account ID, then validate it with Preview.');
  }
  try {
  if (source.broker_id === 'ibkr') {
    if (!parsed.activity_query_id) throw new Error('Activity query ID is required.');
    const adapter = getBrokerAdapter('ibkr');
    const raw = await adapter.fetchRaw({ ...source.credentials, ...parsed }, transport ? { transport } : undefined);
    return ibkrStatements(raw.body, 'ibkr').map(s => ({ account_id: s.account_id, as_of: s.as_of, lots: s.lots.length, currencies: s.cash.map(c => c.currency) }));
  }
  if (source.broker_id === 'moomoo') {
    const { fetchMooMooAuthorizedAccounts } = await import('../moomoo/moomoo-client.js');
    const { parseSignAlg } = await import('../moomoo/moomoo-sign.js');
    return fetchMooMooAuthorizedAccounts({ app_key: source.credentials.app_key, private_key: source.credentials.private_key,
      sign_alg: parseSignAlg(source.credentials.sign_alg) });
  }
  if (source.broker_id === 'futubull') {
    const { discoverFutubullAccounts } = await import('../futubull/futubull-client.js');
    return discoverFutubullAccounts({ opend_port: source.credentials.opend_port,
      security_firm: source.credentials.security_firm });
  }
  const { listWebullAccounts } = await import('../webull/webull-client.js');
  return listWebullAccounts({ app_key: source.credentials.app_key, app_secret: source.credentials.app_secret,
    region: source.credentials.region, access_token: source.credentials.access_token });
  } catch (error) {
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error),
      def.credentialFields.filter(f => f.type === 'secret').map(f => source.credentials[f.id]).filter((v): v is string => !!v)));
  }
}
export async function previewBrokerAccount(state: InvestorState, id: string, transport?: AdapterTransport) {
  const model = readBrokerAccountModel(state);
  const conn = model.connections[id];
  if (!conn || !conn.account_id) throw new Error('Broker account binding is required.');
  let statements: BrokerStatement[];
  try {
    ({ statements } = await fetchStatements(model, conn, id, state.user.slug, transport));
  } catch (error) {
    const def = getBrokerConnector(conn.broker_id);
    const credentials = combinedCredentials(model, conn);
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error),
      def.credentialFields.filter(f => f.type === 'secret').map(f => credentials[f.id]).filter((v): v is string => !!v)));
  }
  const selected = statements.find(s => s.account_id === conn.account_id);
  if (!selected) throw new Error(`Broker statement account mismatch: expected ${conn.account_id}.`);
  const currentLots = Object.entries(getPortfolio(state)).filter(([, h]) => h.channel === conn.channel).map(([key]) => key);
  const incoming = new Set(selected.lots.map(l => buildHoldingKey(l.ticker, conn.channel)));
  return { account_id: selected.account_id, as_of: selected.as_of, lots: selected.lots.length,
    existing_lots: currentLots.length, would_remove: currentLots.filter(key => !incoming.has(key)).length,
    existing_cash_currencies: getCashes(state).filter(c => c.channel === conn.channel).map(c => c.currency),
    currencies: selected.cash.map(c => c.currency), not_imported: selected.skipped.map(formatBrokerSkip) };
}
function archive(slug: string, conn: BrokerAccountConnection, raw: Buffer, asOf: string, ok: boolean, error?: string): string {
  const base = join(resolveDataRoot(), 'drive', slug, ok ? 'broker-sync' : 'broker-triage', conn.channel);
  const root = ok ? base : join(base, randomUUID());
  mkdirSync(root, { recursive: true });
  const file = ok
    ? join(root, `${asOf}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}${conn.broker_id === 'ibkr' ? '.xml' : '.json'}`)
    : join(root, conn.broker_id === 'ibkr' ? 'raw.xml' : 'raw.json');
  writeFileSync(file, raw);
  if (!ok) writeFileSync(join(root, 'case.yaml'),
    `broker_id: ${JSON.stringify(conn.broker_id)}\nchannel: ${JSON.stringify(conn.channel)}\naccount_id: ${JSON.stringify(conn.account_id ?? '')}\nerror: ${JSON.stringify(error ?? 'parse failed')}\n`);
  return file;
}
export async function syncBrokerAccount(snapshot: InvestorSnapshot, id: string, transport?: AdapterTransport,
  trigger: 'manual' | 'scheduled' = 'manual'): Promise<{ applied: BrokerApplyResult }> {
  const state = snapshot.state;
  const model = readBrokerAccountModel(state);
  const conn = model.connections[id];
  if (!conn) throw new Error('Unknown broker connection.');
  const def = getBrokerConnector(conn.broker_id);
  const credentials = combinedCredentials(model, conn);
  const before = captureBrokerSyncSnapshot(state, conn.channel);
  const key = `${state.user.slug}:${id}`;
  if (inflight.has(key)) throw new Error('Sync already in progress.');
  inflight.add(key);
  const at = new Date().toISOString();
  const syncId = randomUUID();
  let raw: Buffer | undefined;
  let archivePath: string | undefined;
  const rawId = () => archivePath
    ? relative(join(resolveDataRoot(), 'drive', state.user.slug), archivePath).replaceAll('\\', '/') : undefined;
  try {
    let applied: BrokerApplyResult;
    try {
      if (!conn.enabled) throw new Error('Broker connection is paused.');
      if (!conn.account_id) throw new Error('Broker account binding is required.');
      if (!requiredComplete(def, credentials)) throw new Error('Required broker fields are incomplete.');
      const fetched = await fetchStatements(model, conn, id, state.user.slug, transport, body => { raw = body; });
      raw = fetched.raw;
      const statement = fetched.statements.find(s => s.account_id === conn.account_id);
      if (!statement) throw new Error(`Broker statement account mismatch: expected ${conn.account_id}.`);
      archivePath = archive(state.user.slug, conn, fetched.raw, statement.as_of, true);
      // A legacy connector-keyed connection is normalized in memory by
      // readBrokerAccountModel(). Persist that canonical shape before the apply
      // layer verifies the selected account and channel against stored state.
      if (!state.broker_sources) persistBrokerAccountModel(state, model);
      applied = await applyBrokerStatement(snapshot, id, statement, fetched.raw, result => {
        const current = readBrokerAccountModel(state);
        current.connections[id].last_sync = { at, ok: true, as_of: result.asOf, account_id: result.accountId,
          lots_upserted: result.lotsUpserted, lots_removed: result.lotsRemoved,
          ...(result.skipped.length ? { not_imported: result.skipped.map(formatBrokerSkip) } : {}) };
        persistBrokerAccountModel(state, current);
      }, { brokerId: conn.broker_id, channel: conn.channel },
      { syncId, observedAt: at, rawDataId: rawId() });
    } catch (error) {
      const secrets = def.credentialFields.filter(f => f.type === 'secret').map(f => credentials[f.id]).filter((v): v is string => !!v);
      const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
      if (raw && !archivePath) archivePath = archive(state.user.slug, conn, raw, at.slice(0, 10), false, message);
      recordBrokerSyncRun(state.user.slug, conn.channel, { id: syncId, at, trigger, ok: false, error: message,
        ...(rawId() ? { raw_data_id: rawId() } : {}) });
      try {
        const fresh = await loadInvestor(state.user.slug);
        const current = readBrokerAccountModel(fresh.state);
        if (current.connections[id]) {
          current.connections[id].last_sync = { at, ok: false, error: message };
          persistBrokerAccountModel(fresh.state, current);
          await saveInvestor(fresh);
        }
      } finally {
        await publishBrokerSyncFailure(state.user.slug, def.displayName, conn.label, message);
      }
      throw new Error(message);
    }
    recordBrokerSyncRun(state.user.slug, conn.channel, { id: syncId, at, trigger, ok: true, as_of: applied.asOf,
      account_id: applied.accountId, lots_upserted: applied.lotsUpserted, lots_removed: applied.lotsRemoved,
      ...(rawId() ? { raw_data_id: rawId() } : {}) });
    applied.archivePath = archivePath;
    try {
      await publishBrokerSyncSuccess(state.user.slug, state.user.admin === true,
        brokerSyncFacts(def.displayName, conn.label, before, captureBrokerSyncSnapshot(state, conn.channel), applied,
          conn.last_sync?.ok === true));
    } catch (error) {
      console.error('[broker/sync-notification] comparison failed:', error);
    }
    return { applied };
  } finally {
    inflight.delete(key);
  }
}
