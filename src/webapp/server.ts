/**
 * Invage BinDrive web portal + public onboard API.
 *
 * Auth: user.auth_token from data/users/<slug>.yaml (same as Binary/Utarus).
 * Run separately: npm run webapp  (or systemd unit), same as Binary.
 *
 * Load host .env BEFORE importing utarus / onboard so WEBAPP_PORT,
 * UTARUS_DATA_ROOT, and INVAGE_* onboard vars are taken from the host .env.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../../.env') });
process.env.UTARUS_LOADED_BY_HOST = '1';

const { createBinDriveApp, startBinDrive } = await import('utarus');
const { onboardRouter } = await import('../onboard/api.js');

export { startBinDrive, createBinDriveApp };
export { onboardRouter };

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
