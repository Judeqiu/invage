/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { createExperienceSettingsRouter, riskPageEnabled, dailyChangesEnabled } from './experience-settings.js';
import { buildAccountRisk } from './account-risk-data.js';
import { readProductProfile } from '../agents/roster.js';
import { productDisplayName } from '../product-name.js';
import { analysisContext, riskEnabled } from '../risk/context.js';
import { createOptionRiskRouter } from './option-risk-api.js';
import { createOptionIndexRouter } from './option-index-api.js';
import { readBrokerSyncConfig, readDashboardConfig } from './dashboard-config.js';
import { Router, type Request, type Response } from 'express';
import { loadSessionState, targetUserId, type AuthUser } from 'utarus';
import { requirePortfolioProjection, readPortfolioProjection, PortfolioProjectionUnavailable, type PortfolioProjection } from '../state/projection-store.js';
import { loadWatchlistForSlug } from './watchlist-data.js';
import { loadInvestor } from '../state/investor-store.js';
import { validDate } from '../brokers/option-executions.js';
import { readBrokerAccountModel } from '../brokers/accounts.js';
import { latestSuccessfulBrokerSyncRun } from '../brokers/sync-history.js';
import { optionHistoryForState } from './option-history-data.js';
import { isBooksEnabled } from '../books/db.js';
import { loadBookPage } from './book-data.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { getPortfolio } from '../state/portfolio-state.js';
import { canonicalOptionUnderlying } from '../brokers/option-symbol.js';
import { getTreasury, getReportingCurrency, setTreasury, type HouseholdInvestorState } from '../state/household-state.js';
import { saveInvestor, saveOptionJournalMetadata } from '../state/investor-store.js';
import { buildOptionIdentityIndex } from '../brokers/option-identities.js';

function matchesDashboardSelection(projection: PortfolioProjection, selection: string, channel: string): boolean {
  if (!selection) return true;
  return selection.startsWith('broker:') ? projection.brokers[selection.slice(7)]?.channels.includes(channel) === true : selection === channel;
}

