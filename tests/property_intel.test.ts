import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPropertyIntelTool } from '../src/tools/property_intel.js';

const sampleRecords = [
  {
    month: '2026-06',
    town: 'TAMPINES',
    flat_type: '4 ROOM',
    block: '123',
    street_name: 'TAMPINES ST 11',
    storey_range: '07 TO 09',
    floor_area_sqm: '100',
    flat_model: 'Model A',
    lease_commence_date: '1995',
    remaining_lease: '68 years 01 month',
    resale_price: '650000',
  },
  {
    month: '2026-05',
    town: 'TAMPINES',
    flat_type: '4 ROOM',
    block: '124',
    street_name: 'TAMPINES ST 11',
    storey_range: '10 TO 12',
    floor_area_sqm: '105',
    flat_model: 'Model A',
    lease_commence_date: '1996',
    remaining_lease: '69 years',
    resale_price: '700000',
  },
];

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

describe('property_intel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.URA_ACCESS_KEY;
    delete process.env.HDB_RESALE_RESOURCE_ID;
    delete process.env.DATA_GOV_SG_API_KEY;
  });

  it('fails fast when HDB has no filters', async () => {
    const tool = createPropertyIntelTool();
    const result = await tool.execute('t1', {
      market: 'hdb',
      action: 'search_transactions',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/At least one filter required/i);
  });

  it('fails private market without URA key (named research, no invent)', async () => {
    delete process.env.URA_ACCESS_KEY;
    const tool = createPropertyIntelTool();
    const result = await tool.execute('t2', {
      market: 'private',
      action: 'price_summary',
    });
    expect(result.details).toBeNull();
    const text = textOf(result);
    expect(text).toMatch(/URA_ACCESS_KEY missing/i);
    expect(text).toMatch(/named/i);
    expect(text).toMatch(/Do NOT invent/i);
  });

  it('fails private market when URA key set but not implemented', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    const tool = createPropertyIntelTool();
    const result = await tool.execute('t3', {
      market: 'private',
      action: 'search_transactions',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/not implemented/i);
  });

  it('returns HDB search_transactions from mocked data.gov.sg', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { total: 2, records: sampleRecords },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t4', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'Tampines',
      flat_type: '4 ROOM',
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalled();
    const text = textOf(result);
    expect(text).toMatch(/TAMPINES/);
    expect(text).toMatch(/650000|S\$650,000/);
    expect(result.details).toMatchObject({
      market: 'hdb',
      action: 'search_transactions',
      count: 2,
    });
  });

  it('returns HDB price_summary with median stats', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: { total: 2, records: sampleRecords },
        }),
      }),
    );

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t5', {
      market: 'hdb',
      action: 'price_summary',
      town: 'TAMPINES',
      flat_type: '4',
    });

    const text = textOf(result);
    expect(text).toMatch(/Sample size: 2/);
    expect(text).toMatch(/median/i);
    expect(text).toMatch(/PSF/i);
    expect(result.details).toMatchObject({ market: 'hdb', action: 'price_summary', count: 2 });
  });

  it('surfaces data.gov.sg HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
      }),
    );

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t6', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'BISHAN',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/property_intel failed/i);
    expect(textOf(result)).toMatch(/503/);
  });

  it('returns empty sample without inventing rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: { total: 0, records: [] },
        }),
      }),
    );

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t7', {
      market: 'hdb',
      action: 'price_summary',
      town: 'PUNGGOL',
      flat_type: '5 ROOM',
    });
    const text = textOf(result);
    expect(text).toMatch(/No matching/i);
    expect(result.details).toMatchObject({ count: 0 });
  });
});
