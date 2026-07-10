/**
 * Invage BinDrive web portal — re-exports the Utarus BinDrive server.
 *
 * Auth: user.auth_token from data/users/<slug>.yaml (same as Binary/Utarus).
 * Run separately: npm run webapp  (or systemd unit), same as Binary.
 *
 * Load host .env BEFORE importing utarus so WEBAPP_PORT / UTARUS_DATA_ROOT
 * are taken from /opt/invage/.env (not defaults under node_modules/utarus).
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, '../../.env') });
process.env.UTARUS_LOADED_BY_HOST = '1';

const { startBinDrive, createBinDriveApp } = await import('utarus');

export { startBinDrive, createBinDriveApp };

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('src/webapp/server.ts') ||
    process.argv[1].endsWith('dist/webapp/server.js'));

if (isMain) {
  startBinDrive();
}
