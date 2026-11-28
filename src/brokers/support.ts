import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SaxesParser } from 'saxes';
import { assertUserId, resolveDataRoot } from 'utarus';
import { PEER_CATALOG } from '../agents/roster.js';
import { FlexHttpError } from '../ibkr/flex-client.js';
import { FlexProtocolError } from '../ibkr/flex-parse.js';
import { brokerRawDataFile, fetchRawData } from '../raw-data/store.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { publicBrokerAccounts, readBrokerAccountModel } from './accounts.js';
import { BROKER_CATALOG } from './catalog.js';
import { redactSecrets } from './connections.js';
import { BrokerHttpError } from './errors.js';
import { brokerSyncBinding } from './sync-retries.js';
import { getBrokerSyncRun, listBrokerSyncRuns } from './sync-history.js';

export type BrokerHelpScope = { connectionId: unknown; runId?: unknown } | { sourceId: unknown } | { brokerId: unknown };
export type BrokerHelpOperation = 'setup' | 'save_access' | 'discover_accounts' | 'create_account' |
  'save_account' | 'check_token' | 'create_token' | 'preview' | 'sync' | 'full_sync';

function bindingFingerprint(conn: Parameters<typeof brokerSyncBinding>[0]) {
  return createHash('sha256').update(brokerSyncBinding(conn)).digest('hex');
}

function receiptPath(userId: string, id: string) {
  assertUserId(userId);
  return join(resolveDataRoot(), 'broker-help', userId, id + '.json');
}

/** Summarize the broker's response structure. Values, identifiers and raw text stay in the source archive. */
function responseShape(brokerId: string, raw: Buffer, accountId?: string) {
  const text = raw.toString('utf8');
  if (brokerId === 'ibkr') {
    const sections = { OpenPositions: 0, CashReport: 0, EquitySummaryInBase: 0 };
    const cash = { rows: 0, withCurrency: 0, withEndingCash: 0 };
    const positions = { rows: 0, withPosition: 0, withQuantity: 0, optionRows: 0, optionsWithMultiplier: 0 };
    try {
      const parser = new SaxesParser();
      let statements = 0;
      let matchingStatements = 0;
      let include = !accountId;
      parser.on('opentag', ({ name, attributes }) => {
        if (name === 'FlexStatement') {
          statements++;
          include = !accountId || attributes.accountId === accountId;
          if (include) matchingStatements++;
        }
        if (!include) return;
        if (Object.hasOwn(sections, name)) sections[name as keyof typeof sections]++;
        if (name === 'CashReportCurrency') {
          cash.rows++;
          if (attributes.currency?.trim()) cash.withCurrency++;
          if (attributes.endingCash?.trim()) cash.withEndingCash++;
        } else if (name === 'OpenPosition') {
          positions.rows++;
          if (attributes.position?.trim()) positions.withPosition++;
          if (attributes.quantity?.trim()) positions.withQuantity++;
          if (attributes.assetCategory === 'OPT' || attributes.assetCategory === 'FOP') {
            positions.optionRows++;
            if (attributes.multiplier?.trim()) positions.optionsWithMultiplier++;
          }
        }
      });
      parser.on('closetag', ({ name }) => { if (name === 'FlexStatement') include = !accountId; });
      parser.write(text).close();
      return { format: 'XML', statements, matchingStatements, sections, cash, positions };
    } catch {
      return { format: 'unreadable XML' };
    }
  }
  try {
    const body: unknown = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return { format: 'JSON' };
    // These are endpoint keys in the adapters' archived envelopes, never broker data fields.
    const sectionNames = ['accounts', 'authorized', 'managed_accounts', 'positions', 'funds', 'assets',
      'balances', 'fund_positions', 'history', 'option_history', 'fills_history', 'orders_history'];
    return { format: 'JSON', sections: sectionNames.filter(name => Object.hasOwn(body, name)) };
  } catch {
    return { format: 'unreadable JSON' };
  }
}

function storedResponse(userId: string, channel: string, brokerId: string, rawId: string, accountId?: string) {
  try {
    const file = brokerRawDataFile(userId, channel, rawId);
    if (!file) return { archived: false };
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = fetchRawData(userId, file.id, file.version, offset, 65536, 'base64');
      chunks.push(Buffer.from(page.content, 'base64'));
      offset = page.next_offset;
    }
    return { archived: true, ...responseShape(brokerId, Buffer.concat(chunks), accountId) };
  } catch {
    return { archived: false };
  }
}

function providerFailure(error: unknown) {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof FlexHttpError || cause instanceof FlexProtocolError) return { providerCode: cause.code };
    if (cause instanceof BrokerHttpError) return { providerCode: cause.vendorCode };
  }
  return {};
}

function stringValues(value: unknown): string[] {
  return typeof value === 'string' ? [value, value.trim()] : value && typeof value === 'object'
    ? Object.values(value).flatMap(stringValues) : [];
}

