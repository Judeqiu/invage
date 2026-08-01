/**
 * property_intel — live Singapore property market intelligence via data.gov.sg.
 *
 * HDB resale: full collection "Resale Flat Prices" (1990 → present) across
 * period-sliced datasets. API key DATA_GOV_SG_API_KEY recommended in production
 * (higher rate limits). Private residential: URA path not implemented yet.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchPrivateResidentialBatches,
  flattenPrivateProjects,
  type FlatPrivateSale,
} from '../market/ura-client.js';

const DATASTORE_URL = 'https://data.gov.sg/api/action/datastore_search';
const COLLECTION_META_URL =
  'https://api-production.data.gov.sg/v2/public/api/collections/189/metadata';

/**
 * Official HDB resale collection (id 189) child datasets.
 * Coverage verified against data.gov.sg datastore sort month asc/desc.
 * Env HDB_RESALE_RESOURCE_ID overrides only the "current" (2017+) slice when set.
 */
const HDB_RESALE_SOURCES = [
  {
    id: 'hdb_resale_1990_1999',
    resourceId: 'd_ebc5ab87086db484f88045b47411ebc5',
    label: 'HDB resale Jan 1990 – Dec 1999',
    monthFrom: '1990-01',
    monthTo: '1999-12',
  },
  {
    id: 'hdb_resale_2000_2012',
    resourceId: 'd_43f493c6c50d54243cc1eab0df142d6a',
    label: 'HDB resale Jan 2000 – Feb 2012',
    monthFrom: '2000-01',
    monthTo: '2012-02',
  },
  {
    id: 'hdb_resale_2012_2014',
    resourceId: 'd_2d5ff9ea31397b66239f245f57751537',
    label: 'HDB resale Mar 2012 – Dec 2014',
    monthFrom: '2012-03',
    monthTo: '2014-12',
  },
  {
    id: 'hdb_resale_2015_2016',
    resourceId: 'd_ea9ed51da2787afaf8e51f827c304208',
    label: 'HDB resale Jan 2015 – Dec 2016',
    monthFrom: '2015-01',
    monthTo: '2016-12',
  },
  {
    id: 'hdb_resale_2017_present',
    resourceId: 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc',
    label: 'HDB resale Jan 2017 – present (default current)',
    monthFrom: '2017-01',
    monthTo: '9999-12',
  },
] as const;

type HdbSourceId = (typeof HDB_RESALE_SOURCES)[number]['id'];

type Market = 'hdb' | 'private';
type Action = 'list_sources' | 'search_transactions' | 'price_summary';

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
  /** Pin to one catalog slice; default auto by month range (current if omitted). */
  source_id?: string;
  /** Override resource_id (advanced). When set, skips catalog multi-slice. */
  resource_id?: string;
  /** Private: project name substring (e.g. condo name). */
  project?: string;
  /** Private: market segment CCR | RCR | OCR. */
  market_segment?: string;
  /** Private: postal district e.g. "09", "15". */
  district?: string;
  /** Private: property type substring e.g. Condominium, Apartment, Terrace. */
  property_type?: string;
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
  let t = ft.trim().toUpperCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (/^\d\s*ROOM$/.test(t)) return t.replace(/(\d)\s*ROOM/, '$1 ROOM');
  if (/^\d$/.test(t)) return `${t} ROOM`;
  if (t === 'EXEC' || t === 'EXEC CONDO' || t === 'EC') {
    return t;
  }
  return t;
}

