/**
 * Per-user broker_connections YAML store + public DTO.
 * Lazy-migrates top-level ibkr_flex on write (including failed sync).
 */

import { saveState } from 'utarus';
import { applyFlexStatement } from '../ibkr/flex-apply.js';
import { formatBrokerSkip, type BrokerApplyResult } from './statement.js';
import {
  createFlexTransport,
  fetchFlexStatement,
  type FlexTransport,
} from '../ibkr/flex-client.js';
import type { IbkrFlexConfig } from '../ibkr/flex-config.js';
import { parseFlexQueryXml } from '../ibkr/flex-parse.js';
import { applyBrokerStatement } from './apply-statement.js';
import { runCsvTablesSpec } from './csv-tables.js';
import { loadBrokerParserSpec } from './parser-store.js';
import { archiveBrokerTriage } from './triage.js';
import {
  assertBrokerConnectionMetrics,
  type BrokerConnection,
  type BrokerConnectionLastSync,
  type InvestorState,
} from '../state/portfolio-state.js';
import {
  BROKER_CATALOG,
  getBrokerConnector,
  type BrokerConnectorDef,
  type CredentialFieldDef,
} from './catalog.js';

export type { BrokerConnection, BrokerConnectionLastSync };

export class ChannelOffError extends Error {
  readonly errorCode = 'channel_off' as const;
  constructor(displayName: string) {
    super(`${displayName} channel is off. Enable it in Settings before sync.`);
    this.name = 'ChannelOffError';
  }
}

export class BrokerNotConfiguredError extends Error {
  readonly errorCode = 'not_configured' as const;
  constructor() {
    super(
      'IBKR Flex is not configured. Call configure_ibkr_flex with the Client Portal token and Activity Flex Query id.',
    );
    this.name = 'BrokerNotConfiguredError';
  }
}

export class SyncInProgressError extends Error {
  readonly errorCode = 'sync_in_progress' as const;
  constructor() {
    super(
      'A Flex sync is already running for this connector. Wait, then Refresh.',
    );
    this.name = 'SyncInProgressError';
  }
}

export class UnknownConnectorError extends Error {
  readonly errorCode = 'unknown_connector' as const;
  constructor(id: string) {
    super(`Unknown broker connector "${id}".`);
    this.name = 'UnknownConnectorError';
  }
}

export type BrokerConnectionStatus = 'off' | 'needs_credentials' | 'connected' | 'error';

export interface PublicCredentialView {
  configured: boolean;
  last4?: string;
  value?: string;
}

export interface PublicConnectorView {
  id: string;
  display_name: string;
  channel: string;
  capability: string;
  enabled: boolean;
  status: BrokerConnectionStatus;
  credential_fields: Array<{
    id: string;
    label: string;
    type: CredentialFieldDef['type'];
    required: boolean;
    help?: string;
  }>;
  credentials: Record<string, PublicCredentialView>;
  last_sync: BrokerConnectionLastSync | null;
  sync_query_field_id?: string;
  help_notes?: string[];
  help_steps?: string[];
  help_href?: string;
}

type StateWithLegacy = InvestorState & {
  ibkr_flex?: unknown;
  broker_connections?: unknown;
};

const inflight = new Set<string>();

function inflightKey(slug: string, id: string): string {
  return `${slug}:${id}`;
}

export function redactSecrets(message: string, secrets: string[]): string {
  let s = message;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    s = s.split(secret).join('[redacted]');
  }
  return s.replace(/([?&]t=)[^&\s]+/gi, '$1[redacted]');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function parseLegacyIbkrFlex(raw: unknown): IbkrFlexConfig {
  const o = asRecord(raw, 'ibkr_flex');
  const token = typeof o.token === 'string' ? o.token.trim() : '';
  const activity_query_id =
    typeof o.activity_query_id === 'string'
      ? o.activity_query_id.trim()
      : typeof o.activity_query_id === 'number'
        ? String(o.activity_query_id)
        : '';
  if (!token) throw new Error('ibkr_flex.token is required.');
  if (!activity_query_id) throw new Error('ibkr_flex.activity_query_id is required.');
  const cfg: IbkrFlexConfig = { token, activity_query_id };
  const tc = o.tradeconf_query_id;
  if (tc != null) {
    const s = typeof tc === 'string' ? tc.trim() : typeof tc === 'number' ? String(tc) : '';
    if (!s) throw new Error('ibkr_flex.tradeconf_query_id must be non-empty when set.');
    cfg.tradeconf_query_id = s;
  }
  return cfg;
}

