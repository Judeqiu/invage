import { InteractiveLifecycle } from '../../node_modules/utarus/dist/lifecycle/interactive.js';
import { trackHttpApp, listenHttp } from '../../node_modules/utarus/dist/lifecycle/http.js';
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
const { productHostLabel } = await import('../product-name.js');
const { onboardRouter } = await import('../onboard/api.js');
const { createFaviconRouter } = await import('./favicon.js');

export { startBinDrive, createBinDriveApp, buildWebApp, startWebApp };
export { onboardRouter };

/** Favicon at `/` + landing register API. */
const INVAGE_EXTRA_ROUTERS = [
  { path: '/', router: createFaviconRouter() },
  { path: '/api/onboard', router: onboardRouter },
];

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
  const { openDatabaseRuntime, bindDatabaseRuntime } = await import('utarus/database');
  const database = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
  const release = bindDatabaseRuntime(database);
  try {
    const port = Number(process.env.WEBAPP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEBAPP_PORT must be an explicit valid port');
    const app = buildAppWithOnboard();
    const work = new InteractiveLifecycle();
    trackHttpApp(app, operation => work.run(operation));
    const server = await listenHttp(app, port);
    console.log(`[${productHostLabel()}Drive] listening on port ${port}`);
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (!stopping) stopping = (async () => {
        try {
          const drained = work.stop();
          const closed = new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
          const results = await Promise.allSettled([closed, drained]);
          const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason);
          if (errors.length) throw new AggregateError(errors, 'Drive shutdown failed');
        } finally { release(); await database.close(); }
      })();
      void stopping.catch(error => { console.error('[Drive shutdown]', error); process.exitCode = 1; });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    release();
    await database.close();
    throw error;
  }
}
