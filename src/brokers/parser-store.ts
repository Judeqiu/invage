import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { assertCsvTablesSpec, type CsvTablesParserSpec } from './csv-tables.js';
import { getBrokerConnector } from './catalog.js';

export function brokerParserDir(slug: string): string {
  return join(resolveDataRoot(), 'drive', slug, 'broker-parsers');
}

export function brokerParserPath(slug: string, connectorId: string): string {
  getBrokerConnector(connectorId);
  return join(brokerParserDir(slug), `${connectorId}.json`);
}

export function loadBrokerParserSpec(slug: string, connectorId: string): CsvTablesParserSpec | null {
  const file = brokerParserPath(slug, connectorId);
  if (!existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch (e) {
    throw new Error(`Broker parser spec ${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return assertCsvTablesSpec(parsed);
}

export function saveBrokerParserSpec(
  slug: string,
  connectorId: string,
  spec: CsvTablesParserSpec,
): string {
  getBrokerConnector(connectorId);
  const dir = brokerParserDir(slug);
  mkdirSync(dir, { recursive: true });
  const file = brokerParserPath(slug, connectorId);
  writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return file;
}

export function archiveBrokerRaw(slug: string, connectorId: string, body: Buffer, asOf: string): string {
  getBrokerConnector(connectorId);
  const dir = join(resolveDataRoot(), 'drive', slug, 'broker-raw', connectorId);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${asOf}-${stamp}.txt`);
  writeFileSync(file, body);
  return file;
}

export function latestBrokerRawPath(slug: string, connectorId: string): string {
  getBrokerConnector(connectorId);
  const dir = join(resolveDataRoot(), 'drive', slug, 'broker-raw', connectorId);
  if (!existsSync(dir)) {
    throw new Error(`No archived broker raw for connector "${connectorId}".`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  if (files.length === 0) {
    throw new Error(`No archived broker raw for connector "${connectorId}".`);
  }
  return join(dir, files[files.length - 1]);
}

export function readBrokerRawFile(slug: string, connectorId: string, path?: string): { path: string; text: string } {
  getBrokerConnector(connectorId);
  const file = path?.trim() ? path.trim() : latestBrokerRawPath(slug, connectorId);
  const root = join(resolveDataRoot(), 'drive', slug, 'broker-raw', connectorId);
  if (!file.startsWith(root)) {
    throw new Error('Broker raw path must be under this user\'s broker-raw directory for the connector.');
  }
  if (!existsSync(file)) throw new Error(`Broker raw not found: ${file}`);
  return { path: file, text: readFileSync(file, 'utf8') };
}