function parseLastSync(raw: unknown, ctx: string): BrokerConnectionLastSync {
  const o = asRecord(raw, ctx);
  const at = typeof o.at === 'string' ? o.at.trim() : '';
  if (!at) throw new Error(`${ctx}.at is required.`);
  if (typeof o.ok !== 'boolean') throw new Error(`${ctx}.ok must be a boolean.`);
  const ls: BrokerConnectionLastSync = { at, ok: o.ok };
  if (o.ok === false) {
    const error = typeof o.error === 'string' ? o.error.trim() : '';
    if (!error) {
      throw new Error(`${ctx}.error is required when last_sync.ok is false.`);
    }
    ls.error = error;
  } else if (o.error != null) {
    throw new Error(`${ctx}.error must be omitted when last_sync.ok is true.`);
  }
  if (o.as_of != null) {
    if (typeof o.as_of !== 'string' || !o.as_of.trim()) {
      throw new Error(`${ctx}.as_of must be a non-empty string when set.`);
    }
    ls.as_of = o.as_of.trim();
  }
  if (o.account_id != null) {
    if (typeof o.account_id !== 'string' || !o.account_id.trim()) {
      throw new Error(`${ctx}.account_id must be a non-empty string when set.`);
    }
    ls.account_id = o.account_id.trim();
  }
  if (o.lots_upserted != null) {
    if (typeof o.lots_upserted !== 'number' || !Number.isFinite(o.lots_upserted)) {
      throw new Error(`${ctx}.lots_upserted must be a finite number when set.`);
    }
    ls.lots_upserted = o.lots_upserted;
  }
  if (o.lots_removed != null) {
    if (typeof o.lots_removed !== 'number' || !Number.isFinite(o.lots_removed)) {
      throw new Error(`${ctx}.lots_removed must be a finite number when set.`);
    }
    ls.lots_removed = o.lots_removed;
  }
  if (o.not_imported != null) {
    if (
      !Array.isArray(o.not_imported) ||
      o.not_imported.some((x) => typeof x !== 'string' || !x.trim())
    ) {
      throw new Error(`${ctx}.not_imported must be an array of non-empty strings when set.`);
    }
    ls.not_imported = o.not_imported.map((s) => String(s).trim());
  }
  return ls;
}