function monthInRange(month: string, from?: string, to?: string): boolean {
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

function currentResourceId(): string {
  const env = process.env.HDB_RESALE_RESOURCE_ID?.trim();
  if (env) return env;
  return HDB_RESALE_SOURCES[HDB_RESALE_SOURCES.length - 1]!.resourceId;
}

function resolveSources(params: SearchParams): Array<{
  sourceId: string;
  resourceId: string;
  label: string;
}> {
  if (params.resource_id?.trim()) {
    return [
      {
        sourceId: 'custom',
        resourceId: params.resource_id.trim(),
        label: `custom resource_id=${params.resource_id.trim()}`,
      },
    ];
  }

  if (params.source_id?.trim()) {
    const id = params.source_id.trim() as HdbSourceId;
    const src = HDB_RESALE_SOURCES.find((s) => s.id === id);
    if (!src) {
      throw new Error(
        `Unknown source_id "${params.source_id}". Use action=list_sources for catalog ids.`,
      );
    }
    const resourceId =
      src.id === 'hdb_resale_2017_present' ? currentResourceId() : src.resourceId;
    return [{ sourceId: src.id, resourceId, label: src.label }];
  }

  // Auto: if month range given, pick all overlapping slices; else current only.
  const from = params.month_from?.trim();
  const to = params.month_to?.trim();
  if (!from && !to) {
    const cur = HDB_RESALE_SOURCES[HDB_RESALE_SOURCES.length - 1]!;
    return [
      {
        sourceId: cur.id,
        resourceId: currentResourceId(),
        label: cur.label,
      },
    ];
  }

  const qFrom = from ?? '0000-01';
  const qTo = to ?? '9999-12';
  const matched = HDB_RESALE_SOURCES.filter(
    (s) => s.monthFrom <= qTo && s.monthTo >= qFrom,
  ).map((s) => ({
    sourceId: s.id,
    resourceId: s.id === 'hdb_resale_2017_present' ? currentResourceId() : s.resourceId,
    label: s.label,
  }));

  if (matched.length === 0) {
    throw new Error(
      `No HDB resale dataset covers month range ${qFrom}..${qTo}. Use action=list_sources.`,
    );
  }
  return matched;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = process.env.DATA_GOV_SG_API_KEY?.trim();
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

function hasApiKey(): boolean {
  return Boolean(process.env.DATA_GOV_SG_API_KEY?.trim());
}

async function fetchDatastorePage(
  resourceId: string,
  filters: Record<string, string>,
  limit: number,
  offset: number,
): Promise<{ total: number; records: HdbRecord[] }> {
  const url = new URL(DATASTORE_URL);
  url.searchParams.set('resource_id', resourceId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  // Prefer newest first when API supports sort (ignored if unsupported).
  url.searchParams.set('sort', 'month desc');
  if (Object.keys(filters).length > 0) {
    url.searchParams.set('filters', JSON.stringify(filters));
  }

  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (res.status === 429) {
    throw new Error(
      'data.gov.sg rate limited (HTTP 429). Ensure DATA_GOV_SG_API_KEY is set for production ' +
        'higher limits, reduce concurrent queries, and retry. Do not invent comps.',
    );
  }
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

async function queryOneResource(
  resourceId: string,
  params: SearchParams,
  filters: Record<string, string>,
  want: number,
): Promise<{ totalMatched: number; records: HdbRecord[] }> {
  const pageSize = 100;
  const maxScan = 2000;
  const collected: HdbRecord[] = [];
  let offset = 0;
  let apiTotal = 0;
  let scanned = 0;

  while (scanned < maxScan && collected.length < want) {
    const page = await fetchDatastorePage(resourceId, filters, pageSize, offset);
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

  collected.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  return { totalMatched: apiTotal, records: collected.slice(0, want) };
}

async function queryHdb(params: SearchParams): Promise<{
  totalMatched: number;
  records: HdbRecord[];
  filters: Record<string, string>;
  sourcesUsed: Array<{ sourceId: string; resourceId: string; label: string; totalMatched: number }>;
}> {
  const filters: Record<string, string> = {};
  if (params.town) filters.town = normalizeTown(params.town);
  if (params.flat_type) filters.flat_type = normalizeFlatType(params.flat_type);
  if (params.street_name) filters.street_name = params.street_name.trim().toUpperCase();

  const want = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const sources = resolveSources(params);
  const all: HdbRecord[] = [];
  const sourcesUsed: Array<{
    sourceId: string;
    resourceId: string;
    label: string;
    totalMatched: number;
  }> = [];
  let totalMatched = 0;

  // Query newest sources first so returned sample is recent when multi-slice.
  for (const src of [...sources].reverse()) {
    const remaining = want - all.length;
    if (remaining <= 0) break;
    const part = await queryOneResource(src.resourceId, params, filters, remaining);
    sourcesUsed.push({
      sourceId: src.sourceId,
      resourceId: src.resourceId,
      label: src.label,
      totalMatched: part.totalMatched,
    });
    totalMatched += part.totalMatched;
    all.push(...part.records);
  }

  all.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
  return {
    totalMatched,
    records: all.slice(0, want),
    filters,
    sourcesUsed,
  };
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

async function handleListSources(): Promise<AgentToolResult<unknown>> {
  const lines = [
    'data.gov.sg HDB resale catalog (collection 189 — Resale Flat Prices)',
    `API key configured: ${hasApiKey() ? 'yes' : 'NO — set DATA_GOV_SG_API_KEY for production rate limits'}`,
    `Current (2017+) resource override env: ${process.env.HDB_RESALE_RESOURCE_ID?.trim() || '(none — using catalog default)'}`,
    '',
    'source_id | resource_id | coverage',
  ];
  for (const s of HDB_RESALE_SOURCES) {
    const rid = s.id === 'hdb_resale_2017_present' ? currentResourceId() : s.resourceId;
    lines.push(`- ${s.id} | ${rid} | ${s.monthFrom} → ${s.monthTo === '9999-12' ? 'present' : s.monthTo}`);
  }
  lines.push(
    '',
    'Usage:',
    '- Default queries use 2017–present only (current market).',
    '- Set month_from/month_to spanning older years to auto-query historical slices.',
    '- Or pass source_id / resource_id to pin one dataset.',
    '- Private condo sold prices are NOT on data.gov.sg here — use market=private (URA) or firecrawl for named units.',
  );

  // Live ping current resource (fail-fast if unreachable)
  const cur = currentResourceId();
  try {
    const ping = await fetchDatastorePage(cur, {}, 1, 0);
    lines.push('', `Live check current resource ${cur}: OK (total rows ≈ ${ping.total})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lines.push('', `Live check current resource ${cur}: FAILED — ${msg}`);
    return fail(lines.join('\n'));
  }

  // Optional: refresh child dataset ids from collection metadata (informational)
  try {
    const res = await fetch(COLLECTION_META_URL, { headers: authHeaders() });
    if (res.ok) {
      const body = (await res.json()) as {
        data?: { collectionMetadata?: { childDatasets?: string[]; lastUpdatedAt?: string } };
      };
      const children = body.data?.collectionMetadata?.childDatasets ?? [];
      const known = new Set<string>(HDB_RESALE_SOURCES.map((s) => s.resourceId));
      // current may be env-overridden; also accept env value
      known.add(currentResourceId());
      const unknown = children.filter((c) => !known.has(c));
      lines.push(
        '',
        `Collection 189 lastUpdatedAt: ${body.data?.collectionMetadata?.lastUpdatedAt ?? 'unknown'}`,
        `Child datasets from API: ${children.join(', ') || '(none)'}`,
      );
      if (unknown.length > 0) {
        lines.push(
          `WARNING: collection has dataset ids not in catalog: ${unknown.join(', ')} — update HDB_RESALE_SOURCES in property_intel.ts`,
        );
      } else {
        lines.push('Catalog covers all collection child datasets (or current env override).');
      }
    }
  } catch {
    lines.push('', 'Collection metadata refresh skipped (network error) — catalog still usable.');
  }

  return ok(lines.join('\n'), {
    action: 'list_sources',
    apiKeyConfigured: hasApiKey(),
    sources: HDB_RESALE_SOURCES.map((s) => ({
      id: s.id,
      resourceId: s.id === 'hdb_resale_2017_present' ? currentResourceId() : s.resourceId,
      monthFrom: s.monthFrom,
      monthTo: s.monthTo === '9999-12' ? null : s.monthTo,
      label: s.label,
    })),
  });
}

function includesCI(hay: string, needle: string): boolean {
  return hay.toUpperCase().includes(needle.trim().toUpperCase());
}

function filterPrivateSales(sales: FlatPrivateSale[], params: SearchParams): FlatPrivateSale[] {
  return sales.filter((s) => {
    if (params.project && !includesCI(s.project, params.project)) return false;
    if (params.street_name && !includesCI(s.street, params.street_name)) return false;
    if (params.market_segment && !includesCI(s.marketSegment, params.market_segment)) return false;
    if (params.district) {
      const d = params.district.trim().replace(/^D/i, '').padStart(2, '0');
      const sd = s.district.replace(/^D/i, '').padStart(2, '0');
      if (sd !== d) return false;
    }
    if (params.property_type && !includesCI(s.propertyType, params.property_type)) return false;
    if (params.month_from && s.contractMonth && s.contractMonth < params.month_from) return false;
    if (params.month_to && s.contractMonth && s.contractMonth > params.month_to) return false;
    // If month filter set but sale has no parseable month, drop it
    if ((params.month_from || params.month_to) && !s.contractMonth) return false;
    return true;
  });
}

function sgdPrivate(n: number): string {
  return `S$${Math.round(n).toLocaleString('en-SG')}`;
}

function formatPrivateSales(sales: FlatPrivateSale[]): string {
  if (sales.length === 0) return 'No matching private residential transactions.';
  return sales
    .map((s) => {
      const price = s.price != null ? sgdPrivate(s.price) : 'price?';
      const area = s.area != null ? `${s.area} sqm` : 'area?';
      const psf =
        s.price != null && s.area != null && s.area > 0
          ? ` (~${sgdPrivate(s.price / (s.area * 10.7639))} psf)`
          : '';
      return (
        `- ${s.contractMonth || s.contractDateRaw} | ${s.project} | ${s.street} | ` +
        `${s.propertyType} | D${s.district} | ${s.marketSegment} | ${s.tenure} | ` +
        `${s.floorRange} | ${area} | ${price}${psf}`
      );
    })
    .join('\n');
}

function summarizePrivate(sales: FlatPrivateSale[]): string {
  if (sales.length === 0) return 'No matching transactions to summarize.';
  const priced = sales.filter((s) => s.price != null) as Array<FlatPrivateSale & { price: number }>;
  if (priced.length === 0) {
    return `Sample size: ${sales.length} (no numeric prices to summarize).`;
  }
  const prices = priced.map((s) => s.price);
  const sorted = [...prices].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const months = sales.map((s) => s.contractMonth || s.contractDateRaw).filter(Boolean).sort();
  const psfs = priced
    .filter((s) => s.area != null && s.area > 0)
    .map((s) => s.price / (s.area! * 10.7639));
  const lines = [
    `Sample size: ${sales.length} transactions (${priced.length} with price)`,
    months.length
      ? `Contract month span (approx): ${months[0]} → ${months[months.length - 1]}`
      : 'Contract months: unknown',
    `Price: min ${sgdPrivate(Math.min(...prices))} | median ${sgdPrivate(med)} | avg ${sgdPrivate(avg)} | max ${sgdPrivate(Math.max(...prices))}`,
  ];
  if (psfs.length > 0) {
    lines.push(
      `PSF (approx, sqm×10.7639): min ${sgdPrivate(Math.min(...psfs))} | avg ${sgdPrivate(psfs.reduce((a, b) => a + b, 0) / psfs.length)} | max ${sgdPrivate(Math.max(...psfs))}`,
    );
  }
  lines.push('', 'Latest sample rows:', formatPrivateSales(sales.slice(0, 10)));
  return lines.join('\n');
}

async function handlePrivate(
  params: SearchParams,
): Promise<AgentToolResult<unknown>> {
  if (
    !params.project &&
    !params.street_name &&
    !params.district &&
    !params.market_segment &&
    !params.property_type &&
    !params.month_from
  ) {
    throw new Error(
      'Private market requires at least one filter: project, street_name, district, market_segment, property_type, or month_from. ' +
        'Do not pull the full URA universe without a filter.',
    );
  }

  const projects = await fetchPrivateResidentialBatches({ maxBatches: 4 });
  const flat = flattenPrivateProjects(projects);
  const matched = filterPrivateSales(flat, params);
  // Newest first by contractMonth then raw
  matched.sort((a, b) => {
    const am = a.contractMonth || '';
    const bm = b.contractMonth || '';
    if (am !== bm) return am < bm ? 1 : -1;
    return a.contractDateRaw < b.contractDateRaw ? 1 : -1;
  });
  const want = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const sample = matched.slice(0, want);

  const header = [
    'Source: URA PMI_Resi_Transaction (eservice.ura.gov.sg)',
    `Projects loaded: ${projects.length} | flat sales: ${flat.length} | after filters: ${matched.length}`,
    `Filters: ${JSON.stringify({
      project: params.project,
      street_name: params.street_name,
      district: params.district,
      market_segment: params.market_segment,
      property_type: params.property_type,
      month_from: params.month_from,
      month_to: params.month_to,
    })}`,
    `Returned rows: ${sample.length}`,
    'Note: contractDate is MMYY → month is approximate (day unknown). PSF uses area sqm × 10.7639.',
    'Label as URA recorded sold transactions (not portal asking prices).',
    '',
  ].join('\n');

  if (params.action === 'price_summary') {
    return ok(header + summarizePrivate(sample), {
      market: 'private',
      action: params.action,
      projectsLoaded: projects.length,
      flatSales: flat.length,
      matched: matched.length,
      count: sample.length,
    });
  }

  return ok(header + formatPrivateSales(sample), {
    market: 'private',
    action: params.action,
    projectsLoaded: projects.length,
    flatSales: flat.length,
    matched: matched.length,
    count: sample.length,
    sample,
  });
}

export function createPropertyIntelTool(): AgentTool {
  return {
    name: 'property_intel',
    label: 'Property Intel',
    description:
      'Query Singapore residential market data. ' +
      'market=hdb: data.gov.sg HDB resale (1990–present); action=list_sources | search_transactions | price_summary; ' +
      'filters town/flat_type/street_name/month_from/month_to. ' +
      'market=private: URA PMI_Resi_Transaction sold comps (requires URA_ACCESS_KEY); ' +
      'filters project/street_name/district/market_segment/property_type/month_from/month_to (at least one required). ' +
      'Always call before stating sold prices/psf. Never invent comps.',
    parameters: Type.Object({
      market: Type.Union([Type.Literal('hdb'), Type.Literal('private')], {
        description: 'hdb = HDB resale (data.gov.sg); private = URA private residential sold',
      }),
      action: Type.Union(
        [
          Type.Literal('list_sources'),
          Type.Literal('search_transactions'),
          Type.Literal('price_summary'),
        ],
        {
          description:
            'list_sources = HDB catalog only; search_transactions = rows; price_summary = stats + sample',
        },
      ),
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
        Type.String({
          description: 'Street name (HDB or private project street)',
        }),
      ),
      month_from: Type.Optional(
        Type.String({ description: 'Inclusive start month YYYY-MM' }),
      ),
      month_to: Type.Optional(Type.String({ description: 'Inclusive end month YYYY-MM' })),
      limit: Type.Optional(
        Type.Number({ description: 'Max rows to return/sample (1–100, default 25)' }),
      ),
      source_id: Type.Optional(
        Type.String({
          description:
            'HDB catalog id e.g. hdb_resale_2017_present (see list_sources)',
        }),
      ),
      resource_id: Type.Optional(
        Type.String({
          description: 'HDB: pin a data.gov.sg dataset/resource id (d_… or UUID)',
        }),
      ),
      project: Type.Optional(
        Type.String({ description: 'Private: project/condo name substring' }),
      ),
      market_segment: Type.Optional(
        Type.String({ description: 'Private: CCR | RCR | OCR' }),
      ),
      district: Type.Optional(
        Type.String({ description: 'Private: postal district e.g. 09 or 15' }),
      ),
      property_type: Type.Optional(
        Type.String({
          description: 'Private: Condominium, Apartment, Terrace, Semi-detached, Detached, …',
        }),
      ),
    }),
    execute: async (_id, raw) => {
      try {
        const params = raw as SearchParams;
        if (!params.market) throw new Error('market is required (hdb | private)');
        if (!params.action) {
          throw new Error(
            'action is required (list_sources | search_transactions | price_summary)',
          );
        }

        if (params.action === 'list_sources') {
          if (params.market !== 'hdb') {
            throw new Error('list_sources is only for market=hdb (data.gov.sg HDB resale catalog)');
          }
          return await handleListSources();
        }

        if (params.market === 'private') {
          return await handlePrivate(params);
        }

        if (
          !params.town &&
          !params.street_name &&
          !params.flat_type &&
          !params.month_from &&
          !params.source_id &&
          !params.resource_id
        ) {
          throw new Error(
            'At least one filter required for HDB queries: town, flat_type, street_name, month_from, source_id, or resource_id',
          );
        }

        if (!hasApiKey()) {
          console.warn(
            '[property_intel] DATA_GOV_SG_API_KEY not set — public limits apply; set key for production',
          );
        }

        const { totalMatched, records, filters, sourcesUsed } = await queryHdb(params);
        const header = [
          'Source: data.gov.sg HDB resale (collection 189)',
          `API key: ${hasApiKey() ? 'yes' : 'no (public limits)'}`,
          `Datasets used: ${sourcesUsed.map((s) => `${s.sourceId}(${s.resourceId}, api_total=${s.totalMatched})`).join('; ')}`,
          `API filter match count (sum of slices, before month client filter): ${totalMatched}`,
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
            sourcesUsed,
          });
        }

        return ok(header + formatTransactions(records), {
          market: 'hdb',
          action: params.action,
          totalMatched,
          count: records.length,
          filters,
          sourcesUsed,
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
