/**
 * Invage webapp entry — thin domain layer on top of Utarus WebUI.
 *
 * Framework owns: SPA chat, BinDrive, /api/chat, /api/admin, web onboard
 * (login / redeem / password / demo).
 *
 * Invage adds: landing-page register API at POST /api/onboard/register
 * (Slack workspace invite flow).
 *
 * Two entry points:
 *   - Agent process: framework.startWebApp({ extraRouters: [...] })
 *   - Standalone `npm run webapp`: BinDrive + invage register only (no chat pool)
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import type { Framework } from 'utarus';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../../.env') });
process.env.UTARUS_LOADED_BY_HOST = '1';

const {
  createBinDriveApp,
  startBinDrive,
  buildWebApp,
  startWebApp,
} = await import('utarus');
const { onboardRouter } = await import('../onboard/api.js');

export { startBinDrive, createBinDriveApp, buildWebApp, startWebApp };
export { onboardRouter };

/** Domain-only mount: landing register API. */
const INVAGE_EXTRA_ROUTERS = [{ path: '/api/onboard', router: onboardRouter }];

/**
 * Full WebUI for the agent process (chat needs the in-memory agent pool).
 */
export function buildInvageApp(framework: Framework): Express {
  return buildWebApp(framework, { extraRouters: INVAGE_EXTRA_ROUTERS });
}

/**
 * BinDrive + landing register only — no chat router. Used by standalone
 * `npm run webapp` when the agent process is not hosting HTTP.
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
      `[InvesterDrive] listening on http://localhost:${port} (BinDrive + landing /api/onboard/register)`,
    );
  });
}
