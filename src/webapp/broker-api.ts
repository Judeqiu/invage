import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
/**
 * Session-authenticated broker connection APIs.
 * Not agent tools. Principal is loadSessionState(req) only — no targetSlug.
 */

import { Router, text as textBody, type Request, type Response } from 'express';
import { importOptionExecutions } from '../brokers/import-executions.js';
import { loadSessionState, type AuthUser } from 'utarus';
import {
  ChannelOffError,
  BrokerNotConfiguredError,
  patchBrokerConnection,
  publicCatalog,
  SyncInProgressError,
  syncBrokerConnection,
  UnknownConnectorError,
  type PatchBrokerConnectionBody,
} from '../brokers/connections.js';
import { readFlexEgressIpv4 } from '../brokers/egress.js';
import { BrokerHttpError, BrokerParseError } from '../brokers/errors.js';
import { FlexHttpError } from '../ibkr/flex-client.js';
import { FlexProtocolError } from '../ibkr/flex-parse.js';
import { formatBrokerSkip } from '../brokers/statement.js';
import { getBrokerConnector } from '../brokers/catalog.js';
import { brokerRawDataFile, fetchRawData, latestBrokerRawData } from '../raw-data/store.js';
import { getBrokerSyncRun, listBrokerSyncRuns } from '../brokers/sync-history.js';
import { readBrokerConnections } from '../brokers/connections.js';
import { redactSecrets } from '../brokers/connections.js';
import { fetchMooMooAuthorizedAccounts } from '../moomoo/moomoo-client.js';
import { parseSignAlg } from '../moomoo/moomoo-sign.js';
import { checkWebullToken, createWebullToken, parseWebullRegion, type WebullCredentials } from '../webull/webull-client.js';
import type { InvestorState } from '../state/portfolio-state.js';
import {
  addBrokerAccount, addBrokerSource, discoverBrokerAccounts, patchBrokerAccount,
  patchBrokerSource, previewBrokerAccount, publicBrokerAccounts,
  readBrokerAccountModel, syncBrokerAccount,
} from '../brokers/accounts.js';

function connectorIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('connector id is required.');
  }
  return id;
}

async function sessionInvestor(req: Request): Promise<InvestorSnapshot> {
  const user = (req as Request & { user?: AuthUser }).user;
  if (!user?.userId) {
    throw Object.assign(new Error('No session user.'), { httpStatus: 401 });
  }
  const snapshot = await loadSessionState(req);
  return { state: snapshot.state as InvestorState, revision: snapshot.revision };
}

function jsonError(
  res: Response,
  status: number,
  error: string,
  message: string,
): void {
  res.status(status).json({ error, message });
}

function mapSyncError(e: unknown, res: Response): void {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof UnknownConnectorError) {
    jsonError(res, 404, e.errorCode, message);
    return;
  }
  if (e instanceof ChannelOffError) {
    jsonError(res, 409, e.errorCode, message);
    return;
  }
  if (e instanceof BrokerNotConfiguredError) {
    jsonError(res, 400, e.errorCode, message);
    return;
  }
  if (e instanceof SyncInProgressError) {
    jsonError(res, 409, e.errorCode, message);
    return;
  }
  if (e instanceof FlexHttpError) {
    jsonError(res, 502, 'flex_http', message);
    return;
  }
  if (e instanceof FlexProtocolError) {
    jsonError(res, 400, 'flex_parse', message);
    return;
  }
  if (e instanceof BrokerHttpError) {
    jsonError(res, 502, e.errorCode, message);
    return;
  }
  if (e instanceof BrokerParseError) {
    jsonError(res, 400, e.errorCode, message);
    return;
  }
  if (
    /missing OpenPositions|missing CashReport|CashReport has no currency rows|expected FlexQueryResponse|expected one FlexStatement|returned CSV/.test(
      message,
    )
  ) {
    jsonError(res, 400, 'flex_parse', message);
    return;
  }
  jsonError(res, /IBKR Flex/.test(message) ? 400 : 500, /IBKR Flex/.test(message) ? 'flex_apply' : 'broker_apply', message);
}

function mapStoreError(e: unknown, res: Response): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (
    /Conflicting IBKR config|Unknown broker connector ".+" in broker_connections|Unknown credential key|broker_connections/.test(
      message,
    )
  ) {
    jsonError(res, 500, 'broker_connections_invalid', message);
    return true;
  }
  return false;
}

function savedWebullCredentials(state: InvestorState): WebullCredentials {
  const raw = readBrokerConnections(state).webull?.credentials;
  if (!raw?.app_key || !raw.app_secret || !raw.region) {
    throw new BrokerNotConfiguredError('Webull');
  }
  const credentials: WebullCredentials = {
    app_key: raw.app_key,
    app_secret: raw.app_secret,
    region: parseWebullRegion(raw.region),
  };
  if (raw.access_token) credentials.access_token = raw.access_token;
  return credentials;
}

