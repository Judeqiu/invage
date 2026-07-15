/**
 * Invage webapp — BinDrive portal + public onboard API + WebUI chat.
 *
 * Two entry points:
 *   - `npm run webapp` (standalone): BinDrive + onboard API only. Used for
 *     BinDrive-only deployments that do not need the in-memory agent pool.
 *   - `buildInvageApp({ framework })` (called from the agent process):
 *     BinDrive + onboard API + chat router. The chat router needs the
 *     in-memory agent pool, which lives in the agent process — see
 *     docs/webui-chat-design.md §5.
 *
 * Auth: user.auth_token from data/users/<slug>.yaml (same as Binary/Utarus).
 *
 * Load host .env BEFORE importing utarus / onboard so WEBAPP_PORT,
 * UTARUS_DATA_ROOT, and INVAGE_* onboard vars are taken from the host .env.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Framework } from 'utarus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../../.env') });
process.env.UTARUS_LOADED_BY_HOST = '1';

const { createBinDriveApp, startBinDrive } = await import('utarus');
const { onboardRouter } = await import('../onboard/api.js');
const { createChatRouter } = await import('./chat/router.js');
const { adminRouter } = await import('./chat/admin-router.js');
const { onboardRedeemRouter } = await import('./chat/onboard.js');

export { startBinDrive, createBinDriveApp };
export { onboardRouter };

/**
 * Absolute path to the built SPA. In production this is
 * /opt/invage/web/dist; in dev (running from src/) it resolves under the
 * repo root. Missing dir is logged but does not crash — the API still
 * works, only static serving returns 404.
 */
const WEB_DIST_DIR = resolve(__dirname, '../../web/dist');

/**
 * Build the combined express app: BinDrive routes (from utarus) + onboard
 * API + chat router + admin REST + SPA static serving. Requires the
 * framework so the chat router can resolve agents.
 *
 * Static serving: any GET that isn't under /api, /login, /logout, /health,
 * or a file with an extension is treated as a client-side route and served
 * index.html. Spec: docs/webui-chat-design.md §9.
 */
export function buildInvageApp(framework: Framework): Express {
  const app = createBinDriveApp();
  app.use('/api/onboard', onboardRouter);
  app.use('/api/onboard', onboardRedeemRouter);
  app.use('/api/chat', createChatRouter({ framework }));
  app.use('/api/admin', adminRouter);

  if (existsSync(WEB_DIST_DIR)) {
    // Static assets (JS/CSS/images with extensions) — served as files.
    app.use(express.static(WEB_DIST_DIR, {
      index: 'index.html',
      setHeaders: (res, path) => {
        // Immutable cache for hashed bundle assets.
        if (/\.[0-9a-f]{8,}\.(js|css)$/i.test(path)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    // SPA fallback: any non-API GET that didn't match a static file
    // returns index.html so client-side routing owns the URL.
    const indexHtml = join(WEB_DIST_DIR, 'index.html');
    app.get(/^\/(?!api\/|login|logout|health).*$/, (req: Request, res: Response, next: NextFunction) => {
      // Skip anything that looks like a file (has an extension in the last segment).
      const last = req.path.split('/').pop() ?? '';
      if (last.includes('.')) {
        return next();
      }
      res.sendFile(indexHtml);
    });
  } else {
    console.warn(`[invage/web] SPA static dir missing: ${WEB_DIST_DIR}. API-only mode.`);
  }

  return app;
}

/**
 * BinDrive + onboard only — no chat router. Used by the standalone
 * `npm run webapp` entry when the agent process is not running here.
 */
function buildAppWithOnboard() {
  const app = createBinDriveApp();
  app.use('/api/onboard', onboardRouter);
  return app;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('src/webapp/server.ts') ||
    process.argv[1].endsWith('dist/webapp/server.js'));

if (isMain) {
  const app = buildAppWithOnboard();
  const port = parseInt(process.env.WEBAPP_PORT || '3001', 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`WEBAPP_PORT must be a positive integer, got "${process.env.WEBAPP_PORT}".`);
  }
  app.listen(port, () => {
    console.log(
      `[InvesterDrive] listening on http://localhost:${port} (onboard API at /api/onboard)`,
    );
  });
}