export function recordBrokerHelp(state: InvestorState, scope: BrokerHelpScope, operation: BrokerHelpOperation,
  attempt?: { error?: unknown; privateInput?: unknown; raw?: Buffer; runId?: string; discoveredAccounts?: number;
    notices?: string[]; historyDeferred?: boolean }) {
  const model = readBrokerAccountModel(state);
  const connectionId = 'connectionId' in scope && typeof scope.connectionId === 'string' ? scope.connectionId : undefined;
  const conn = connectionId && Object.hasOwn(model.connections, connectionId) ? model.connections[connectionId] : undefined;
  if ('connectionId' in scope && !conn) return null;
  const sourceId = conn?.source_id ?? ('sourceId' in scope && typeof scope.sourceId === 'string' ? scope.sourceId : undefined);
  const source = sourceId && Object.hasOwn(model.sources, sourceId) ? model.sources[sourceId] : undefined;
  if ('sourceId' in scope && !source) return null;
  const brokerId = conn?.broker_id ?? source?.broker_id ?? ('brokerId' in scope ? scope.brokerId : undefined);
  const broker = BROKER_CATALOG.find(def => def.id === brokerId);
  if (!broker) return null;

  const owner = state.user.id;
  const view = conn && publicBrokerAccounts(state).connections.find(account => account.id === connectionId);
  const requestedRun = 'runId' in scope ? scope.runId : attempt?.runId;
  if (requestedRun !== undefined && (!conn || typeof requestedRun !== 'string')) return null;
  const run = conn && (typeof requestedRun === 'string' ? getBrokerSyncRun(owner, conn.channel, requestedRun)
    : !attempt ? listBrokerSyncRuns(owner, conn.channel, 0, 1).runs[0] : undefined);
  if (requestedRun !== undefined && !run) return null;

  const privateValues = [...new Set([
    ...stringValues(source?.credentials), ...stringValues(conn?.config), ...stringValues(attempt?.privateInput),
    conn?.account_id, conn?.label, run?.account_id, owner,
  ].filter((value): value is string => !!value))].sort((a, b) => b.length - a.length);
  const redactions = [...new Set(privateValues.flatMap(value => [
    value, JSON.stringify(value).slice(1, -1), new URLSearchParams({ value }).toString().slice('value='.length),
  ]))].sort((a, b) => b.length - a.length);
  const clean = (value: string) => redactSecrets(value, redactions);
  const error = attempt?.error;
  const providerCode = providerFailure(error).providerCode;
  const errorMessage = error instanceof Error ? error.message : run?.error ?? (!attempt ? view?.last_sync?.error : undefined);
  const currentSync = view?.last_sync && (run ? view.last_sync.at === run.at : !attempt) ? view.last_sync : undefined;
  const remoteResponse = attempt?.raw ? { archived: false, ...responseShape(broker.id, attempt.raw, conn?.account_id) }
    : conn && run?.raw_data_id ? storedResponse(owner, conn.channel, broker.id, run.raw_data_id, conn.account_id) : undefined;
  const usesOpenD = broker.id === 'futubull' && !!source?.credentials.opend_port && !source.credentials.app_key;
  const isFlexStatement = !!remoteResponse && 'matchingStatements' in remoteResponse && !!remoteResponse.matchingStatements;
  const documentation = usesOpenD ? 'https://openapi.futunn.com/futu-api-doc/en/opend/opend-intro.html'
    : isFlexStatement ? 'https://www.ibkrguides.com/clientportal/performanceandstatements/activityflex.htm'
    : broker.helpHref;
  const facts = {
    broker: broker.displayName,
    transport: broker.id === 'futubull' ? usesOpenD ? 'OpenD' : 'Cloud OpenAPI' : undefined,
    documentation,
    step: operation === 'sync' && !attempt && !run && !view?.last_sync ? 'setup' : operation,
    capturedAt: new Date().toISOString(),
    failure: errorMessage ? { message: clean(errorMessage), providerCode: providerCode && !privateValues.includes(providerCode) ? providerCode : undefined } : undefined,
    discovery: attempt?.discoveredAccounts === undefined ? undefined : { authorizedAccounts: attempt.discoveredAccounts },
    account: view && { bound: !!conn?.account_id, enabled: view.enabled, retryAt: view.sync_retry?.retry_at },
    fields: broker.credentialFields.map(field => ({
      label: field.label, required: field.required, saved: !!(source?.credentials[field.id] ?? conn?.config[field.id]),
    })),
    sync: run ? { at: run.at, trigger: run.trigger, ok: run.ok, statementDate: run.as_of } : undefined,
    snapshotDeferred: currentSync?.snapshot_deferred,
    historyDeferred: attempt?.historyDeferred,
    importNotices: (attempt?.notices ?? currentSync?.not_imported)?.map(clean),
    remoteResponse,
  };
  const id = randomUUID();
  const path = receiptPath(owner, id);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const receipt = { id, broker: broker.displayName, ...(conn && { connectionId, binding: bindingFingerprint(conn) }), facts };
  writeFileSync(path, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  return receipt;
}

export function readBrokerHelp(state: InvestorState, id: unknown): ReturnType<typeof recordBrokerHelp> {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) return null;
  try {
    const receipt = JSON.parse(readFileSync(receiptPath(state.user.id, id), 'utf8')) as NonNullable<ReturnType<typeof recordBrokerHelp>>;
    if (receipt.connectionId) {
      const current = readBrokerAccountModel(state).connections[receipt.connectionId];
      if (!current || bindingFingerprint(current) !== receipt.binding) return null;
    }
    return receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function brokerHelpChat(receipt: NonNullable<ReturnType<typeof recordBrokerHelp>>) {
  return {
    text: `@${PEER_CATALOG.bookkeeper.label} Help me troubleshoot ${receipt.broker} in Brokers and walk me through the next step.`,
    pageContext: { broker_help_id: receipt.id },
  };
}
