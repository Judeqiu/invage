/**
 * property_intel — live Singapore property market intelligence.
 *
 * HDB resale: data.gov.sg CKAN datastore (resource configurable via HDB_RESALE_RESOURCE_ID).
 * Private residential: requires URA_ACCESS_KEY (fail-fast if missing).
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

const DEFAULT_HDB_RESOURCE = 'f1765b54-a209-4718-8d38-a39237f502b3';
const DATASTORE_URL = 'https://data.gov.sg/api/action/datastore_search';

type Market = 'hdb' | 'private';
type Action = 'search_transactions' | 'price_summary';

interface HdbRecord {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string | number;
  flat_model: string;
  lease_commence_date: string | number;
  remaining_lease?: string;
  resale_price: string | number;
}

interface SearchParams {
  market: Market;
  action: Action;
  town?: string;
  flat_type?: string;
  street_name?: string;
  month_from?: string;
  month_to?: string;
  limit?: number;
}

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}

function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

function num(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    throw new Error(`Non-numeric value: ${v}`);
  }
  return n;
}

function sgd(n: number): string {
  return `S$${Math.round(n).toLocaleString('en-SG')}`;
}

function normalizeTown(town: string): string {
  return town.trim().toUpperCase();
}

function normalizeFlatType(ft: string): string {
  // data.gov.sg uses "4 ROOM", "EXECUTIVE", etc.
  let t = ft.trim().toUpperCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (/^\d\s*ROOM$/.test(t)) return t.replace(/(\d)\s*ROOM/, '$1 ROOM');
  if (/^\d$/.test(t)) return `${t} ROOM`;
  if (t === 'EXEC' || t === 'EXEC CONDO' || t === 'EC') {
    // EC is not in HDB resale dataset; leave as-is for private path
    return t;
  }
  return t;
}

function monthInRange(month: string, from?: string, to?: string): boolean {
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

async function fetchHdbPage(filters: Record<string, string>, limit: number, offset: number): Promise<{
  total: number;
  records: HdbRecord[];
}> {
  const resourceId = process.env.HDB_RESALE_RESOURCE_ID?.trim() || DEFAULT_HDB_RESOURCE;
  const url = new URL(DATASTORE_URL);
  url.searchParams.set('resource_id', resourceId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (Object.keys(filters).length > 0) {
    url.searchParams.set('filters', JSON.stringify(filters));
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.DATA_GOV_SG_API_KEY?.trim();
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`data.gov.sg HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    result?: { total?: number; records?: HdbRecord[] };
    errorMsg?: string;
    name?: string;
    error?: unknown;
  };
  if (!data.success || !data.result) {
    throw new Error(
      `data.gov.sg error: ${data.errorMsg || data.name || JSON.stringify(data.error || data)}`,
    );
  }
  return {
    total: data.result.total ?? 0,
    records: data.result.records ?? [],
  };
}

/**
 * Pull HDB records matching filters. Month range is applied client-side when
 * month_from/month_to are set (CKAN equality filters only).
 */
async function queryHdb(params: SearchParams): Promise<{
  totalMatched: number;
  records: HdbRecord[];
  filters: Record<string, string>;
}> {
  const filters: Record<string, string> = {};
  if (params.town) filters.town = normalizeTown(params.town);
  if (params.flat_type) filters.flat_type = normalizeFlatType(params.flat_type);
  if (params.street_name) filters.street_name = params.street_name.trim().toUpperCase();

  const want = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const pageSize = 100;
  const maxScan = 2000;
  const collected: HdbRecord[] = [];
  let offset = 0;
  let apiTotal = 0;
  let scanned = 0;

  while (scanned < maxScan && collected.length < want) {
    const page = await fetchHdbPage(filters, pageSize, offset);
    apiTotal = page.total;
    if (page.records.length === 0) break;

    for (const r of page.records) {
      scanned += 1;
      if (!monthInRange(r.month, params.month_from, params.month_to)) continue;
      collected.push(r);
      if (collected.length >= want) break;
    }

    offset += page.records.length;
    if (offset >= page.total) break;
  }

  // Prefer newest months in the collected set
  collected.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));

  return { totalMatched: apiTotal, records: collected.slice(0, want), filters };
}

function formatTransactions(records: HdbRecord[]): string {
  if (records.length === 0) return 'No matching HDB resale transactions.';
  const lines = records.map((r) => {
    const price = num(r.resale_price);
    const area = num(r.floor_area_sqm);
    const psf = area > 0 ? price / (area * 10.7639) : 0;
    return (
      `- ${r.month} | ${r.town} | ${r.flat_type} | Blk ${r.block} ${r.street_name} | ` +
      `${r.storey_range} | ${area} sqm | ${r.flat_model} | lease ${r.lease_commence_date}` +
      (r.remaining_lease ? ` (remain ${r.remaining_lease})` : '') +
      ` | ${sgd(price)} (~${sgd(psf)} psf)`
    );
  });
  return lines.join('\n');
}

