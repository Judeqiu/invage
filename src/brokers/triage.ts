/**
 * Broker ingest triage — one case per failed catalog parse.
 *
 * Layout (per user, per connector):
 *   drive/<slug>/broker-raw/<connector>/<id>/raw.xml
 *   drive/<slug>/broker-raw/<connector>/<id>/case.yaml
 *
 * case.yaml is the index the agent reads first (inventory + error).
 * Raw bytes stay next to it. Unknown case keys fail on load.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { parse, stringify } from 'yaml';
import { resolveDataRoot } from 'utarus';
import { getBrokerConnector } from './catalog.js';
import { looksLikeCsv } from '../ibkr/flex-parse.js';

export const BROKER_TRIAGE_STATUSES = ['open'] as const;
export type BrokerTriageStatus = (typeof BROKER_TRIAGE_STATUSES)[number];

export const POSITION_QTY_ATTRS = ['quantity', 'position', 'both', 'missing', 'none'] as const;
export type PositionQtyAttr = (typeof POSITION_QTY_ATTRS)[number];

export const RAW_LOOKS_LIKE = ['flex_xml', 'csv', 'json', 'unknown'] as const;
export type RawLooksLike = (typeof RAW_LOOKS_LIKE)[number];

export interface BrokerRawInventory {
  tags: Record<string, number>;
  cash_currencies: string[];
  position_qty_attr: PositionQtyAttr;
  looks_like: RawLooksLike;
  account_id?: string;
}

export interface BrokerTriageCase {
  id: string;
  connector: string;
  at: string;
  as_of: string;
  error: string;
  status: BrokerTriageStatus;
  inventory: BrokerRawInventory;
  raw_rel: string;
  raw_bytes: number;
  account_id?: string;
}

export interface ArchivedBrokerTriage {
  case: BrokerTriageCase;
  dir: string;
  rawPath: string;
  casePath: string;
}

const CASE_KEYS = new Set([
  'id',
  'connector',
  'at',
  'as_of',
  'error',
  'status',
  'inventory',
  'raw_rel',
  'raw_bytes',
  'account_id',
]);

const INVENTORY_KEYS = new Set([
  'tags',
  'cash_currencies',
  'position_qty_attr',
  'looks_like',
  'account_id',
]);

export function brokerRawConnectorDir(slug: string, connectorId: string): string {
  getBrokerConnector(connectorId);
  return join(resolveDataRoot(), 'drive', slug, 'broker-raw', connectorId);
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

function jsonTags(text: string): Record<string, number> {
  const tags: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      tags.array = parsed.length;
      return tags;
    }
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        tags[k] = Array.isArray(v) ? v.length : 1;
      }
      const positions = rec.positions;
      if (positions && typeof positions === 'object' && !Array.isArray(positions)) {
        for (const [k, v] of Object.entries(positions as Record<string, unknown>)) {
          tags[`positions.${k}`] = 1;
          const env = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
          const data = env?.data;
          const items = Array.isArray(data)
            ? data
            : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
              ? (data as { items: unknown[] }).items
              : null;
          if (items) tags[`positions.${k}`] = items.length;
        }
      }
    }
  } catch {
    /* not JSON */
  }
  return tags;
}

