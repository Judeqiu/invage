import { readFile } from 'node:fs/promises';
import { getPool, closePool } from '../books/db.js';
export async function migrateOptionRisk() {
  await getPool().query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
if (process.argv[1]?.endsWith('/risk/migrate.ts') || process.argv[1]?.endsWith('/risk/migrate.js')) {
  migrateOptionRisk().finally(closePool).catch(() => { console.error('Option risk migration failed'); process.exitCode = 1; });
}
