/**
 * Session-authenticated broker connection APIs.
 * Not agent tools. Principal is loadSessionState(req) only — no targetSlug.
 */

import { Router, type Request, type Response } from 'express';
import { loadSessionState, saveState, type AuthUser } from 'utarus';
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
import { FlexHttpError } from '../ibkr/flex-client.js';
import { FlexProtocolError } from '../ibkr/flex-parse.js';
import { formatBrokerSkip } from '../brokers/statement.js';
import type { InvestorState } from '../state/portfolio-state.js';

function connectorIdParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('connector id is required.');
  }
  return id;
}

function sessionInvestor(req: Request): InvestorState {
  const user = (req as Request & { user?: AuthUser }).user;
  if (!user?.slug) {
    throw Object.assign(new Error('No session user.'), { httpStatus: 401 });
  }
  return loadSessionState(req) as InvestorState;
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
  if (
    /missing OpenPositions|missing CashReport|CashReport has no currency rows|expected FlexQueryResponse|expected one FlexStatement|returned CSV/.test(
      message,
    )
  ) {
    jsonError(res, 400, 'flex_parse', message);
    return;
  }
  jsonError(res, /IBKR Flex/.test(message) ? 400 : 500, 'flex_apply', message);
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

export function createBrokerConnectionsRouter(): Router {
  const router = Router();

  router.get('/broker-connections', (req: Request, res: Response) => {
    try {
      const state = sessionInvestor(req);
      const connectors = publicCatalog(state);
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

  router.patch('/broker-connections/:id', (req: Request, res: Response) => {
    try {
      const state = sessionInvestor(req);
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
        saveState(state);
      }
      res.json(result.view);
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
      const state = sessionInvestor(req);
      const id = connectorIdParam(req);
      const { view, applied } = await syncBrokerConnection(state, id);
      res.json({
        ...view,
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