export function createDashboardApiRouter(): Router {
  const router = Router();
  router.use('/experience-settings', createExperienceSettingsRouter());
  router.get('/account-risk', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!(req as Request & {user?: AuthUser}).user?.userId) {res.status(401).json({message:'Sign in to view account risk.'}); return;}
    try {
      const snapshot = await loadSessionState(req);
      const state = snapshot.state as InvestorState;
      if (!riskPageEnabled(state)) {res.status(403).json({error:'page_disabled',message:'Enable Risk in Settings → Your experience.'}); return;}
      const saved = requirePortfolioProjection(state);
      res.json(buildAccountRisk(state, saved.dashboard));
    } catch (error) {
      res.status(error instanceof PortfolioProjectionUnavailable ? 503 : 500).json({message:'Risk data is unavailable. Sync your brokers, then retry.'});
    }
  });
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  router.put('/trades-v2/:optionId/note', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control','private, no-store');
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({error:'unauthorized'}); return; }
      const id = String(req.params.optionId), text = req.body?.text, revision = req.body?.revision;
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) ||
        typeof text !== 'string' || text.length > 8000 || !Number.isSafeInteger(revision) || revision < 0) {
        res.status(400).json({error:'invalid_note',message:'Use a valid option ID and a note of at most 8,000 characters.'}); return;
      }
      const snapshot = await loadInvestor(await targetUserId(req,user));
      if (snapshot.revision !== revision) { res.status(409).json({error:'revision_conflict',message:'The journal changed. Refresh it, then reopen this option before saving your note. Your draft is still shown.'}); return; }
      let identities = buildOptionIdentityIndex(snapshot.state);
      if (!Object.values(identities.options).includes(id)) {
        const evidence = optionHistoryForState(snapshot.state);
        identities = buildOptionIdentityIndex({...snapshot.state,option_observations:evidence.observations,option_events:evidence.events});
      }
      if (!Object.values(identities.options).includes(id)) {res.status(404).json({error:'option_not_found'});return;}
      snapshot.state.option_identities = identities;
      const updatedAt = new Date().toISOString();
      snapshot.state.option_journal = {...snapshot.state.option_journal,[id]:{thesis:text,updated_at:updatedAt}};
      await saveOptionJournalMetadata(snapshot);
      res.json({revision:snapshot.revision,text,updatedAt});
    } catch (error) {
      const conflict = error instanceof Error && /revision|changed during/.test(error.message);
      res.status(conflict ? 409 : 500).json({error:conflict ? 'revision_conflict' : 'note_failed',message:conflict ? 'The journal changed. Refresh and reopen this option before saving. Your draft is still shown.' : 'Could not save the note. Your draft is still shown.'});
    }
  });
  router.get(['/trades-v2', '/trades-v2/history'], async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error:'unauthorized' }); return; }
      const snapshot = await loadInvestor(await targetUserId(req,user));
      const history = req.path.endsWith('/history');
      const saved = requirePortfolioProjection(snapshot.state);
      const journal = history ? saved.tradeHistory : saved.openTrades;
      const payload = { ...journal, calculatedAt: saved.calculatedAt, revision: snapshot.revision,
        rows: journal.rows.map(row => ({ ...row, thesis: snapshot.state.option_journal?.[row.optionId]?.thesis ?? '',
          noteUpdatedAt: snapshot.state.option_journal?.[row.optionId]?.updated_at ?? null })) };
      res.json(payload);
    } catch (error) {
      console.error('Trades v2 failed:', error);
      res.status(error instanceof PortfolioProjectionUnavailable ? 503 : 500).json({ error:'trades_failed', message:'Could not load the option journal. Please retry.' });
    }
  });
  router.use('/option-index', createOptionIndexRouter());
  router.use('/option-risk', createOptionRiskRouter());
  function dashboardBody(snapshot: Awaited<ReturnType<typeof loadInvestor>>, saved: PortfolioProjection = requirePortfolioProjection(snapshot.state)) {
    return { ...saved.dashboard, brokerAggregates: saved.brokers, productProfile: readProductProfile(), productName: productDisplayName(), displayName: snapshot.state.profile.display_name,
      dashboardConfig: { ...readDashboardConfig(), showOptionRiskModelView: riskEnabled(), showDailyChanges: dailyChangesEnabled(snapshot.state) },
      analysisContextId: riskEnabled() ? analysisContext(snapshot) : null };
  }
  router.get('/dashboard-cache', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const saved = readPortfolioProjection(snapshot.state);
      res.json(saved ? dashboardBody(snapshot, saved) : null);
    } catch { res.status(500).json({ error: 'dashboard_failed', message: 'Could not read saved portfolio totals.' }); }
  });
  router.get('/portfolio-indices', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized' }); return; }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      const saved = requirePortfolioProjection(snapshot.state);
      res.json({ calculatedAt: saved.calculatedAt, totals: saved.dashboard.model?.live ?? null,
        scopes: saved.dashboard.aggregatedViews, pages: saved.dashboard.pageProjections, brokers: saved.brokers });
    } catch (error) { res.status(error instanceof PortfolioProjectionUnavailable ? 503 : 500)
      .json({ error: 'indices_unavailable', message: 'Saved portfolio calculations are unavailable. Retry shortly or sync your brokers.' }); }
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
      res.json(requirePortfolioProjection(snapshot.state).journal);
    } catch (e) {
      console.error('Execution journal failed:', e);
      res.status(e instanceof PortfolioProjectionUnavailable ? 503 : 500).json({ error: 'journal_failed', message: e instanceof Error ? e.message : String(e) });
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
      const detail = requirePortfolioProjection(snapshot.state).dashboard.optionTradeDetails?.[key];
      if (!detail || detail.openedFrom !== detail.openedTo) {
        res.status(409).json({ error: 'opening_date_unavailable', message: 'A single opening date is not confirmed by the recorded fills.' }); return;
      }
      const underlying = canonicalOptionUnderlying(holding.option.underlying, holding.option);
      const close = detail.entrySpot?.price;
      if (close == null) { res.status(404).json({ error: 'price_unavailable', message: 'No saved adjusted daily close is available for the opening date.' }); return; }
      res.json({ underlying, date: detail.openedFrom, adjusted_close: close });
    } catch (e) {
      res.status(e instanceof PortfolioProjectionUnavailable ? 503 : 502).json({ error: 'price_lookup_failed', message: e instanceof Error ? e.message : String(e) });
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
      const projection = requirePortfolioProjection(snapshot.state);
      const saved = projection.relationships;
      const matches = (row: { channel: string }) => matchesDashboardSelection(projection, channel, row.channel);
      const groups = saved.groups.filter(matches).flatMap(group => {
        const visible = group.relationships.filter(r => (!asOf || r.through.slice(0, 10) <= asOf) &&
          (!from || r.at.slice(0, 10) >= from) && (!to || r.through.slice(0, 10) <= to) &&
          (!evidence || r.evidence === evidence) &&
          (!q || `${r.old.underlying} ${r.old.strike} ${r.old.expiry} ${r.replacement.strike} ${r.replacement.expiry}`.toUpperCase().includes(q.toUpperCase())));
        if (!visible.length) return [];
        const latest = visible[0];
        return [{ ...group, latest: latest.replacement, latest_quantity: latest.opened_quantity, last_at: latest.at, relationships: visible }];
      }).sort((a, b) => b.last_at.localeCompare(a.last_at) || a.id.localeCompare(b.id));
      const result = { ...saved, groups, as_of: asOf || null,
        historyGaps: saved.historyGaps.filter(matches), coverage: saved.coverage.filter(matches), gaps: saved.gaps.filter(matches),
        spreads: saved.spreads.filter(row => matches(row) && (!asOf || row.through.slice(0, 10) <= asOf)) };
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ...result, groups: result.groups.slice(offset, offset + limit), total: result.groups.length,
        next_offset: offset + limit < result.groups.length ? offset + limit : null });
    } catch (error) {
      res.status(error instanceof PortfolioProjectionUnavailable ? 503 : 500).json({ error: 'relationships_failed', message: error instanceof Error ? error.message : 'Could not load option relationships.' });
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
      const projection = requirePortfolioProjection(state);
      const { episodes, observations, gaps } = projection.optionHistory;
      const channel = typeof req.query.channel === 'string' ? req.query.channel : '';
      const right = typeof req.query.right === 'string' ? req.query.right : '';
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const from = typeof req.query.from === 'string' ? req.query.from : '';
      const to = typeof req.query.to === 'string' ? req.query.to : '';
      const asOf = typeof req.query.as_of === 'string' ? req.query.as_of : '';
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase().slice(0, 100) : '';
      const includeExecutions = req.query.include_executions === 'true';
      const matchesScope = (row: { channel: string }) => matchesDashboardSelection(projection, channel, row.channel);
      if (Object.keys(req.query).some(key => key.startsWith('channel[')) || req.query.channel !== undefined && typeof req.query.channel !== 'string' || right && right !== 'put' && right !== 'call' ||
          status && !['historical', 'open', 'unverified', 'no_longer_observed', 'closed_by_fills',
            'expired', 'assigned', 'exercised', 'cash_settled', 'mixed_outcomes',
            'partially_explained', 'conflicting_evidence'].includes(status) ||
          from && !validDate(from) || to && !validDate(to) ||
          asOf && !validDate(asOf) ||
          from && to && from > to) {
        res.status(400).json({ error: 'invalid_filter', message: 'Invalid option history filter.' }); return;
      }
      const matches = episodes.filter(row =>
        matchesScope(row) && (!right || row.contract.right === right) &&
        (!status || status === 'historical' && row.first_seen_absent != null || row.status === status) &&
        (!from || (row.first_seen_absent ?? row.last_seen_open) >= from) &&
        (!to || (row.first_seen_absent ?? row.last_seen_open) <= to) &&
        (!q || `${row.contract.underlying} ${row.contract.expiry} ${row.contract.strike}`.toUpperCase().includes(q)));
      // Timeline history includes contracts that opened and closed between
      // position snapshots. Page these trades alongside the observed episodes.
      const executions = includeExecutions ? (state.option_executions ?? []).filter(row =>
        matchesScope(row) && (!right || row.right === right) &&
        (!from || row.executed_at.slice(0, 10) >= from) && (!to || row.executed_at.slice(0, 10) <= to) &&
        (!asOf || row.executed_at.slice(0, 10) <= asOf) &&
        (!q || `${row.underlying} ${row.expiry} ${row.strike}`.toUpperCase().includes(q)))
        .sort((a, b) => b.executed_at.localeCompare(a.executed_at) || a.execution_id.localeCompare(b.execution_id)) : [];
      const automaticSync = readBrokerSyncConfig();
      const connections = Object.entries(readBrokerAccountModel(state).connections).map(([id, conn]) => {
        const successful = observations
          .filter(row => row.connection_id === id && row.source === 'broker')
          .sort((a, b) => b.observed_at.localeCompare(a.observed_at))[0];
        const prior = latestSuccessfulBrokerSyncRun(state.user.id, conn.channel);
        return {
          id, broker_id: conn.broker_id, channel: conn.channel, label: conn.label,
          account_id: conn.account_id ?? null, enabled: conn.enabled,
          schedule: automaticSync.enabled && conn.enabled && conn.account_id ? 'daily' : null,
          last_success_at: successful?.observed_at ?? prior?.at ?? (conn.last_sync?.ok ? conn.last_sync.at : null),
          position_as_of: successful?.as_of ?? prior?.as_of ?? (conn.last_sync?.ok ? conn.last_sync.as_of ?? null : null),
          last_attempt: conn.last_sync ?? null,
        };
      });
      res.json({ episodes: matches.slice(offset, offset + limit), total: matches.length,
        ...(includeExecutions ? { executions: executions.slice(offset, offset + limit), execution_total: executions.length } : {}),
        next_offset: offset + limit < Math.max(matches.length, executions.length) ? offset + limit : null,
        connections, history_started: observations.some(matchesScope), gaps: gaps.filter(matchesScope) });
    } catch (e) {
      console.error('Option history failed:', e);
      res.status(e instanceof PortfolioProjectionUnavailable ? 503 : 500).json({ error: 'history_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/dashboard', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const streaming = req.query.progress === '1';
    try {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user?.userId) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      const snapshot = await loadInvestor(await targetUserId(req, user));
      // Even refresh=1 only rereads the persisted generation. Refresh work runs after sync.
      const body = dashboardBody(snapshot);
      if (streaming) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('X-Accel-Buffering', 'no');
        res.end(`data: ${JSON.stringify({ type: 'result', payload: body })}\n\n`);
      } else res.json(body);
    } catch (error) {
      const message = error instanceof PortfolioProjectionUnavailable ? error.message : 'Saved portfolio data could not be loaded. Please retry.';
      if (streaming) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.end(`data: ${JSON.stringify({ type: 'error', error: 'dashboard_unavailable', message })}\n\n`);
      } else res.status(error instanceof PortfolioProjectionUnavailable ? 503 : 500).json({ error: 'dashboard_unavailable', message });
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
