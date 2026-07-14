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
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
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
 * Build the combined express app: BinDrive routes (from utarus) + onboard
 * API + chat router + admin REST. Requires the framework so the chat router
 * can resolve agents.
 */
export function buildInvageApp(framework: Framework): Express {
  const app = createBinDriveApp();
  app.use('/api/onboard', onboardRouter);
  app.use('/api/onboard', onboardRedeemRouter);
  app.use('/api/chat', createChatRouter({ framework }));
  app.use('/api/admin', adminRouter);
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