function summarize(records: HdbRecord[]): string {
  if (records.length === 0) return 'No matching transactions to summarize.';
  const prices = records.map((r) => num(r.resale_price));
  const psfs = records.map((r) => {
    const price = num(r.resale_price);
    const area = num(r.floor_area_sqm);
    if (area <= 0) throw new Error(`Invalid floor_area_sqm on record ${r.block} ${r.street_name}`);
    return price / (area * 10.7639);
  });
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sorted = [...prices].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const months = records.map((r) => r.month).sort();
  return [
    `Sample size: ${records.length} transactions`,
    `Month span in sample: ${months[0]} → ${months[months.length - 1]}`,
    `Price: min ${sgd(Math.min(...prices))} | median ${sgd(med)} | avg ${sgd(avg(prices))} | max ${sgd(Math.max(...prices))}`,
    `PSF (approx): min ${sgd(Math.min(...psfs))} | avg ${sgd(avg(psfs))} | max ${sgd(Math.max(...psfs))}`,
    '',
    'Latest sample rows:',
    formatTransactions(records.slice(0, 10)),
  ].join('\n');
}

async function handlePrivate(_params: SearchParams): Promise<AgentToolResult<null>> {
  const key = process.env.URA_ACCESS_KEY?.trim();
  if (!key) {
    return fail(
      'property_intel market=private is not connected (URA_ACCESS_KEY missing). ' +
        'Do NOT invent private sold prices. ' +
        'Next channel (same turn): firecrawl search + scrape for a **named** project/unit/listing URL or official URA/IRAS pages. ' +
        'Label asking vs sold. Do not build multi-unit shopping packs. ' +
        'For HDB sold prices use market=hdb. To enable URA later: https://www.ura.gov.sg/maps/api/',
    );
  }
  return fail(
    'URA private residential integration is not implemented yet (URA_ACCESS_KEY is set). ' +
      'Failing fast — do not invent private transaction prices. ' +
      'Next channel (same turn): firecrawl for a **named** project/unit or official URA pages only (not multi-unit listing packs). ' +
      'Label asking price vs sold price.',
  );
}

export function createPropertyIntelTool(): AgentTool {
  return {
    name: 'property_intel',
    label: 'Property Intel',
    description:
      'Query live Singapore residential market data and transaction comps. ' +
      'Use market=hdb for HDB resale (data.gov.sg). Use market=private only when URA_ACCESS_KEY is configured. ' +
      'action=search_transactions returns recent matching rows; action=price_summary returns min/median/avg/max and sample. ' +
      'Always call before stating prices, psf, or "latest market" claims. Filter by town, flat_type, street_name, month_from/month_to (YYYY-MM).',
    parameters: Type.Object({
      market: Type.Union([Type.Literal('hdb'), Type.Literal('private')], {
        description: 'hdb = HDB resale; private = private residential (requires URA_ACCESS_KEY)',
      }),
      action: Type.Union([Type.Literal('search_transactions'), Type.Literal('price_summary')], {
        description: 'search_transactions = list rows; price_summary = stats + sample',
      }),
      town: Type.Optional(
        Type.String({
          description: 'HDB town e.g. TAMPINES, BISHAN, QUEENSTOWN (case-insensitive)',
        }),
      ),
      flat_type: Type.Optional(
        Type.String({
          description: 'HDB flat type e.g. "4 ROOM", "5 ROOM", "EXECUTIVE"',
        }),
      ),
      street_name: Type.Optional(
        Type.String({ description: 'Street name as in HDB data e.g. "TAMPINES ST 81"' }),
      ),
      month_from: Type.Optional(
        Type.String({ description: 'Inclusive start month YYYY-MM' }),
      ),
      month_to: Type.Optional(Type.String({ description: 'Inclusive end month YYYY-MM' })),
      limit: Type.Optional(
        Type.Number({ description: 'Max rows to return/sample (1–100, default 25)' }),
      ),
    }),
    execute: async (_id, raw) => {
      try {
        const params = raw as SearchParams;
        if (!params.market) throw new Error('market is required (hdb | private)');
        if (!params.action) throw new Error('action is required (search_transactions | price_summary)');

        if (params.market === 'private') {
          return await handlePrivate(params);
        }

        if (!params.town && !params.street_name && !params.flat_type && !params.month_from) {
          throw new Error(
            'At least one filter required for HDB queries: town, flat_type, street_name, or month_from',
          );
        }

        const { totalMatched, records, filters } = await queryHdb(params);
        const header = [
          `Source: data.gov.sg HDB resale (resource ${process.env.HDB_RESALE_RESOURCE_ID?.trim() || DEFAULT_HDB_RESOURCE})`,
          `API filter match count (before month client filter): ${totalMatched}`,
          `Filters: ${JSON.stringify({ ...filters, month_from: params.month_from, month_to: params.month_to })}`,
          `Returned rows: ${records.length}`,
          '',
        ].join('\n');

        if (params.action === 'price_summary') {
          return ok(header + summarize(records), {
            market: 'hdb',
            action: params.action,
            totalMatched,
            count: records.length,
            filters,
          });
        }

        return ok(header + formatTransactions(records), {
          market: 'hdb',
          action: params.action,
          totalMatched,
          count: records.length,
          filters,
          records,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[property_intel]', message);
        return fail(`property_intel failed: ${message}`);
      }
    },
  };
}
