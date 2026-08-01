import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchUraToken,
  flattenPrivateProjects,
  invokeUraService,
  parseUraContractMonth,
} from '../src/market/ura-client.js';

describe('ura-client helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.URA_ACCESS_KEY;
    delete process.env.URA_BASE_URL;
  });

  it('parseUraContractMonth maps MMYY to YYYY-MM', () => {
    expect(parseUraContractMonth('0724')).toBe('2024-07');
    expect(parseUraContractMonth('1221')).toBe('2021-12');
    expect(parseUraContractMonth('bad')).toBeNull();
  });

  it('flattenPrivateProjects expands nested transactions', () => {
    const flat = flattenPrivateProjects([
      {
        project: 'TEST CONDO',
        street: 'ORCHARD ROAD',
        marketSegment: 'CCR',
        transaction: [
          {
            area: '100',
            floorRange: '10-15',
            noOfUnits: '1',
            contractDate: '0624',
            price: '2000000',
            propertyType: 'Condominium',
            district: '09',
            typeOfArea: 'Strata',
            tenure: '99 yrs',
            typeOfSale: '3',
          },
        ],
      },
    ]);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.project).toBe('TEST CONDO');
    expect(flat[0]!.price).toBe(2000000);
    expect(flat[0]!.contractMonth).toBe('2024-06');
  });

  it('fetchUraToken fails fast without key', async () => {
    delete process.env.URA_ACCESS_KEY;
    await expect(fetchUraToken()).rejects.toThrow(/URA_ACCESS_KEY is not set/);
  });

  it('fetchUraToken returns Result token on Success', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Status: 'Success', Message: '', Result: 'tok-abc' }),
      }),
    );
    const token = await fetchUraToken();
    expect(token).toBe('tok-abc');
  });

  it('invokeUraService sends AccessKey and Token', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    process.env.URA_BASE_URL = 'https://eservice.ura.gov.sg';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Status: 'Success', Result: 'tok-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          Buffer.from(
            JSON.stringify({
              Status: 'Success',
              Result: [{ carparkNo: 'A1', lotsAvailable: '3', lotType: 'C' }],
            }),
          ),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeUraService<unknown[]>('Car_Park_Availability');
    expect(result).toHaveLength(1);
    const invokeCall = fetchMock.mock.calls[1]!;
    expect(String(invokeCall[0])).toMatch(/invokeUraDS\/v1/);
    expect(String(invokeCall[0])).toMatch(/service=Car_Park_Availability/);
    const headers = (invokeCall[1] as { headers: Record<string, string> }).headers;
    expect(headers.AccessKey).toBe('test-key');
    expect(headers.Token).toBe('tok-1');
  });

  it('invokeUraService fails on Status Error', async () => {
    process.env.URA_ACCESS_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () =>
          Buffer.from(JSON.stringify({ Status: 'Error', Message: 'Invalid service.' })),
      }),
    );
    await expect(
      invokeUraService('Bad', {}, { accessKey: 'test-key', token: 't' }),
    ).rejects.toThrow(/Invalid service/);
  });
});
