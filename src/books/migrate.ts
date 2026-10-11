/**
 * Apply books schema.sql to INVAGE_BOOKS_DATABASE_URL.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { closePool, getPool, requireBooksUrl } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrateBooks(): Promise<void> {
  requireBooksUrl();
  const sqlPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  const pool = getPool();
  await pool.query(sql);
}

export async function migrateBooksAndClose(): Promise<void> {
  try {
    await migrateBooks();
  } finally {
    await closePool();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrateBooksAndClose()
    .then(() => {
      console.log('books schema applied');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