export function inventoryBrokerRaw(text: string): BrokerRawInventory {
  const looks_like: RawLooksLike = looksLikeCsv(text)
    ? 'csv'
    : text.includes('<FlexQueryResponse') || text.includes('<FlexStatement ')
      ? 'flex_xml'
      : looksLikeJson(text)
        ? 'json'
        : 'unknown';
  const tags: Record<string, number> = looks_like === 'json' ? jsonTags(text) : {};
  if (looks_like !== 'json') {
    for (const m of text.matchAll(/<([A-Za-z][\w:.-]*)\b/g)) {
      const tag = m[1];
      tags[tag] = (tags[tag] ?? 0) + 1;
    }
  }
  const cash_currencies = [
    ...new Set(
      [...text.matchAll(/<CashReportCurrency\b([^>]*)/gi)].flatMap((m) => {
        const ccy = m[1].match(/\bcurrency="([^"]*)"/i)?.[1]?.trim();
        return ccy ? [ccy] : [];
      }),
    ),
  ];
  const posChunks = [...text.matchAll(/<OpenPosition\b([^>]*)/gi)].map((m) => m[1]);
  let position_qty_attr: PositionQtyAttr = 'none';
  if (posChunks.length > 0) {
    const hasQ = posChunks.some((c) => /\bquantity=/.test(c));
    const hasP = posChunks.some((c) => /\bposition=/.test(c));
    if (hasQ && hasP) position_qty_attr = 'both';
    else if (hasP) position_qty_attr = 'position';
    else if (hasQ) position_qty_attr = 'quantity';
    else position_qty_attr = 'missing';
  }
  const account_id = text.match(/<FlexStatement\b[^>]*\baccountId="([^"]+)"/)?.[1];
  const inventory: BrokerRawInventory = {
    tags,
    cash_currencies,
    position_qty_attr,
    looks_like,
  };
  if (account_id) inventory.account_id = account_id;
  return inventory;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function assertInventory(raw: unknown, label: string): BrokerRawInventory {
  const o = asRecord(raw, label);
  for (const k of Object.keys(o)) {
    if (!INVENTORY_KEYS.has(k)) throw new Error(`${label}: unknown field "${k}".`);
  }
  if (o.tags == null || typeof o.tags !== 'object' || Array.isArray(o.tags)) {
    throw new Error(`${label}.tags must be a mapping.`);
  }
  const tags: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.tags as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`${label}.tags.${k} must be a number.`);
    }
    tags[k] = v;
  }
  if (!Array.isArray(o.cash_currencies) || o.cash_currencies.some((c) => typeof c !== 'string')) {
    throw new Error(`${label}.cash_currencies must be a string array.`);
  }
  if (
    typeof o.position_qty_attr !== 'string' ||
    !POSITION_QTY_ATTRS.includes(o.position_qty_attr as PositionQtyAttr)
  ) {
    throw new Error(`${label}.position_qty_attr is invalid.`);
  }
  if (typeof o.looks_like !== 'string' || !RAW_LOOKS_LIKE.includes(o.looks_like as RawLooksLike)) {
    throw new Error(`${label}.looks_like is invalid.`);
  }
  const inv: BrokerRawInventory = {
    tags,
    cash_currencies: o.cash_currencies as string[],
    position_qty_attr: o.position_qty_attr as PositionQtyAttr,
    looks_like: o.looks_like as RawLooksLike,
  };
  if (o.account_id != null) {
    if (typeof o.account_id !== 'string' || !o.account_id.trim()) {
      throw new Error(`${label}.account_id must be a non-empty string.`);
    }
    inv.account_id = o.account_id;
  }
  return inv;
}

export function assertBrokerTriageCase(raw: unknown, label = 'broker triage case'): BrokerTriageCase {
  const o = asRecord(raw, label);
  for (const k of Object.keys(o)) {
    if (!CASE_KEYS.has(k)) throw new Error(`${label}: unknown field "${k}".`);
  }
  for (const req of ['id', 'connector', 'at', 'as_of', 'error', 'status', 'inventory', 'raw_rel', 'raw_bytes'] as const) {
    if (o[req] == null) throw new Error(`${label}: missing ${req}.`);
  }
  if (typeof o.id !== 'string' || !o.id.trim()) throw new Error(`${label}.id must be a non-empty string.`);
  if (typeof o.connector !== 'string' || !o.connector.trim()) {
    throw new Error(`${label}.connector must be a non-empty string.`);
  }
  getBrokerConnector(o.connector);
  if (typeof o.at !== 'string' || !o.at.trim()) throw new Error(`${label}.at must be a non-empty string.`);
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new Error(`${label}.as_of must be YYYY-MM-DD.`);
  }
  if (typeof o.error !== 'string' || !o.error.trim()) throw new Error(`${label}.error must be a non-empty string.`);
  if (o.status !== 'open') throw new Error(`${label}.status must be open.`);
  if (typeof o.raw_rel !== 'string' || !o.raw_rel.trim()) {
    throw new Error(`${label}.raw_rel must be a non-empty string.`);
  }
  if (typeof o.raw_bytes !== 'number' || !Number.isFinite(o.raw_bytes) || o.raw_bytes < 0) {
    throw new Error(`${label}.raw_bytes must be a non-negative number.`);
  }
  const inventory = assertInventory(o.inventory, `${label}.inventory`);
  const c: BrokerTriageCase = {
    id: o.id,
    connector: o.connector,
    at: o.at,
    as_of: o.as_of,
    error: o.error,
    status: 'open',
    inventory,
    raw_rel: o.raw_rel,
    raw_bytes: o.raw_bytes,
  };
  if (o.account_id != null) {
    if (typeof o.account_id !== 'string' || !o.account_id.trim()) {
      throw new Error(`${label}.account_id must be a non-empty string.`);
    }
    c.account_id = o.account_id;
  }
  return c;
}

