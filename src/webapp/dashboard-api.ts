/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { createHash } from 'node:crypto';
import { readDashboardConfig } from './dashboard-config.js';
import { Router, type Request, type Response } from 'express';
import { loadSessionState, targetUserId, type AuthUser } from 'utarus';
import { loadDashboardForSlug } from './dashboard-data.js';
import { loadWatchlistForSlug } from './watchlist-data.js';
import { loadInvestor } from '../state/investor-store.js';
import { buildExecutionJournal, validDate } from '../brokers/option-executions.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import { optionHistoryForState } from './option-history-data.js';
import { optionRelationshipsForState } from './option-relationships-data.js';
import { isBooksEnabled } from '../books/db.js';
import { loadBookPage } from './book-data.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { fetchHistoricalCloses } from '../market/fetch-history.js';
import { openOptionTradeDetails } from './option-dashboard-data.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { getTreasury, getReportingCurrency, setTreasury, type HouseholdInvestorState } from '../state/household-state.js';
import { saveInvestor } from '../state/investor-store.js';

export function createDashboardApiRouter(): Router {
  const router = Router();
  // Keep snapshots on the server, scoped to the login and selected user.
  // A fresh login, a book edit/sync, expiry, or explicit refresh rebuilds them.
  const snapshots = new Map<string, { revision: number; at: number; body: unknown }>();
  async function snapshotContext(req: Request, slug: string) {
    const session = req.cookies?.bindrive_session;
    if (typeof session !== 'string' || !session) return null;
    const key = createHash('sha256').update(session).update(':' + slug).digest('hex');
    const { revision } = await loadInvestor(slug);
    return { key, revision };
  }
  function readSnapshot(context: { key: string; revision: number } | null) {
    if (!context) return null;
    const entry = snapshots.get(context.key);
    if (!entry) return null;
    const today = new Date().toISOString().slice(0, 10);
    const snapshotDay = new Date(entry.at).toISOString().slice(0, 10);
    if (entry.revision !== context.revision || snapshotDay !== today || Date.now() - entry.at > 24 * 60 * 60 * 1000) {
      snapshots.delete(context.key);
      return null;
    }
    return entry.body;
  }
  router.get('/dashboard-cache', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
      const slug = await targetUserId(req, user);
      res.json(readSnapshot(await snapshotContext(req, slug)));
    } catch {
      res.status(500).json({ error: 'dashboard_failed', message: 'Could not read the portfolio snapshot.' });
    }
  });

  router.get('/portfolio-settings', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
      const snapshot = await loadSessionState(req);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ reporting_currency: getReportingCurrency(snapshot.state as HouseholdInvestorState) });
    } catch (e) {
      res.status(500).json({ error: 'settings_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.put('/portfolio-settings', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
      const currency = req.body?.reporting_currency;
      if (typeof currency !== 'string' || !/^[A-Z]{3,4}$/.test(currency)) {
        res.status(400).json({ error: 'invalid_currency', message: 'Choose a 3–4 letter uppercase reporting currency.' });
        return;
      }
      const snapshot = await loadSessionState(req);
      const state = snapshot.state as HouseholdInvestorState;
      const current = getTreasury(state)?.reporting_currency ?? null;
      if (current !== currency) {
        const today = new Date().toISOString().slice(0, 10);
        setTreasury(state, { reporting_currency: currency, updated_at: today });
        state.log.push({ ts: today, action: 'treasury_set', reporting_currency: currency });
        await saveInvestor({ state, revision: snapshot.revision });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ reporting_currency: currency });
    } catch (e) {
      res.status(500).json({ error: 'settings_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/book', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      if (!isBooksEnabled()) {
        res.status(503).json({ error: 'books_unavailable', message: 'Books of record are not configured.' });
        return;
      }
      const offset = Number(req.query.offset ?? 0);
      const limit = Number(req.query.limit ?? 25);
      const channel = req.query.channel;
      const currency = req.query.currency;
      const entryType = req.query.type;
      const from = req.query.from;
      const to = req.query.to;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
          !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
          channel !== undefined && (typeof channel !== 'string' || channel.length > 120) ||
          currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3,4}$/.test(currency)) ||
          entryType !== undefined && (typeof entryType !== 'string' || !entryType.trim() || entryType.length > 120) ||
          from !== undefined && (typeof from !== 'string' || !validDate(from)) ||
          to !== undefined && (typeof to !== 'string' || !validDate(to)) ||
          typeof from === 'string' && typeof to === 'string' && from > to) {
        res.status(400).json({ error: 'invalid_filter', message: 'Invalid Book filter or page.' });
        return;
      }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const payload = await loadBookPage(snapshot.state.user.id, {
        offset, limit,
        ...(channel !== undefined ? { channel: channel as string } : {}),
        ...(currency !== undefined ? { currency: currency as string } : {}),
        ...(entryType !== undefined ? { entryType: entryType as string } : {}),
        ...(from !== undefined ? { from: from as string } : {}),
        ...(to !== undefined ? { to: to as string } : {}),
      });
      res.json(payload);
    } catch (e) {
      console.error('Book page failed:', e);
      res.status(500).json({ error: 'book_failed', message: 'Could not load the books of record.' });
    }
  });

  router.get('/trades', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      res.json(buildExecutionJournal(snapshot.state.option_executions));
    } catch (e) {
      console.error('Execution journal failed:', e);
      res.status(500).json({ error: 'journal_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/option-open-close', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const key = req.query.position;
      if (typeof key !== 'string' || !key || key.length > 200) {
        res.status(400).json({ error: 'invalid_position', message: 'Choose an open option position.' }); return;
      }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const portfolio = getPortfolio(snapshot.state);
      const holding = portfolio[key];
      if (!holding?.option) { res.status(404).json({ error: 'not_found', message: 'Open option position not found.' }); return; }
      const accounts = Object.fromEntries(Object.values(readBrokerAccountModel(snapshot.state).connections)
        .filter(conn => conn.account_id).map(conn => [conn.channel, conn.account_id!]));
      const detail = openOptionTradeDetails({ [key]: holding }, snapshot.state.option_executions, accounts, snapshot.state.option_events)[key];
      if (!detail || detail.openedFrom !== detail.openedTo) {
        res.status(409).json({ error: 'opening_date_unavailable', message: 'A single opening date is not confirmed by the recorded fills.' }); return;
      }
      const underlying = canonicalOptionUnderlying(holding.option.underlying, holding.option);
      const closes = await fetchHistoricalCloses(underlying, [detail.openedFrom]);
      const close = closes[detail.openedFrom];
      if (close == null) { res.status(404).json({ error: 'price_unavailable', message: 'No adjusted daily close is available for the opening date.' }); return; }
      res.json({ underlying, date: detail.openedFrom, adjusted_close: close });
    } catch (e) {
      res.status(502).json({ error: 'price_lookup_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/option-relationships', async (req: Request, res: Response) => {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
    const offset = Number(req.query.offset ?? 0), limit = Number(req.query.limit ?? 50);
    const keys = ['channel', 'q', 'evidence', 'from', 'to', 'as_of'] as const;
    if (Object.keys(req.query).some(k => ![...keys, 'offset', 'limit', 'slug'].includes(k)) ||
      req.query.slug !== undefined && typeof req.query.slug !== 'string' ||
      keys.some(k => req.query[k] !== undefined && (typeof req.query[k] !== 'string' || String(req.query[k]).length > 120)) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: 'invalid_filter', message: 'Invalid relationship filter or pagination.' }); return;
    }
    const value = (k: typeof keys[number]) => String(req.query[k] ?? '').trim();
    const channel = value('channel'), q = value('q'), evidence = value('evidence'), from = value('from'), to = value('to'), asOf = value('as_of');
    if (evidence && !['order', 'execution', 'possible', 'review'].includes(evidence) ||
      [from, to, asOf].some(d => d && !validDate(d)) || from && to && from > to) {
      res.status(400).json({ error: 'invalid_filter', message: 'Invalid relationship date or evidence filter.' }); return;
    }
    try {
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const result = optionRelationshipsForState(snapshot.state, { channel, q, evidence, from, to, asOf });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ...result, groups: result.groups.slice(offset, offset + limit), total: result.groups.length,
        next_offset: offset + limit < result.groups.length ? offset + limit : null });
    } catch (error) {
      res.status(500).json({ error: 'relationships_failed', message: error instanceof Error ? error.message : 'Could not load option relationships.' });
    }
  });

  router.get('/option-history', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const offset = Number(req.query.offset ?? 0);
      const limit = Number(req.query.limit ?? 50);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ error: 'invalid_page', message: 'Invalid history pagination.' }); return;
      }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const state = snapshot.state;
      const { episodes, observations, gaps } = optionHistoryForState(state);
      const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
      const right = typeof req.query.right === 'string' ? req.query.right : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase().slice(0, 100) : '';
      const includeExecutions = req.query.include_executions === 'true';
      if (right && right !== 'put' && right !== 'call' ||
          status && !['historical', 'open', 'unverified', 'no_longer_observed', 'closed_by_fills',
            'expired', 'assigned', 'exercised', 'cash_settled', 'mixed_outcomes',
            'partially_explained', 'conflicting_evidence'].includes(status) ||
          from && !validDate(from) || to && !validDate(to) ||
          asOf && !validDate(asOf) ||
          from && to && from > to) {
        res.status(400).json({ error: 'invalid_filter', message: 'Invalid option history filter.' }); return;
      }
      const matches = episodes.filter(row =>
        (!channel || row.channel === channel) && (!right || row.contract.right === right) &&
        (!status || status === 'historical' && row.first_seen_absent != null || row.status === status) &&
        (!from || (row.first_seen_absent ?? row.last_seen_open) >= from) &&
        (!to || (row.first_seen_absent ?? row.last_seen_open) <= to) &&
        (!q || `${row.contract.underlying} ${row.contract.expiry} ${row.contract.strike}`.toUpperCase().includes(q)));
      // Timeline history includes contracts that opened and closed between
      // position snapshots. Page these trades alongside the observed episodes.
      const executions = includeExecutions ? (state.option_executions ?? []).filter(row =>
        (!channel || row.channel === channel) && (!right || row.right === right) &&
        (!from || row.executed_at.slice(0, 10) >= from) && (!to || row.executed_at.slice(0, 10) <= to) &&
        (!asOf || row.executed_at.slice(0, 10) <= asOf) &&
        (!q || `${row.underlying} ${row.expiry} ${row.strike}`.toUpperCase().includes(q)))
        .sort((a, b) => b.executed_at.localeCompare(a.executed_at) || a.execution_id.localeCompare(b.execution_id)) : [];
      const connections = Object.entries(readBrokerAccountModel(state).connections).map(([id, conn]) => {
        const successful = observations
          .filter(row => row.connection_id === id && row.source === 'broker')
          .sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
        const prior = latestSuccessfulBrokerSyncRun(state.user.id, conn.channel);
        return {
          id, broker_id: conn.broker_id, channel: conn.channel, label: conn.label,
          account_id: conn.account_id ?? null, enabled: conn.enabled,
          schedule: conn.sync_schedule?.frequency ?? null,
          last_success_at: successful?.observed_at ?? prior?.at ?? (conn.last_sync?.ok ? conn.last_sync.at : null),
          position_as_of: successful?.as_of ?? prior?.as_of ?? (conn.last_sync?.ok ? conn.last_sync.as_of ?? null : null),
          last_attempt: conn.last_sync ?? null,
        };
      });
      res.json({ episodes: matches.slice(offset, offset + limit), total: matches.length,
        ...(includeExecutions ? { executions: executions.slice(offset, offset + limit), execution_total: executions.length } : {}),
        next_offset: offset + limit < Math.max(matches.length, executions.length) ? offset + limit : null,
        connections, history_started: observations.length > 0, gaps });
    } catch (e) {
      console.error('Option history failed:', e);
      res.status(500).json({ error: 'history_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/dashboard', async (req: Request, res: Response) => {
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let streaming = false;
    const send = (event: unknown) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      const user = (req as Request & { user: AuthUser }).user;
      if (!user?.userId) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const slug = await targetUserId(req, user);
      res.setHeader('Cache-Control', 'private, no-store');
      const context = await snapshotContext(req, slug);
      if (req.query.progress !== '1') {
        const cached = readSnapshot(context);
        if (cached) { res.json(cached); return; }
      }
      streaming = req.query.progress === '1';
      if (streaming) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        heartbeat = setInterval(() => {
          if (!res.destroyed && !res.writableEnded) res.write(': waiting\n\n');
        }, 15000);
        res.once('close', () => { clearInterval(heartbeat); });
      }
      const payload = await loadDashboardForSlug(slug, undefined, undefined,
        streaming ? progress => send({ type: 'progress', ...progress }) : undefined);
      const body = { ...payload, dashboardConfig: readDashboardConfig() };
      if (context) {
        snapshots.delete(context.key);
        if (snapshots.size >= 100) snapshots.delete(snapshots.keys().next().value!);
        snapshots.set(context.key, { revision: context.revision, at: Date.now(), body });
      }
      if (streaming) { send({ type: 'result', payload: body }); res.end(); }
      else res.json(body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist|Admin must specify/i.test(message) ? 400 : 500;
      if (streaming) {
        send({ type: 'error', error: 'dashboard_failed', message: 'The dashboard could not finish loading. Please retry.' });
        res.end();
      } else res.status(status).json({ error: 'dashboard_failed', message });
    } finally {
      clearInterval(heartbeat);
    }
  });

  router.get('/watchlist', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user: AuthUser }).user;
      if (!user?.userId) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const slug = await targetUserId(req, user);
      const payload = await loadWatchlistForSlug(slug);
      res.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist|Admin must specify/i.test(message) ? 400 : 500;
      res.status(status).json({ error: 'watchlist_failed', message });
    }
  });

  return router;
}
