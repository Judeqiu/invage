/**
 * Local smoke: books-enabled portfolio tools against real data/users (or temp clone of jude).
 * Does not start Telegram — pure tool execution.
 *
 *   INVAGE_BOOKS_DATABASE_URL=… node --import tsx scripts/books-local-smoke.mjs
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { stringify, parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: join(root, '.env') });

process.env.UTARUS_LOADED_BY_HOST = '1';

if (!process.env.INVAGE_BOOKS_DATABASE_URL) {
  console.error('INVAGE_BOOKS_DATABASE_URL missing in .env');
  process.exit(1);
}

// Isolate: copy jude identity into temp data root so we don't corrupt real books mid-dev
const smokeRoot = join(tmpdir(), `invage-smoke-${Date.now()}`);
mkdirSync(join(smokeRoot, 'users'), { recursive: true });
process.env.UTARUS_DATA_ROOT = smokeRoot;

const srcJude = join(root, 'data/users/jude.yaml');
if (!existsSync(srcJude)) {
  console.error('missing data/users/jude.yaml');
  process.exit(1);
}
const jude = parse(readFileSync(srcJude, 'utf-8'));
// Use a dedicated smoke household id so we don't collide with production journal rows for jude UUID
const smokeId = 'dddddddd-eeee-4fff-8000-111111111111';
jude.user.id = smokeId;
jude.user.slug = 'smoke-jude';
jude.user.telegram_user_ids = [777000111];
jude.user.auth_token = randomUUID();
// Start empty books (same as local jude) then exercise tools
delete jude.cash;
delete jude.deposits;
delete jude.portfolio;
writeFileSync(join(smokeRoot, 'users/smoke-jude.yaml'), stringify(jude), 'utf-8');

const { migrateBooks, closePool } = await import('../src/books/index.ts');
// migrate needs superuser for role/grants; try app URL first, fall back admin
try {
  await migrateBooks();
} catch (e) {
  console.warn('migrate as app user failed, trying admin…', e.message);
  const prev = process.env.INVAGE_BOOKS_DATABASE_URL;
  process.env.INVAGE_BOOKS_DATABASE_URL =
    process.env.INVAGE_BOOKS_ADMIN_URL || 'postgresql://zhengqingqiu@localhost:5432/invage_books';
  await closePool();
  await migrateBooks();
  await closePool();
  process.env.INVAGE_BOOKS_DATABASE_URL = prev;
  await closePool();
}

// wipe smoke household
const pg = await import('pg');
const admin = new pg.default.Client({
  connectionString:
    process.env.INVAGE_BOOKS_ADMIN_URL || 'postgresql://zhengqingqiu@localhost:5432/invage_books',
});
await admin.connect();
await admin.query('ALTER TABLE journal_entries DISABLE TRIGGER journal_entries_no_update');
await admin.query('ALTER TABLE journal_lines DISABLE TRIGGER journal_lines_no_update');
for (const sql of [
  'DELETE FROM audit_events WHERE household_id = $1::uuid',
  'DELETE FROM journal_lines WHERE household_id = $1::uuid',
  'DELETE FROM journal_entries WHERE household_id = $1::uuid',
  'DELETE FROM deposit_meta WHERE household_id = $1::uuid',
  'DELETE FROM position_meta WHERE household_id = $1::uuid',
  'DELETE FROM account_balances WHERE household_id = $1::uuid',
  'DELETE FROM accounts WHERE household_id = $1::uuid',
  'DELETE FROM households WHERE id = $1::uuid',
]) {
  await admin.query(sql, [smokeId]);
}
await admin.query('ALTER TABLE journal_entries ENABLE TRIGGER journal_entries_no_update');
await admin.query('ALTER TABLE journal_lines ENABLE TRIGGER journal_lines_no_update');
await admin.end();

const { createPortfolioTools } = await import('../src/tools/portfolio.ts');
const tools = createPortfolioTools();
const by = (n) => {
  const t = tools.find((x) => x.name === n);
  if (!t) throw new Error(`no tool ${n}`);
  return t;
};
const TG = 777000111;
const run = async (name, args) => {
  const r = await by(name).execute('smoke', { telegram_user_id: TG, ...args });
  const text = r.content?.map((c) => c.text || '').join('') || '';
  if (/^Error:|failed|Insufficient/i.test(text) || text.includes('fail')) {
    // tools return fail() without throwing — check details
  }
  console.log(`\n=== ${name} ===\n${text.slice(0, 500)}`);
  return r;
};

// USD-only flow: journals only (no absolute set_cash).
await run('post_opening_balance', {
  amount: 10000,
  currency: 'USD',
  channel: 'dbs',
  memo: 'smoke opening dbs from statement',
});
await run('post_opening_balance', {
  amount: 1000,
  currency: 'USD',
  channel: 'ibkr',
  memo: 'smoke opening ibkr from statement',
});
await run('transfer_cash', {
  from_channel: 'dbs',
  to_channel: 'ibkr',
  amount: 2500,
  currency: 'USD',
});
await run('add_deposit', {
  id: 'fd-smoke',
  amount: 1000,
  interest: 10,
  currency: 'USD',
  channel: 'dbs',
  start_date: '2026-01-01',
  end_date: '2026-07-01',
});
await run('mature_deposit', { id: 'fd-smoke' });
await run('add_holding', {
  ticker: 'AAPL',
  avg_price: 200,
  units: 5,
  channel: 'ibkr',
});
const gp = await run('get_portfolio', {});
const lj = await run('list_journal_entries', { limit: 10 });

const { loadState } = await import('utarus');
const { getCashes, getPortfolio, getDeposits } = await import('../src/state/portfolio-state.ts');
const st = loadState('smoke-jude');
const cashes = getCashes(st);
const dbsUsd = cashes.find((c) => c.channel === 'dbs' && c.currency === 'USD');
const ibkrUsd = cashes.find((c) => c.channel === 'ibkr' && c.currency === 'USD');
const port = getPortfolio(st);

let ok = true;
const check = (name, cond, detail) => {
  if (!cond) {
    console.error('FAIL', name, detail ?? '');
    ok = false;
  } else console.log('OK', name, detail ?? '');
};

// 10000 - 2500 xfer - 1000 fd + 1000 mature = 7500 dbs; ibkr 1000+2500-1000 stock = 2500
check('dbs USD 7500', dbsUsd?.amount === 7500, dbsUsd);
check('ibkr USD 2500', ibkrUsd?.amount === 2500, ibkrUsd);
check('no open deposits', getDeposits(st).length === 0);
check('AAPL@ibkr 5', port['AAPL@ibkr']?.units === 5, port);
check('get_portfolio ok', !/Cannot sum cash|Error:/i.test(gp.content?.map((c) => c.text).join('') || ''));
check('journals listed', (lj.details?.count ?? 0) > 0, lj.details?.count);

await closePool();
console.log(ok ? '\nSMOKE PASS' : '\nSMOKE FAIL');
process.exit(ok ? 0 : 1);
