import { saveInvestor, type InvestorSnapshot } from '../state/investor-store.js';
/**
 * IBKR Flex XML adapter. Maps vendor rows into the public BrokerStatement
 * then applies through the shared books path. Flex types are not stored.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataRoot } from 'utarus';
import { applyBrokerStatement } from '../brokers/apply-statement.js';
import type { BrokerApplyResult } from '../brokers/statement.js';
import type { InvestorState } from '../state/portfolio-state.js';
import { IBKR_CHANNEL, mapFlexDocToStatement } from './flex-map.js';
import type { FlexStatementDoc } from './flex-parse.js';

export type { BrokerApplyResult as FlexApplyResult };

export {
  replaceChannelCash,
  replaceChannelHoldings,
} from '../brokers/apply-statement.js';

export function archiveXml(slug: string, xml: Buffer, asOf: string): string {
  const dir = join(resolveDataRoot(), 'drive', slug, 'ibkr-flex');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `activity-${asOf}-${stamp}.xml`);
  writeFileSync(file, xml);
  return file;
}

export async function applyFlexStatement(
  snapshot: InvestorSnapshot,
  doc: FlexStatementDoc,
  rawXml?: Buffer,
): Promise<BrokerApplyResult> {
  const { state } = snapshot;
  const statement = mapFlexDocToStatement(doc, IBKR_CHANNEL);
  const applied = await applyBrokerStatement(snapshot, IBKR_CHANNEL, statement, rawXml);
  const slug = state.user.slug;
  if (rawXml && slug) {
    applied.archivePath = archiveXml(slug, rawXml, applied.asOf);
  }
  return applied;
}
