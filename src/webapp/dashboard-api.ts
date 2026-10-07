/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { Router, type Request, type Response } from 'express';
import { targetSlug, type AuthUser } from 'utarus';
import { loadDashboardForSlug } from './dashboard-data.js';
import { loadWatchlistForSlug } from './watchlist-data.js';
import { loadInvestor } from '../state/investor-store.js';
import { buildExecutionJournal, validDate } from '../brokers/option-executions.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import { optionHistoryForState } from './option-history-data.js';
import { isBooksEnabled } from '../books/db.js';
import { loadBookPage } from './book-data.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { fetchHistoricalCloses } from '../market/fetch-history.js';
import { openOptionTradeDetails } from './option-dashboard-data.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';

export function createDashboardApiRouter(): Router {
  const router = Router();

  router.get('/book', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.slug) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
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
      const snapshot = await loadInvestor(await targetSlug(req, user));
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
      if (!user?.slug) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const snapshot = await loadInvestor(await targetSlug(req, user));
      res.json(buildExecutionJournal(snapshot.state.option_executions));
    } catch (e) {
      console.error('Execution journal failed:', e);
      res.status(500).json({ error: 'journal_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/option-open-close', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.slug) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const key = req.query.position;
      if (typeof key !== 'string' || !key || key.length > 200) {
        res.status(400).json({ error: 'invalid_position', message: 'Choose an open option position.' }); return;
      }
      const snapshot = await loadInvestor(await targetSlug(req, user));
      const portfolio = getPortfolio(snapshot.state);
      const holding = portfolio[key];
      if (!holding?.option) { res.status(404).json({ error: 'not_found', message: 'Open option position not found.' }); return; }
      const accounts = Object.fromEntries(Object.values(readBrokerAccountModel(snapshot.state).connections)
        .filter(conn => conn.account_id).map(conn => [conn.channel, conn.account_id!]));
      const detail = openOptionTradeDetails({ [key]: holding }, snapshot.state.option_executions, accounts)[key];
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

  router.get('/option-history', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.slug) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const offset = Number(req.query.offset ?? 0);
      const limit = Number(req.query.limit ?? 50);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ error: 'invalid_page', message: 'Invalid history pagination.' }); return;
      }
      const snapshot = await loadInvestor(await targetSlug(req, user));
      const state = snapshot.state;
      const { episodes, observations, gaps } = optionHistoryForState(state);
      const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
      const right = typeof req.query.right === 'string' ? req.query.right : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase().slice(0, 100) : '';
      if (right && right !== 'put' && right !== 'call' ||
          status && !['historical', 'open', 'unverified', 'no_longer_observed', 'closed_by_fills',
            'expired', 'assigned', 'exercised', 'cash_settled', 'mixed_outcomes',
            'partially_explained', 'conflicting_evidence'].includes(status) ||
          from && !validDate(from) || to && !validDate(to) ||
          from && to && from > to) {
        res.status(400).json({ error: 'invalid_filter', message: 'Invalid option history filter.' }); return;
      }
      const matches = episodes.filter(row =>
        (!channel || row.channel === channel) && (!right || row.contract.right === right) &&
        (!status || status === 'historical' && row.first_seen_absent != null || row.status === status) &&
        (!from || (row.first_seen_absent ?? row.last_seen_open) >= from) &&
        (!to || (row.first_seen_absent ?? row.last_seen_open) <= to) &&
        (!q || `${row.contract.underlying} ${row.contract.expiry} ${row.contract.strike}`.toUpperCase().includes(q)));
      const connections = Object.entries(readBrokerAccountModel(state).connections).map(([id, conn]) => {
        const successful = observations
          .filter(row => row.connection_id === id && row.source === 'broker')
          .sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
        const prior = latestSuccessfulBrokerSyncRun(state.user.slug, conn.channel);
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
        next_offset: offset + limit < matches.length ? offset + limit : null,
        connections, history_started: observations.length > 0, gaps });
    } catch (e) {
      console.error('Option history failed:', e);
      res.status(500).json({ error: 'history_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user: AuthUser }).user;
      if (!user?.slug) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const slug = await targetSlug(req, user);
      const payload = await loadDashboardForSlug(slug);
      res.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist|Admin must specify/i.test(message) ? 400 : 500;
      res.status(status).json({ error: 'dashboard_failed', message });
    }
  });

  router.get('/watchlist', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user: AuthUser }).user;
      if (!user?.slug) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const slug = await targetSlug(req, user);
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