export function createBrokerConnectionsRouter(): Router {
  const router = Router();

  function accountError(res: Response, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    const code = /account mismatch|account binding differs|does not match the broker/i.test(message) ? 'account_mismatch'
      : /Duplicate broker account/i.test(message) ? 'duplicate_account'
      : /Unknown broker source|Unknown Webull access source/i.test(message) ? 'unknown_source'
      : /Unknown broker connection/i.test(message) ? 'unknown_connection'
      : /already in progress/i.test(message) ? 'sync_in_progress'
      : /credentials are incomplete|Required broker fields are incomplete/i.test(message) ? 'needs_credentials'
      : 'broker_account_error';
    const status = (e as { httpStatus?: number }).httpStatus === 401 ? 401
      : /Unknown broker/.test(message) ? 404
      : /already in progress|paused|Duplicate broker account|revision|conflict/i.test(message) ? 409
      : /HTTP |response signature/.test(message) ? 502
      : /required|invalid|missing|mismatch|does not match|incomplete|cannot|must|duplicate|unknown .*field|no .*account|not .*account|not allowed|Flex|statement|parse|CSV/i.test(message) ? 400 : 500;
    jsonError(res, status, code, message);
  }
  router.get('/broker-catalog', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      res.json({ brokers: publicBrokerAccounts(snapshot.state).catalog });
    } catch (e) { accountError(res, e); }
  });
  router.get('/broker-access', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ sources: publicBrokerAccounts(snapshot.state).sources });
    } catch (e) { accountError(res, e); }
  });
  router.get('/broker-accounts', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const data = publicBrokerAccounts(snapshot.state);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ...data, egress_ipv4: readFlexEgressIpv4(),
        connections: data.connections.map(c => ({ ...c, latest_raw_data: latestBrokerRawData(snapshot.state.user.id, c.channel) })) });
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-access', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const id = addBrokerSource(snapshot.state, req.body?.broker_id, req.body?.credentials ?? {});
      await saveInvestor(snapshot);
      res.status(201).json({ id });
    } catch (e) { accountError(res, e); }
  });
  router.patch('/broker-access/:id', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      patchBrokerSource(snapshot.state, String(req.params.id), req.body?.credentials ?? {});
      await saveInvestor(snapshot);
      res.json({ ok: true });
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-access/:id/discover', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const accounts = await discoverBrokerAccounts(snapshot.state, String(req.params.id), req.body?.config ?? {});
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ accounts });
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-access/:id/webull-token', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const id = String(req.params.id);
      const source = readBrokerAccountModel(snapshot.state).sources[id];
      if (!source || source.broker_id !== 'webull') throw new Error('Unknown Webull access source.');
      const c = source.credentials;
      let created;
      try {
        created = await createWebullToken({ app_key: c.app_key, app_secret: c.app_secret,
          region: parseWebullRegion(c.region), ...(c.access_token ? { access_token: c.access_token } : {}) });
      } catch (e) {
        throw new Error(redactSecrets(e instanceof Error ? e.message : String(e), [c.app_secret, c.access_token].filter((v): v is string => !!v)));
      }
      patchBrokerSource(snapshot.state, id, { access_token: created.token });
      await saveInvestor(snapshot);
      res.json({ status: created.status });
    } catch (e) { accountError(res, e); }
  });
  router.get('/broker-access/:id/webull-token', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const source = readBrokerAccountModel(snapshot.state).sources[String(req.params.id)];
      if (!source || source.broker_id !== 'webull') throw new Error('Unknown Webull access source.');
      const c = source.credentials;
      try {
        res.json(await checkWebullToken({ app_key: c.app_key, app_secret: c.app_secret,
          region: parseWebullRegion(c.region), ...(c.access_token ? { access_token: c.access_token } : {}) }));
      } catch (e) {
        throw new Error(redactSecrets(e instanceof Error ? e.message : String(e), [c.app_secret, c.access_token].filter((v): v is string => !!v)));
      }
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-accounts', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const id = addBrokerAccount(snapshot.state, req.body);
      await saveInvestor(snapshot);
      res.status(201).json({ id });
    } catch (e) { accountError(res, e); }
  });
  router.patch('/broker-accounts/:id', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      patchBrokerAccount(snapshot.state, String(req.params.id), req.body ?? {});
      await saveInvestor(snapshot);
      res.json({ ok: true });
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-accounts/:id/preview', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      res.json(await previewBrokerAccount(snapshot.state, String(req.params.id)));
    } catch (e) { accountError(res, e); }
  });
  router.post('/broker-accounts/:id/sync', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      res.json(await syncBrokerAccount(snapshot, String(req.params.id)));
    } catch (e) { accountError(res, e); }
  });
  router.get('/broker-accounts/:id/sync-history', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const conn = readBrokerAccountModel(snapshot.state).connections[String(req.params.id)];
      if (!conn) throw new Error('Unknown broker connection.');
      const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(listBrokerSyncRuns(snapshot.state.user.id, conn.channel, offset));
    } catch (e) { accountError(res, e); }
  });
  router.get('/broker-accounts/:id/raw-data', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const conn = readBrokerAccountModel(snapshot.state).connections[String(req.params.id)];
      if (!conn) throw new Error('Unknown broker connection.');
      const runId = typeof req.query.run === 'string' ? req.query.run : undefined;
      const run = runId ? getBrokerSyncRun(snapshot.state.user.id, conn.channel, runId) : null;
      const file = runId
        ? run?.raw_data_id ? brokerRawDataFile(snapshot.state.user.id, conn.channel, run.raw_data_id) : null
        : latestBrokerRawData(snapshot.state.user.id, conn.channel);
      if (!file) { jsonError(res, 404, 'raw_data_not_found', 'No raw data for this connection.'); return; }
      let page = fetchRawData(snapshot.state.user.id, file.id, file.version, 0, 65536, 'base64');
      res.setHeader('Content-Type', file.id.endsWith('.xml') ? 'application/xml' : 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="broker-raw-${runId || 'latest'}${file.id.endsWith('.xml') ? '.xml' : '.json'}"`);
      res.setHeader('Content-Length', String(file.bytes));
      res.setHeader('Cache-Control', 'private, no-store');
      for (;;) {
        if (!res.write(Buffer.from(page.content, 'base64'))) {
          await new Promise<void>((resolve, reject) => {
            const drained = () => { res.off('close', closed); resolve(); };
            const closed = () => { res.off('drain', drained); reject(new Error('Download connection closed.')); };
            res.once('drain', drained);
            res.once('close', closed);
          });
        }
        if (page.next_offset === null) break;
        page = fetchRawData(snapshot.state.user.id, file.id, file.version, page.next_offset, 65536, 'base64');
      }
      res.end();
    } catch (e) {
      if (res.headersSent) res.destroy(e instanceof Error ? e : new Error(String(e)));
      else accountError(res, e);
    }
  });

  router.post('/trades/import', textBody({ type: 'application/xml', limit: '10mb' }), async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (typeof req.body !== 'string' || !req.body.trim()) {
        res.status(400).json({ error: 'invalid_xml', message: 'Upload an Activity Flex XML as application/xml.' });
        return;
      }
      res.json(await importOptionExecutions(snapshot, req.body,
        typeof req.query.connection_id === 'string' ? req.query.connection_id : undefined));
    } catch (e) {
      console.error('Execution import failed:', e);
      const status = (e as { httpStatus?: number }).httpStatus;
      res.status(status === 401 ? 401 : 400).json({ error: 'execution_import_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/broker-connections', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const { state } = snapshot;
      if (state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Broker connections are now managed in Settings → Brokers.');
        return;
      }
      const connectors = publicCatalog(state).map((conn) => ({
        ...conn,
        latest_raw_data: latestBrokerRawData(state.user.id, conn.channel),
      }));
      res.json({
        egress_ipv4: readFlexEgressIpv4(),
        connectors,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if ((e as { httpStatus?: number }).httpStatus === 401) {
        jsonError(res, 401, 'unauthorized', message);
        return;
      }
      if (mapStoreError(e, res)) return;
      jsonError(res, 500, 'broker_connections_invalid', message);
    }
  });

  router.get('/broker-connections/:id/raw-data', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (snapshot.state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const connector = getBrokerConnector(connectorIdParam(req));
      const file = latestBrokerRawData(snapshot.state.user.id, connector.channel);
      if (!file) {
        jsonError(res, 404, 'raw_data_not_found', `No saved raw data for ${connector.displayName}.`);
        return;
      }
      let page = fetchRawData(snapshot.state.user.id, file.id, file.version, 0, 65536, 'base64');
      const name = `${connector.id}-${file.id.split('/').at(-1)}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', file.id.endsWith('.xml') ? 'application/xml' : file.id.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(file.bytes));
      res.setHeader('Cache-Control', 'private, no-store');
      for (;;) {
        const chunk = Buffer.from(page.content, 'base64');
        if (!res.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            const drained = () => { res.off('close', closed); resolve(); };
            const closed = () => { res.off('drain', drained); reject(new Error('Download connection closed.')); };
            res.once('drain', drained);
            res.once('close', closed);
          });
        }
        if (page.next_offset === null) break;
        page = fetchRawData(snapshot.state.user.id, file.id, file.version, page.next_offset, 65536, 'base64');
      }
      res.end();
    } catch (e) {
      if (res.headersSent) {
        res.destroy(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const status = (e as { httpStatus?: number }).httpStatus;
      if (status === 401) jsonError(res, 401, 'unauthorized', 'No session user.');
      else if (e instanceof UnknownConnectorError || /Unknown broker connector/.test(String(e))) jsonError(res, 404, 'unknown_connector', String(e));
      else jsonError(res, 500, 'raw_data_download_failed', e instanceof Error ? e.message : String(e));
    }
  });

  router.get('/broker-connections/moomoo/accounts', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (snapshot.state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const credentials = readBrokerConnections(snapshot.state).moomoo?.credentials;
      if (!credentials?.app_key || !credentials.private_key) {
        jsonError(res, 400, 'not_configured', 'Save the MooMoo AppKey and private key first.');
        return;
      }
      const accounts = await fetchMooMooAuthorizedAccounts({
        app_key: credentials.app_key,
        private_key: credentials.private_key,
        sign_alg: parseSignAlg(credentials.sign_alg),
      });
      res.json({ accounts });
    } catch (e) {
      const status = (e as { httpStatus?: number }).httpStatus;
      if (status === 401) {
        jsonError(res, 401, 'unauthorized', 'No session user.');
      } else {
        mapSyncError(e, res);
      }
    }
  });

  router.post('/broker-connections/webull/token', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (snapshot.state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const credentials = savedWebullCredentials(snapshot.state);
      const created = await createWebullToken(credentials);
      patchBrokerConnection(snapshot.state, 'webull', { credentials: { access_token: created.token } });
      snapshot.state.log.push({ ts: new Date().toISOString().slice(0, 10), action: 'webull_token_create' });
      await saveInvestor(snapshot);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ status: created.status });
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus === 401) {
        jsonError(res, 401, 'unauthorized', 'No session user.');
      } else {
        mapSyncError(e, res);
      }
    }
  });

  router.get('/broker-connections/webull/token', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (snapshot.state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const credentials = savedWebullCredentials(snapshot.state);
      const checked = await checkWebullToken(credentials);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(checked);
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus === 401) {
        jsonError(res, 401, 'unauthorized', 'No session user.');
      } else {
        mapSyncError(e, res);
      }
    }
  });

  router.patch('/broker-connections/:id', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const { state } = snapshot;
      if (state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const id = connectorIdParam(req);
      const body = req.body as PatchBrokerConnectionBody;
      if (body == null || typeof body !== 'object' || Array.isArray(body)) {
        jsonError(res, 400, 'invalid_body', 'PATCH body must be a JSON object.');
        return;
      }
      const result = patchBrokerConnection(state, id, body);
      if (result.persisted) {
        state.log.push({
          ts: new Date().toISOString().slice(0, 10),
          action: 'broker_connection_patch',
          connector: id,
          enabled: result.view.enabled,
          token_set: result.tokenSet,
        });
        await saveInvestor(snapshot);
      }
      res.json({
        ...result.view,
        latest_raw_data: latestBrokerRawData(state.user.id, id),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if ((e as { httpStatus?: number }).httpStatus === 401) {
        jsonError(res, 401, 'unauthorized', message);
        return;
      }
      if (e instanceof UnknownConnectorError) {
        jsonError(res, 404, e.errorCode, message);
        return;
      }
      if (mapStoreError(e, res)) return;
      jsonError(res, 400, 'invalid_patch', message);
    }
  });

  router.post('/broker-connections/:id/sync', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      const { state } = snapshot;
      if (state.broker_sources) {
        jsonError(res, 410, 'legacy_broker_api', 'Use account connections in Settings → Brokers.');
        return;
      }
      const id = connectorIdParam(req);
      const { view, applied } = await syncBrokerConnection(snapshot, id);
      res.json({
        ...view,
        latest_raw_data: latestBrokerRawData(state.user.id, id),
        apply: {
          lots_upserted: applied.lotsUpserted,
          lots_removed: applied.lotsRemoved,
          as_of: applied.asOf,
          account_id: applied.accountId,
          cash: applied.cash,
          not_imported: applied.skipped.map(formatBrokerSkip),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if ((e as { httpStatus?: number }).httpStatus === 401) {
        jsonError(res, 401, 'unauthorized', message);
        return;
      }
      if (mapStoreError(e, res)) return;
      mapSyncError(e, res);
    }
  });

  return router;
}
