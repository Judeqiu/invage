import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { assertCsvTablesSpec, type CsvTablesParserSpec } from './csv-tables.js';
import { getBrokerConnector } from './catalog.js';
import { archiveBrokerTriage, resolveBrokerRawFile } from './triage.js';

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

export function archiveBrokerRaw(
  slug: string,
  connectorId: string,
  body: Buffer,
  asOf: string,
  error = 'catalog parse failed',
): string {
  return archiveBrokerTriage({ slug, connectorId, body, asOf, error }).rawPath;
}

export function latestBrokerRawPath(slug: string, connectorId: string): string {
  return resolveBrokerRawFile(slug, connectorId);
}

export function readBrokerRawFile(slug: string, connectorId: string, path?: string): { path: string; text: string } {
  const file = resolveBrokerRawFile(slug, connectorId, path);
  return { path: file, text: readFileSync(file, 'utf8') };
}
