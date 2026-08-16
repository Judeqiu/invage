import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';

const dataRoot = mkdtempSync(join(tmpdir(), 'invage-watch-tools-'));
process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = dataRoot;

const { loadState } = await import('utarus');
const { createPlaybookTools } = await import('../src/tools/playbook.js');
const { getPlaybook } = await import('../src/state/portfolio-state.js');

const SLUG = 'watcher';

function tool(name: string) {
  const t = createPlaybookTools().find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => ('text' in c ? (c.text ?? '') : '')).join('');
}

beforeAll(() => {
  mkdirSync(join(dataRoot, 'users'), { recursive: true });
  writeFileSync(
    join(dataRoot, 'users', `${SLUG}.yaml`),
    stringify({
      user: {
        id: '00000000-0000-4000-8000-000000000041',
        slug: SLUG,
        created_at: '2026-08-16',
        telegram_user_ids: [],
        auth_token: '00000000-0000-4000-8000-000000000042',
      },
      profile: { display_name: 'Watcher', contact_email: 'w@example.com' },
      log: [{ ts: '2026-08-16', action: 'created' }],
    }),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('add_watch_product / remove_watch_product', () => {
  it('adds a product, rejects a duplicate, removes it, rejects a missing symbol', async () => {
    const add = tool('add_watch_product');
    const remove = tool('remove_watch_product');

    const added = await add.execute('t1', {
      user_slug: SLUG,
      symbol: 'aapl',
      instrument: 'equity',
      note: 'waiting for pullback',
    });
    expect(textOf(added)).toMatch(/Added AAPL/);
    const afterAdd = getPlaybook(loadState(SLUG));
    expect(afterAdd.watchlists.products).toEqual([
      {
        symbol: 'AAPL',
        instrument: 'equity',
        added_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        note: 'waiting for pullback',
      },
    ]);

    const dup = await add.execute('t2', {
      user_slug: SLUG,
      symbol: 'AAPL',
      instrument: 'equity',
    });
    expect(textOf(dup)).toMatch(/already on the list/);
    expect(dup.details).toBeNull();

    const removed = await remove.execute('t3', { user_slug: SLUG, symbol: 'AAPL' });
    expect(textOf(removed)).toMatch(/Removed AAPL/);
    expect(getPlaybook(loadState(SLUG)).watchlists.products).toEqual([]);

    const missing = await remove.execute('t4', { user_slug: SLUG, symbol: 'AAPL' });
    expect(textOf(missing)).toMatch(/not on the list/);
    expect(missing.details).toBeNull();
  });
});
