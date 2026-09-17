/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { Router, type Request, type Response } from 'express';
import { targetSlug, type AuthUser } from 'utarus';
import { loadDashboardForSlug } from './dashboard-data.js';
import { loadWatchlistForSlug } from './watchlist-data.js';
import { loadInvestor } from '../state/investor-store.js';
import { buildExecutionJournal } from '../brokers/option-executions.js';

export function createDashboardApiRouter(): Router {
  const router = Router();

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