export function loadBrokerTriageCase(casePath: string): BrokerTriageCase {
  if (!existsSync(casePath)) throw new Error(`Broker triage case not found: ${casePath}`);
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(casePath, 'utf8'));
  } catch (e) {
    throw new Error(`Broker triage case ${casePath} is not YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  return assertBrokerTriageCase(parsed, casePath);
}

export function resolveCaseRawPath(caseDir: string, rawRel: string): string {
  if (rawRel.includes('..') || rawRel.includes('/') || rawRel.includes('\\')) {
    throw new Error(`Broker triage raw_rel must be a filename, got "${rawRel}".`);
  }
  return join(caseDir, rawRel);
}

export function archiveBrokerTriage(args: {
  slug: string;
  connectorId: string;
  body: Buffer;
  asOf: string;
  error: string;
}): ArchivedBrokerTriage {
  const connectorId = args.connectorId.trim();
  getBrokerConnector(connectorId);
  if (!args.error.trim()) throw new Error('archiveBrokerTriage: error is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOf)) {
    throw new Error(`archiveBrokerTriage: asOf must be YYYY-MM-DD, got "${args.asOf}".`);
  }
  const at = new Date().toISOString();
  const id = at.replace(/[:.]/g, '-');
  const text = args.body.toString('utf8');
  const inventory = inventoryBrokerRaw(text);
  const raw_rel =
    inventory.looks_like === 'flex_xml'
      ? 'raw.xml'
      : inventory.looks_like === 'json'
        ? 'raw.json'
        : 'raw.txt';
  const dir = join(brokerRawConnectorDir(args.slug, connectorId), id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, raw_rel);
  const casePath = join(dir, 'case.yaml');
  writeFileSync(rawPath, args.body);
  const triage: BrokerTriageCase = {
    id,
    connector: connectorId,
    at,
    as_of: args.asOf,
    error: args.error.trim(),
    status: 'open',
    inventory,
    raw_rel,
    raw_bytes: args.body.length,
  };
  if (inventory.account_id) triage.account_id = inventory.account_id;
  writeFileSync(casePath, stringify(triage, { sortMapEntries: false }), 'utf8');
  return { case: triage, dir, rawPath, casePath };
}

export function listBrokerTriageCases(slug: string, connectorId?: string): BrokerTriageCase[] {
  const root = join(resolveDataRoot(), 'drive', slug, 'broker-raw');
  const connectors = connectorId
    ? [getBrokerConnector(connectorId.trim()).id]
    : existsSync(root)
      ? readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];
  const out: BrokerTriageCase[] = [];
  for (const id of connectors) {
    const dir = brokerRawConnectorDir(slug, id);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const casePath = join(dir, name, 'case.yaml');
      if (!existsSync(casePath)) continue;
      out.push(loadBrokerTriageCase(casePath));
    }
  }
  return out;
}

export function publicTriageSummary(c: BrokerTriageCase, slug: string): Record<string, unknown> {
  const dir = join(brokerRawConnectorDir(slug, c.connector), c.id);
  return {
    id: c.id,
    connector: c.connector,
    at: c.at,
    as_of: c.as_of,
    error: c.error,
    status: c.status,
    account_id: c.account_id,
    inventory: c.inventory,
    raw_path: resolveCaseRawPath(dir, c.raw_rel),
    case_path: join(dir, 'case.yaml'),
    raw_bytes: c.raw_bytes,
  };
}

export function resolveBrokerRawFile(slug: string, connectorId: string, path?: string): string {
  const root = brokerRawConnectorDir(slug, connectorId);
  if (path?.trim()) {
    const file = path.trim();
    if (!file.startsWith(root)) {
      throw new Error("Broker raw path must be under this user's broker-raw directory for the connector.");
    }
    if (!existsSync(file)) throw new Error(`Broker raw not found: ${file}`);
    if (statSync(file).isDirectory()) {
      const c = loadBrokerTriageCase(join(file, 'case.yaml'));
      return resolveCaseRawPath(file, c.raw_rel);
    }
    if (basename(file) === 'case.yaml') {
      const c = loadBrokerTriageCase(file);
      return resolveCaseRawPath(dirname(file), c.raw_rel);
    }
    return file;
  }
  if (!existsSync(root)) {
    throw new Error(`No archived broker raw for connector "${connectorId}".`);
  }
  const caseDirs = readdirSync(root)
    .filter((n) => existsSync(join(root, n, 'case.yaml')))
    .sort();
  if (caseDirs.length > 0) {
    const last = caseDirs[caseDirs.length - 1];
    const c = loadBrokerTriageCase(join(root, last, 'case.yaml'));
    return resolveCaseRawPath(join(root, last), c.raw_rel);
  }
  const txts = readdirSync(root).filter((f) => f.endsWith('.txt')).sort();
  if (txts.length === 0) {
    throw new Error(`No archived broker raw for connector "${connectorId}".`);
  }
  return join(root, txts[txts.length - 1]);
}
