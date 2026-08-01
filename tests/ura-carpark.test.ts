import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUraCarparkTool } from '../src/tools/ura_carpark.js';

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

function jsonBuf(obj: unknown) {
  return {
    ok: true,
    arrayBuffer: async () => Buffer.from(JSON.stringify(obj)),
    json: async () => obj,
  };
}

describe('ura_carpark', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.URA_ACCESS_KEY;
  });

  it('fails without URA_ACCESS_KEY', async () => {
    const tool = createUraCarparkTool();
    const result = await tool.execute('t1', { action: 'availability' });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/URA_ACCESS_KEY/);
  });

  it('returns availability rows', async () => {
    process.env.URA_ACCESS_KEY = 'k';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Status: 'Success', Result: 'tok' }),
        })
        .mockResolvedValueOnce(
          jsonBuf({
            Status: 'Success',
            Result: [
              { carparkNo: 'S0049', lotsAvailable: '80', lotType: 'C' },
              { carparkNo: 'A0004', lotsAvailable: '2', lotType: 'C' },
            ],
          }),
        ),
    );
    const tool = createUraCarparkTool();
    const result = await tool.execute('t2', { action: 'availability', carpark_no: 'S0049' });
    expect(textOf(result)).toMatch(/S0049/);
    expect(textOf(result)).toMatch(/lotsAvailable=80/);
    expect(result.details).toMatchObject({ count: 1 });
  });
});
