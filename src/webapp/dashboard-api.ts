/**
 * Domain WebUI API — live portfolio dashboard JSON.
 * Mounted by DomainExtension.webUi at /api/domain/invage (auth: user).
 */

import { Router, type Request, type Response } from 'express';
import { targetSlug, type AuthUser } from 'utarus';
import { loadDashboardForSlug } from './dashboard-data.js';

export function createDashboardApiRouter(): Router {
  const router = Router();

  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user: AuthUser }).user;
      if (!user?.slug) {
        res.status(401).json({ error: 'unauthorized', message: 'No session user.' });
        return;
      }
      const slug = targetSlug(req, user);
      const payload = await loadDashboardForSlug(slug);
      res.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const status = /not found|does not exist|Admin must specify/i.test(message) ? 400 : 500;
      res.status(status).json({ error: 'dashboard_failed', message });
    }
  });

  return router;
}
