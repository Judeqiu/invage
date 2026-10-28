import { createHash } from 'node:crypto';
import { assertUserId } from 'utarus';
import { isBooksEnabled, withHouseholdTx } from '../books/db.js';
import { extractBrokerActivity, type BrokerActivityScope } from './activity.js';
import type { BrokerRawPayload } from './adapter.js';

/** Increment on an indexing change; new versions coexist with original evidence. */
export const BROKER_ACTIVITY_EXTRACTOR_VERSION = 1;

export async function captureBrokerActivity(userId: string, scope: BrokerActivityScope, raw: Pick<BrokerRawPayload,'body'|'kind'>, sourceRef: string) {
  assertUserId(userId);
  if (![scope.brokerId,scope.channel,scope.accountId,sourceRef].every(s => typeof s === 'string' && s.trim())) {
    throw new Error('Broker activity requires a complete account scope and source reference.');
  }
  const sha256 = createHash('sha256').update(raw.body).digest('hex');
  const extracted = extractBrokerActivity(raw.body, raw.kind, scope);
  return withHouseholdTx(userId, async client => {
    // Evidence capture must not seed financial books or change any balances.
    await client.query('INSERT INTO households (id,slug) VALUES ($1::uuid,$1) ON CONFLICT (id) DO NOTHING', [userId]);
    const doc = await client.query<{id:string}>(`INSERT INTO broker_source_documents
      (household_id,broker_id,channel,account_id,sha256,extractor_version,kind,body,status,gaps)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (household_id,broker_id,channel,account_id,sha256,extractor_version) DO NOTHING RETURNING id`,
      [userId,scope.brokerId,scope.channel,scope.accountId,sha256,BROKER_ACTIVITY_EXTRACTOR_VERSION,raw.kind,raw.body,extracted.status,JSON.stringify(extracted.gaps)]);
    let documentId = doc.rows[0]?.id;
    if (documentId) {
      await client.query(`INSERT INTO broker_source_records
        (household_id,document_id,path,parent_path,source_id,category,instrument,data)
        SELECT $1::uuid,$2::uuid,r.path,r."parentPath",r."sourceId",r.category,r.instrument,r.data
        FROM jsonb_to_recordset($3::jsonb) AS r(path text,"parentPath" text,"sourceId" text,category text,instrument text,data jsonb)`,
        [userId,documentId,JSON.stringify(extracted.records)]);
    } else {
      documentId = (await client.query<{id:string}>(`SELECT id FROM broker_source_documents WHERE
        household_id=$1::uuid AND broker_id=$2 AND channel=$3 AND account_id=$4 AND sha256=$5 AND extractor_version=$6`,
        [userId,scope.brokerId,scope.channel,scope.accountId,sha256,BROKER_ACTIVITY_EXTRACTOR_VERSION])).rows[0]?.id;
      if (!documentId) throw new Error('Broker activity document disappeared during capture.');
    }
    await client.query(`INSERT INTO broker_source_receipts (household_id,document_id,source_ref)
      VALUES ($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING`, [userId,documentId,sourceRef]);
    return {documentId,sha256,status:extracted.status,records:extracted.records.length,gaps:extracted.gaps};
  });
}

/** Legacy installations without books retain their existing filesystem archive.
 * Configured database installations fail the sync on capture failure, allowing
 * the existing durable retry to replay it before any snapshot/checkpoint save.
 */
export async function captureFetchedBrokerActivity(userId: string, scope: BrokerActivityScope, raw: BrokerRawPayload, sourceRef: string): Promise<void> {
  if (!isBooksEnabled()) return;
  await captureBrokerActivity(userId,scope,raw,sourceRef);
  for (const [index,attachment] of (raw.historyAttachments ?? []).entries()) {
    await captureBrokerActivity(userId,scope,attachment,`${sourceRef}:history:${index}`);
  }
}
