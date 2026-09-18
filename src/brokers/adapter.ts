/**
 * Per-connector fetch/parse. Catalog id selects the adapter.
 * Apply stays in applyBrokerStatement; csv_tables stays in syncBrokerConnection.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from 'utarus';
import { archiveXml } from '../ibkr/flex-apply.js';
import { ibkrFlexAdapter } from '../ibkr/flex-adapter.js';
import type { FlexTransport } from '../ibkr/flex-client.js';
import { moomooAdapter } from '../moomoo/moomoo-adapter.js';
import { tigerAdapter } from '../tiger/tiger-adapter.js';
import { webullAdapter } from '../webull/webull-adapter.js';
import { getBrokerConnector } from './catalog.js';
import type { BrokerStatement } from './statement.js';

export type BrokerRawKind = 'xml' | 'json' | 'text';

export interface BrokerRawPayload {
  kind: BrokerRawKind;
  /** IBKR: Flex XML. Later vendors: versioned *RawBundle JSON. */
  body: Buffer;
  /** Method list, gateway host — never secrets. */
  meta?: Record<string, string>;
}

export type AdapterTransport =
  | { kind: 'ibkr'; flex: FlexTransport }
  | { kind: 'http'; fetch: typeof fetch };

export interface BrokerConnectorAdapter {
  readonly id: string;
  /** Only IBKR is true. Non-IBKR adapters must not call loadBrokerParserSpec. */
  readonly usesCsvTables: boolean;
  fetchRaw(
    credentials: Record<string, string>,
    opts?: { transport?: AdapterTransport },
  ): Promise<BrokerRawPayload>;
  parseToStatement(raw: BrokerRawPayload, channel: string): BrokerStatement;
}

export const adapters: Record<string, BrokerConnectorAdapter> = {
  ibkr: ibkrFlexAdapter,
  tiger: tigerAdapter,
  moomoo: moomooAdapter,
  webull: webullAdapter,
};

export function getBrokerAdapter(id: string): BrokerConnectorAdapter {
  getBrokerConnector(id);
  const ad = adapters[id];
  if (!ad) {
    throw new Error(`Broker connector "${id}" has no fetch adapter.`);
  }
  return ad;
}

export function archiveBrokerSuccess(
  slug: string,
  id: string,
  raw: BrokerRawPayload,
  asOf: string,
): string {
  if (id === 'ibkr') return archiveXml(slug, raw.body, asOf);
  if (id === 'tiger' || id === 'moomoo' || id === 'webull') {
    const dir = join(resolveDataRoot(), 'drive', slug, `${id}-raw`);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `snapshot-${asOf}-${stamp}.json`);
    writeFileSync(file, raw.body);
    return file;
  }
  throw new Error(`No success archive path for broker connector "${id}".`);
}
