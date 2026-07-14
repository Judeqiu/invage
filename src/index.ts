/**
 * Invage (Invester) — AI portfolio analyst.
 *
 * Built on Utarus (same architecture as Binary + Marie channels):
 *   createFramework({ extension })
 *   Telegram (Binary-style) + Slack (Marie-style) + optional CLI
 *   BinDrive via utarus (npm run webapp)
 *
 * Required env:
 *   DEEPSEEK_API_KEY
 *   UTARUS_AGENT_NAME
 * Optional channels (enable any subset):
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_IDS
 *   SLACK_BOT_TOKEN + SLACK_APP_TOKEN + SLACK_SIGNING_SECRET + SLACK_ADMIN_IDS
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../.env') });

// Host already loaded env; do not load utarus package .env.
process.env.UTARUS_LOADED_BY_HOST = '1';

const { ensureAdminUsersExist } = await import('./admin-bootstrap.js');
ensureAdminUsersExist();

const { createFramework, config } = await import('utarus');
const { invageExtension } = await import('./extension.js');

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

function validateConfig(): void {
  const missing: string[] = [];
  if (!config.deepseek.apiKey) missing.push('DEEPSEEK_API_KEY');
  if (!config.agent.name) missing.push('UTARUS_AGENT_NAME');
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

function slackConfigured(): boolean {
  return !!(config.slack.botToken && config.slack.appToken && config.slack.signingSecret);
}

function backgroundOnly(): boolean {
  return (
    process.env.TELEGRAM_ONLY === 'true' ||
    process.env.SLACK_ONLY === 'true' ||
    process.env.BOT_ONLY === 'true'
  );
}

async function main(): Promise<void> {
  console.log(`${config.agent.name} starting...`);
  validateConfig();

  ensureAdminUsersExist();

  const framework = createFramework({ extension: invageExtension });

  // ── Web UI (chat + BinDrive + onboard + admin) ────────────────────────
  // The chat router needs the in-memory agent pool, which lives in this
  // process. When WEBAPP_PORT is set, the agent process also serves HTTP.
  if (process.env.WEBAPP_PORT) {
    const { buildInvageApp } = await import('./webapp/server.js');
    const port = parseInt(process.env.WEBAPP_PORT, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`WEBAPP_PORT must be a positive integer, got "${process.env.WEBAPP_PORT}".`);
    }
    const app = buildInvageApp(framework);
    app.listen(port, () => {
      console.log(`[Invester/Web] listening on http://localhost:${port} (chat + BinDrive + admin)`);
    });
  } else {
    console.log('WEBAPP_PORT not set — WebUI chat interface disabled.');
  }

  const botPromises: Promise<void>[] = [];

  // ── Telegram (Binary-style) ──────────────────────────────────────────
  if (!config.telegram.botToken) {
    console.log('TELEGRAM_BOT_TOKEN not set — Telegram interface disabled.');
  } else if (process.env.SLACK_ONLY === 'true') {
    console.log('SLACK_ONLY=true — Telegram interface disabled.');
  } else {
    console.log('Starting Telegram interface...');
    const p = framework.startTelegram();
    botPromises.push(
      p.catch((err) => {
        console.error('[Telegram] Failed:', err instanceof Error ? err.message : err);
        throw err;
      }),
    );
  }

  // ── Slack (Marie-style Socket Mode via Utarus) ───────────────────────
  if (!slackConfigured()) {
    console.log('Slack tokens not set — Slack interface disabled.');
  } else if (process.env.TELEGRAM_ONLY === 'true') {
    console.log('TELEGRAM_ONLY=true — Slack interface disabled.');
  } else {
    console.log('Starting Slack interface...');
    const p = framework.startSlack();
    botPromises.push(
      p.catch((err) => {
        console.error('[Slack] Failed:', err instanceof Error ? err.message : err);
        throw err;
      }),
    );
  }

  if (backgroundOnly()) {
    if (botPromises.length === 0) {
      console.error(
        '[FATAL] BOT_ONLY / TELEGRAM_ONLY / SLACK_ONLY set but no chat interface is configured.',
      );
      process.exit(1);
    }
    console.log('Background mode — CLI disabled. Bots are running.');
    // Keep process alive until a bot interface exits (systemd Restart=on-failure).
    // If one channel dies, fail the process so the unit restarts both cleanly.
    try {
      await Promise.all(botPromises);
    } catch (err) {
      console.error(
        '[FATAL] A chat interface exited:',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
    return;
  }

  // Non-background: bots run in parallel; failures are non-fatal so CLI still works.
  for (const p of botPromises) {
    p.catch((err) => {
      console.error(
        '[Chat interface] stopped:',
        err instanceof Error ? err.message : err,
      );
    });
  }

  await framework.startCli();
}

main().catch((error) => {
  console.error('[FATAL] Failed to start Invage:', error);
  process.exit(1);
});
