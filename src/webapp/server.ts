/**
 * Invage BinDrive web portal — re-exports the Utarus BinDrive server.
 *
 * Auth: user.auth_token from data/users/<slug>.yaml (same as Binary/Utarus).
 * Run separately: npm run webapp  (or systemd unit), same as Binary.
 */

import { startBinDrive } from 'utarus';

export { startBinDrive, createBinDriveApp } from 'utarus';

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('src/webapp/server.ts') ||
    process.argv[1].endsWith('dist/webapp/server.js'));

if (isMain) {
  startBinDrive();
}
