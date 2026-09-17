/** Invage personal-mode host. Database lifetime encloses all framework work. */
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Framework } from 'utarus';
import { openDatabaseRuntime, bindDatabaseRuntime } from 'utarus/database';

dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
process.env.UTARUS_LOADED_BY_HOST = '1';

async function main(): Promise<void> {
  const database = await openDatabaseRuntime({ env: process.env, mode: 'personal', onError: error => { throw error; } });
  const release = bindDatabaseRuntime(database);
  let framework: Framework | undefined;
  let stopping: Promise<void> | undefined;
  let startup: Promise<void>;
  const stop = (error?: unknown): Promise<void> => {
    if (error !== undefined) { console.error('[FATAL]', error); process.exitCode = 1; }
    if (!stopping) stopping = (async () => {
      try { await startup; } catch (error) { console.error('[Startup]', error); process.exitCode = 1; }
      try { if (framework) await framework.stop(); }
      finally { release(); await database.close(); }
    })();
    return stopping;
  };
  const signal = () => { void stop().catch(error => { console.error('[Shutdown]', error); process.exitCode = 1; }); };
  const observe = (handle: { closed: Promise<void> }) => {
    void handle.closed.then(() => stop(), error => stop(error)).catch(error => { console.error('[Shutdown]', error); process.exitCode = 1; });
  };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  startup = (async () => {
    const { createFramework, config } = await import('utarus');
    const { ensureAdminUsersExist } = await import('./admin-bootstrap.js');
    const { HOST_AGENT_ID, readProductProfile } = await import('./agents/roster.js');
    const { buildFrameworkAgentList } = await import('./agents/framework-agents.js');
    if (!config.deepseek.apiKey) throw new Error('DEEPSEEK_API_KEY is required');
    if (!config.agent.name) throw new Error('UTARUS_AGENT_NAME is required');
    await ensureAdminUsersExist();
    const profile = readProductProfile();
    const agents = buildFrameworkAgentList(profile);
    framework = await createFramework({ database, defaultAgentId: HOST_AGENT_ID, agents });
    if (stopping) return;
    console.log(`[Invage] profile=${profile} agents=${agents.map(agent => agent.id).join(',')}`);
    if (process.env.WEBAPP_PORT) {
      const port = Number(process.env.WEBAPP_PORT);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WEBAPP_PORT');
      const { onboardRouter } = await import('./onboard/api.js');
      const { createFaviconRouter } = await import('./webapp/favicon.js');
      observe(await framework.startWebApp({ port, extraRouters: [
        { path: '/', router: createFaviconRouter() },
        { path: '/api/onboard', router: onboardRouter },
      ] }));
    }
    if (stopping) return;
    framework.startTaskScheduler();
    if (process.env.WEB_ONLY === 'true') {
      if (!process.env.WEBAPP_PORT) throw new Error('WEB_ONLY requires WEBAPP_PORT');
      return;
    }
    let channels = 0;
    if (config.telegram.botToken && process.env.SLACK_ONLY !== 'true') {
      observe(await framework.startTelegram()); channels++;
    }
    if (stopping) return;
    if (config.slack.botToken && config.slack.appToken && config.slack.signingSecret && process.env.TELEGRAM_ONLY !== 'true') {
      observe(await framework.startSlack()); channels++;
    }
    if (stopping) return;
    const background = ['BOT_ONLY', 'TELEGRAM_ONLY', 'SLACK_ONLY'].some(name => process.env[name] === 'true');
    if (background) {
      if (channels === 0) throw new Error('Background mode requires a configured chat channel');
    } else {
      const userSlug = process.env.UTARUS_CLI_USER_SLUG;
      if (!userSlug?.trim()) throw new Error('UTARUS_CLI_USER_SLUG is required for CLI');
      observe(await framework.startCli({ userSlug }));
    }
  })();
  try { await startup; } catch (error) { await stop(error); }
}

main().catch(error => { console.error('[FATAL] Invage startup/shutdown failed', error); process.exitCode = 1; });
