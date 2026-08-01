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

function mockDatastoreOk(records: unknown[], total?: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      result: { total: total ?? records.length, records },
    }),
  };
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

  it('fails private market without URA key', async () => {
    delete process.env.URA_ACCESS_KEY;
    const tool = createPropertyIntelTool();
    const result = await tool.execute('t2', {
      market: 'private',
      action: 'price_summary',
      project: 'TEST',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/URA_ACCESS_KEY/i);
  });

  it('fails private market without any filter', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    const tool = createPropertyIntelTool();
    const result = await tool.execute('t3', {
      market: 'private',
      action: 'search_transactions',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/at least one filter/i);
  });

  it('queries URA private residential with project filter', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    const projectPayload = {
      Status: 'Success',
      Result: [
        {
          project: 'FORETTE',
          street: 'BUKIT TIMAH ROAD',
          marketSegment: 'RCR',
          transaction: [
            {
              area: '67',
              floorRange: '01-05',
              noOfUnits: '1',
              contractDate: '0324',
              price: '1700000',
              propertyType: 'Condominium',
              district: '21',
              typeOfArea: 'Strata',
              tenure: 'Freehold',
              typeOfSale: '3',
            },
          ],
        },
      ],
    };
    const fetchMock = vi
      .fn()
      // token
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Status: 'Success', Result: 'tok' }),
      })
      // batch 1
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from(JSON.stringify(projectPayload)),
      })
      // batch 2 empty stops? actually Status Success Result []
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          Buffer.from(JSON.stringify({ Status: 'Success', Result: [] })),
      });
    vi.stubGlobal('fetch', fetchMock);

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t3b', {
      market: 'private',
      action: 'price_summary',
      project: 'FORETTE',
    });
    expect(result.details).not.toBeNull();
    expect(textOf(result)).toMatch(/FORETTE/);
    expect(textOf(result)).toMatch(/URA PMI_Resi_Transaction/);
    expect(textOf(result)).toMatch(/1,?700,?000|1700000|S\$/);
  });

  it('sends x-api-key when DATA_GOV_SG_API_KEY is set', async () => {
    process.env.DATA_GOV_SG_API_KEY = 'v2:test-key';
    const fetchMock = vi.fn().mockResolvedValue(mockDatastoreOk(sampleRecords, 2));
    vi.stubGlobal('fetch', fetchMock);

    const tool = createPropertyIntelTool();
    await tool.execute('t4', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'Tampines',
      flat_type: '4 ROOM',
    });

    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers['x-api-key']).toBe('v2:test-key');
  });

  it('returns HDB search_transactions from mocked data.gov.sg', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockDatastoreOk(sampleRecords, 2));
    vi.stubGlobal('fetch', fetchMock);

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t5', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'Tampines',
      flat_type: '4 ROOM',
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toMatch(/resource_id=d_8b84c4ee58e3cfc0ece0d773c8ca6abc|resource_id=/);
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDatastoreOk(sampleRecords, 2)));

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t6', {
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

  it('uses historical source when month_from is pre-2017', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockDatastoreOk(
        [
          {
            month: '2010-06',
            town: 'BISHAN',
            flat_type: '4 ROOM',
            block: '1',
            street_name: 'BISHAN ST 12',
            storey_range: '07 TO 09',
            floor_area_sqm: '100',
            flat_model: 'Model A',
            lease_commence_date: '1985',
            resale_price: '400000',
          },
        ],
        1,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t7', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'BISHAN',
      month_from: '2010-01',
      month_to: '2010-12',
    });

    expect(result.details).not.toBeNull();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    // 2000–2012 slice
    expect(urls.some((u) => u.includes('d_43f493c6c50d54243cc1eab0df142d6a'))).toBe(true);
  });

  it('surfaces rate limit and HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'rate limit',
      }),
    );

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t8', {
      market: 'hdb',
      action: 'search_transactions',
      town: 'BISHAN',
    });
    expect(result.details).toBeNull();
    expect(textOf(result)).toMatch(/429|rate limited/i);
  });

  it('returns empty sample without inventing rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDatastoreOk([], 0)));

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t9', {
      market: 'hdb',
      action: 'price_summary',
      town: 'PUNGGOL',
      flat_type: '5 ROOM',
    });
    const text = textOf(result);
    expect(text).toMatch(/No matching/i);
    expect(result.details).toMatchObject({ count: 0 });
  });

  it('list_sources pings current resource and lists catalog', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('collections/189')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            data: {
              collectionMetadata: {
                childDatasets: [
                  'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
                  'd_43f493c6c50d54243cc1eab0df142d6a',
                  'd_2d5ff9ea31397b66239f245f57751537',
                  'd_ebc5ab87086db484f88045b47411ebc5',
                  'd_ea9ed51da2787afaf8e51f827c304208',
                ],
                lastUpdatedAt: '2026-08-01T00:00:00+08:00',
              },
            },
          }),
        };
      }
      return mockDatastoreOk(sampleRecords.slice(0, 1), 236959);
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.DATA_GOV_SG_API_KEY = 'v2:test';

    const tool = createPropertyIntelTool();
    const result = await tool.execute('t10', {
      market: 'hdb',
      action: 'list_sources',
    });
    const text = textOf(result);
    expect(text).toMatch(/hdb_resale_2017_present/);
    expect(text).toMatch(/hdb_resale_1990_1999/);
    expect(text).toMatch(/API key configured: yes/);
    expect(text).toMatch(/Live check/);
    expect(result.details).toMatchObject({ action: 'list_sources', apiKeyConfigured: true });
  });
});