function parseStoredConnection(id: string, raw: unknown): BrokerConnection {
  const def = getBrokerConnector(id);
  const o = asRecord(raw, `broker_connections.${id}`);
  const allowedKeys = new Set(['enabled', 'credentials', 'last_sync', 'metrics']);
  for (const k of Object.keys(o)) {
    if (!allowedKeys.has(k)) {
      throw new Error(`broker_connections.${id}: unknown field "${k}".`);
    }
  }
  if (typeof o.enabled !== 'boolean') {
    throw new Error(`broker_connections.${id}.enabled must be a boolean.`);
  }
  const credRaw = asRecord(o.credentials, `broker_connections.${id}.credentials`);
  const allowed = new Set(def.credentialFields.map((f) => f.id));
  const credentials: Record<string, string> = {};
  for (const [key, val] of Object.entries(credRaw)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Unknown credential key "${key}" for broker connector "${id}".`,
      );
    }
    if (typeof val !== 'string' || !val.trim()) {
      throw new Error(`broker_connections.${id}.credentials.${key} must be a non-empty string.`);
    }
    credentials[key] = val.trim();
  }
  const conn: BrokerConnection = { enabled: o.enabled, credentials };
  if (o.last_sync != null) {
    conn.last_sync = parseLastSync(o.last_sync, `broker_connections.${id}.last_sync`);
  }
  if (o.metrics != null) {
    conn.metrics = assertBrokerConnectionMetrics(
      o.metrics,
      `broker_connections.${id}.metrics`,
    );
  }
  return conn;
}

export function readBrokerConnections(state: InvestorState): Record<string, BrokerConnection> {
  const s = state as StateWithLegacy;
  const hasMap = s.broker_connections != null;
  const hasLegacy = s.ibkr_flex != null;
  if (hasMap && hasLegacy) {
    throw new Error(
      'Conflicting IBKR config: both broker_connections and ibkr_flex are set.',
    );
  }
  if (hasMap) {
    const raw = asRecord(s.broker_connections, 'broker_connections');
    const out: Record<string, BrokerConnection> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (!id.trim()) throw new Error('broker_connections has an empty connector id.');
      try {
        getBrokerConnector(id);
      } catch {
        throw new Error(`Unknown broker connector "${id}" in broker_connections.`);
      }
      out[id] = parseStoredConnection(id, value);
    }
    return out;
  }
  if (hasLegacy) {
    const cfg = parseLegacyIbkrFlex(s.ibkr_flex);
    const credentials: Record<string, string> = {
      token: cfg.token,
      activity_query_id: cfg.activity_query_id,
    };
    if (cfg.tradeconf_query_id) credentials.tradeconf_query_id = cfg.tradeconf_query_id;
    return {
      ibkr: { enabled: true, credentials },
    };
  }
  return {};
}

export function persistBrokerConnections(
  state: InvestorState,
  map: Record<string, BrokerConnection>,
): void {
  const s = state as StateWithLegacy;
  s.broker_connections = map;
  delete s.ibkr_flex;
}

export function requiredCredentialsComplete(
  def: BrokerConnectorDef,
  credentials: Record<string, string>,
): boolean {
  return def.credentialFields.every((f) => !f.required || Boolean(credentials[f.id]?.trim()));
}

function deriveStatus(
  def: BrokerConnectorDef,
  conn: BrokerConnection | undefined,
): BrokerConnectionStatus {
  const enabled = conn?.enabled === true;
  if (!enabled) return 'off';
  if (!requiredCredentialsComplete(def, conn?.credentials ?? {})) return 'needs_credentials';
  if (conn?.last_sync?.ok === false) return 'error';
  return 'connected';
}

function publicCredential(
  field: CredentialFieldDef,
  stored: string | undefined,
): PublicCredentialView {
  if (!stored) return { configured: false };
  if (field.type === 'secret') {
    const view: PublicCredentialView = { configured: true };
    if (stored.length >= 4) view.last4 = stored.slice(-4);
    return view;
  }
  return { configured: true, value: stored };
}

export function publicConnectorView(
  def: BrokerConnectorDef,
  conn: BrokerConnection | undefined,
): PublicConnectorView {
  const credentials: Record<string, PublicCredentialView> = {};
  for (const field of def.credentialFields) {
    credentials[field.id] = publicCredential(field, conn?.credentials[field.id]);
  }
  const view: PublicConnectorView = {
    id: def.id,
    display_name: def.displayName,
    channel: def.channel,
    capability: def.capability,
    enabled: conn?.enabled === true,
    status: deriveStatus(def, conn),
    credential_fields: def.credentialFields.map((f) => {
      const field: PublicConnectorView['credential_fields'][number] = {
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
      };
      if (f.help) field.help = f.help;
      return field;
    }),
    credentials,
    last_sync: conn?.last_sync ?? null,
  };
  if (def.syncQueryFieldId) view.sync_query_field_id = def.syncQueryFieldId;
  if (def.helpNotes) view.help_notes = [...def.helpNotes];
  if (def.helpSteps) view.help_steps = [...def.helpSteps];
  if (def.helpHref) view.help_href = def.helpHref;
  return view;
}

export function publicCatalog(state: InvestorState): PublicConnectorView[] {
  const map = readBrokerConnections(state);
  return BROKER_CATALOG.map((def) => publicConnectorView(def, map[def.id]));
}

export interface PatchBrokerConnectionBody {
  enabled?: boolean;
  credentials?: Record<string, string | null>;
}

export function patchBrokerConnection(
  state: InvestorState,
  id: string,
  body: PatchBrokerConnectionBody,
): { view: PublicConnectorView; persisted: boolean; tokenSet: boolean } {
  let def: BrokerConnectorDef;
  try {
    def = getBrokerConnector(id);
  } catch {
    throw new UnknownConnectorError(id);
  }
  const map = { ...readBrokerConnections(state) };
  const existing = map[id];
  const hasEnabled = Object.prototype.hasOwnProperty.call(body, 'enabled');
  const credEntries = body.credentials ? Object.entries(body.credentials) : [];
  if (!hasEnabled && credEntries.length === 0) {
    return {
      view: publicConnectorView(def, existing),
      persisted: false,
      tokenSet: false,
    };
  }

  const nextCreds: Record<string, string> = { ...(existing?.credentials ?? {}) };
  let tokenSet = false;
  if (body.credentials) {
    const allowed = new Set(def.credentialFields.map((f) => f.id));
    for (const [key, val] of Object.entries(body.credentials)) {
      if (!allowed.has(key)) {
        throw new Error(`Unknown credential key "${key}" for broker connector "${id}".`);
      }
      const field = def.credentialFields.find((f) => f.id === key);
      if (!field) throw new Error(`Unknown credential key "${key}" for broker connector "${id}".`);
      if (val === null) {
        if (field.required) {
          throw new Error(`${field.label} is required.`);
        }
        delete nextCreds[key];
        continue;
      }
      if (typeof val !== 'string') {
        throw new Error(`${field.label} must be a string or null.`);
      }
      const trimmed = val.trim();
      if (!trimmed) {
        throw new Error(`${field.label} must be non-empty.`);
      }
      nextCreds[key] = trimmed;
      if (field.type === 'secret') tokenSet = true;
    }
  }
  const enabled = body.enabled !== undefined ? body.enabled : existing?.enabled === true;
  if (enabled && !requiredCredentialsComplete(def, nextCreds)) {
    const missing = def.credentialFields.find(
      (f) => f.required && !nextCreds[f.id]?.trim(),
    );
    throw new Error(`${missing?.label ?? 'Required field'} is required.`);
  }
  const next: BrokerConnection = {
    enabled,
    credentials: nextCreds,
  };
  if (existing?.last_sync) next.last_sync = existing.last_sync;
  if (existing?.metrics) next.metrics = existing.metrics;
  map[id] = next;
  persistBrokerConnections(state, map);
  return { view: publicConnectorView(def, next), persisted: true, tokenSet };
}

function requireCompleteOrThrow(def: BrokerConnectorDef, conn: BrokerConnection | undefined): BrokerConnection {
  if (!conn || !requiredCredentialsComplete(def, conn.credentials)) {
    throw new BrokerNotConfiguredError();
  }
  return conn;
}

export function resolveConnectionForSync(
  state: InvestorState,
  id: string,
): { def: BrokerConnectorDef; conn: BrokerConnection } {
  let def: BrokerConnectorDef;
  try {
    def = getBrokerConnector(id);
  } catch {
    throw new UnknownConnectorError(id);
  }
  const map = readBrokerConnections(state);
  const conn = requireCompleteOrThrow(def, map[id]);
  if (conn.enabled !== true) {
    throw new ChannelOffError(def.displayName);
  }
  return { def, conn };
}

function writeLastSync(
  state: InvestorState,
  id: string,
  last_sync: BrokerConnectionLastSync,
  secrets: string[],
): void {
  if (last_sync.ok === false) {
    if (!last_sync.error?.trim()) {
      throw new Error('last_sync.error is required when last_sync.ok is false.');
    }
    last_sync = {
      ...last_sync,
      error: redactSecrets(last_sync.error, secrets),
    };
  } else {
    const { error: _drop, ...okSync } = last_sync;
    last_sync = okSync;
  }
  const map = { ...readBrokerConnections(state) };
  const prev = map[id] ?? { enabled: true, credentials: {} };
  map[id] = { ...prev, last_sync };
  persistBrokerConnections(state, map);
  saveState(state);
}

export async function syncBrokerConnection(
  state: InvestorState,
  id: string,
  transport?: FlexTransport,
): Promise<{ view: PublicConnectorView; applied: BrokerApplyResult }> {
  const slug = state.user.slug;
  if (!slug) throw new Error('Investor state has no user.slug.');
  const key = inflightKey(slug, id);
  if (inflight.has(key)) throw new SyncInProgressError();
  inflight.add(key);
  const at = new Date().toISOString();
  let secrets: string[] = [];
  try {
    const { def, conn } = resolveConnectionForSync(state, id);
    secrets = Object.entries(conn.credentials)
      .filter(([fid]) => def.credentialFields.find((f) => f.id === fid)?.type === 'secret')
      .map(([, v]) => v);
    const queryField = def.syncQueryFieldId;
    if (!queryField) {
      throw new Error(`Broker connector "${id}" has no sync query field.`);
    }
    const queryId = conn.credentials[queryField];
    const token = conn.credentials.token;
    if (!queryId || !token) throw new BrokerNotConfiguredError();
    try {
      const xml = await fetchFlexStatement(
        { token, queryId },
        transport ?? createFlexTransport(),
      );
      let applied: BrokerApplyResult;
      try {
        const doc = parseFlexQueryXml(xml);
        applied = await applyFlexStatement(state, doc, xml);
      } catch (parseErr) {
        const asOf = new Date().toISOString().slice(0, 10);
        const parseMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const triage = archiveBrokerTriage({
          slug,
          connectorId: id,
          body: xml,
          asOf,
          error: parseMessage,
        });
        const inv = triage.case.inventory;
        const invLine = `triage ${id}/${triage.case.id} looks_like=${inv.looks_like} cash_currencies=${inv.cash_currencies.join(',') || '(none)'} position_qty_attr=${inv.position_qty_attr}`;
        const spec = loadBrokerParserSpec(slug, id);
        if (!spec) {
          throw new Error(
            `${parseMessage} ${invLine}. Raw at ${triage.rawPath}. list_broker_triage then read_broker_raw, or save_broker_parser / apply_broker_statement.`,
          );
        }
        try {
          applied = await applyBrokerStatement(
            state,
            id,
            runCsvTablesSpec(xml.toString('utf8'), spec, def.channel),
            xml,
          );
        } catch (specErr) {
          throw new Error(
            `${specErr instanceof Error ? specErr.message : String(specErr)} ${invLine}. Raw at ${triage.rawPath}. Catalog parse: ${parseMessage}`,
          );
        }
      }
      const last_sync: BrokerConnectionLastSync = {
        at,
        ok: true,
        as_of: applied.asOf,
        account_id: applied.accountId,
        lots_upserted: applied.lotsUpserted,
        lots_removed: applied.lotsRemoved,
      };
      if (applied.skipped.length > 0) {
        last_sync.not_imported = applied.skipped.map(formatBrokerSkip);
      }
      writeLastSync(state, id, last_sync, secrets);
      const map = readBrokerConnections(state);
      return { view: publicConnectorView(def, map[id]), applied };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      writeLastSync(state, id, { at, ok: false, error: message }, secrets);
      throw e;
    }
  } finally {
    inflight.delete(key);
  }
}

export function writeIbkrConnectionFromTool(state: InvestorState, cfg: IbkrFlexConfig): void {
  const def = getBrokerConnector('ibkr');
  const map = { ...readBrokerConnections(state) };
  const prev = map.ibkr;
  const credentials: Record<string, string> = {
    token: cfg.token.trim(),
    activity_query_id: cfg.activity_query_id.trim(),
  };
  if (!credentials.token) throw new Error('ibkr_flex.token is required.');
  if (!credentials.activity_query_id) throw new Error('ibkr_flex.activity_query_id is required.');
  if (cfg.tradeconf_query_id?.trim()) {
    credentials.tradeconf_query_id = cfg.tradeconf_query_id.trim();
  }
  const next: BrokerConnection = {
    enabled: true,
    credentials,
  };
  if (prev?.last_sync) next.last_sync = prev.last_sync;
  if (prev?.metrics) next.metrics = prev.metrics;
  map.ibkr = next;
  persistBrokerConnections(state, map);
  void def;
}

export function readIbkrConnectionConfig(state: InvestorState): IbkrFlexConfig {
  const def = getBrokerConnector('ibkr');
  const map = readBrokerConnections(state);
  const conn = map.ibkr;
  if (!conn || !requiredCredentialsComplete(def, conn.credentials)) {
    throw new BrokerNotConfiguredError();
  }
  const cfg: IbkrFlexConfig = {
    token: conn.credentials.token,
    activity_query_id: conn.credentials.activity_query_id,
  };
  if (conn.credentials.tradeconf_query_id) {
    cfg.tradeconf_query_id = conn.credentials.tradeconf_query_id;
  }
  return cfg;
}

