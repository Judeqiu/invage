/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { Router, type Request, type Response } from 'express';
import { loadSessionState, type AuthUser } from 'utarus';
import { loadDashboardForSlug } from './dashboard-data.js';
import { loadWatchlistForSlug } from './watchlist-data.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';

export function createDashboardApiRouter(): Router {
  const router = Router();

  async function sessionInvestor(req: Request) {
    const user = (req as Request & { user?: AuthUser }).user;
    if (!user?.slug) return null;
    return loadSessionState(req);
  }

  router.get('/trades', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (!snapshot) { res.status(401).json({ error: 'unauthorized', message: 'No session user.' }); return; }
      res.json(buildExecutionJournal((snapshot.state as InvestorState).option_executions));
    } catch (e) {
      console.error('Execution journal failed:', e);
      res.status(500).json({ error: 'journal_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (!snapshot) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const payload = await loadDashboardForSlug(snapshot.state.user.slug);
      res.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist/i.test(message) ? 400 : 500;
      res.status(status).json({ error: 'dashboard_failed', message });
    }
  });

  router.get('/watchlist', async (req: Request, res: Response) => {
    try {
      const snapshot = await sessionInvestor(req);
      if (!snapshot) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const payload = await loadWatchlistForSlug(snapshot.state.user.slug);
      res.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist/i.test(message) ? 400 : 500;
      res.status(status).json({ error: 'watchlist_failed', message });
    }
  });

  return router;
}
