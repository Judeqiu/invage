import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ loadState: vi.fn(), fetch: vi.fn() }));
vi.mock('utarus', async (original) => ({ ...await original<typeof import('utarus')>(), loadState: mocks.loadState }));
import { createBoundBinDriveTools } from '../src/tools/bindrive.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.loadState.mockImplementation(async (slug: string) => ({ state: { user: { slug, auth_token: `private-${slug}` } }, revision: 1 }));
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ files: [], name: 'report.txt', size: 4 }), { status: 200 }));
});

describe('session-bound BinDrive', () => {
  it('uploads, lists, downloads and deletes without any model-supplied credentials', async () => {
    const tools = createBoundBinDriveTools('alice');
    for (const tool of tools) {
      expect(tool.parameters.properties).not.toHaveProperty('token');
      const result = await tool.execute('call', tool.name === 'bindrive_list' ? {} : { name: 'report.txt', content: 'test' });
      expect(JSON.stringify(result)).not.toContain('private-alice');
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    for (const [, options] of mocks.fetch.mock.calls) expect(options.headers.Authorization).toBe('Bearer private-alice');
  });
  it('never lets stale tokens or supplied identities select another account', async () => {
    await createBoundBinDriveTools('alice')[0]!.execute('call', { token: 'private-bob', user_slug: 'bob' });
    expect(mocks.loadState).toHaveBeenCalledWith('alice');
    expect(mocks.fetch.mock.calls[0]![1].headers.Authorization).toBe('Bearer private-alice');
    await createBoundBinDriveTools('bob')[0]!.execute('call', { token: 'REDACTED' });
    expect(mocks.fetch.mock.calls[1]![1].headers.Authorization).toBe('Bearer private-bob');
  });
  it('reads the current credential on every call, including after rotation', async () => {
    const tool = createBoundBinDriveTools('alice')[0]!;
    await tool.execute('one', {});
    mocks.loadState.mockResolvedValue({ state: { user: { slug: 'alice', auth_token: 'rotated' } }, revision: 2 });
    await tool.execute('two', {});
    expect(mocks.fetch.mock.calls[1]![1].headers.Authorization).toBe('Bearer rotated');
  });
  it('fails before HTTP for missing identity, missing credentials, deleted users and incognito', async () => {
    expect(() => createBoundBinDriveTools('')).toThrow(/identity/);
    await expect(createBoundBinDriveTools('alice', true)[0]!.execute('call', {})).rejects.toThrow(/incognito/);
    for (const user of [{ slug: 'alice' }, { slug: 'alice', auth_token: 'secret', deleted_at: '2026-09-17' }, { slug: 'bob', auth_token: 'secret' }]) {
      mocks.loadState.mockResolvedValue({ state: { user }, revision: 1 });
      await expect(createBoundBinDriveTools('alice')[0]!.execute('call', {})).rejects.toThrow();
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('preserves downloaded JSON as exact file text and reports HTTP failures', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('{ "x": 1 }'));
    const tool = createBoundBinDriveTools('alice').find(t => t.name === 'bindrive_download')!;
    expect((await tool.execute('call', { name: 'data.json' })).details).toEqual({ name: 'data.json', content: '{ "x": 1 }' });
    mocks.fetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await expect(tool.execute('call', { name: 'data.json' })).rejects.toThrow('BinDrive API 401: Unauthorized');
  });
  it('overrides framework BinDrive tools for every consultant and incognito session', async () => {
    const { buildFrameworkAgentList } = await import('../src/agents/framework-agents.js');
    for (const entry of buildFrameworkAgentList('consultant')) {
      if (typeof entry.extension.tools !== 'function') throw new Error('Expected tool factory');
      for (const incognito of [undefined, true] as const) {
        const tools = await entry.extension.tools('alice', false, incognito);
        for (const name of ['bindrive_list', 'bindrive_upload', 'bindrive_download', 'bindrive_delete']) {
          expect(tools.filter(t => t.name === name)).toHaveLength(1);
          expect(tools.find(t => t.name === name)!.parameters.properties).not.toHaveProperty('token');
        }
      }
    }
  });
});
