/** Copy broker evidence from per-user BinDrive into an encrypted org archive. */
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createSecretCodec } from 'utarus/database';
import { fetchRawData, listRawData, type RawFile } from '../raw-data/store.js';

type Codec = ReturnType<typeof createSecretCodec>;
export type BrokerSource = RawFile & { channel: string; source_kind: 'broker-sync' | 'broker-triage' };

export function scanBrokerSources(slug: string): BrokerSource[] {
  const files: BrokerSource[] = [];
  let offset = 0;
  for (;;) {
    const page = listRawData(slug, offset, 100);
    for (const file of page.files) {
      if (file.channel && (file.source_kind === 'broker-sync' || file.source_kind === 'broker-triage')) {
        files.push(file as BrokerSource);
      }
    }
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

export function readBrokerSource(slug: string, file: BrokerSource): { bytes: Buffer; sha256: string } {
  if (file.bytes > 10_000_000) throw new Error(`Broker source exceeds 10 MB: ${file.id}`);
  const chunks: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const page = fetchRawData(slug, file.id, file.version, offset, 65536, 'base64');
    const chunk = Buffer.from(page.content, 'base64');
    if (chunk.length !== page.bytes_read) throw new Error('Broker source read length mismatch');
    chunks.push(chunk);
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== file.bytes) throw new Error('Broker source changed while reading');
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Caller owns transaction and finance RLS scope. Existing paths are immutable. */
export async function syncUserSourceFiles(
  client: PoolClient, orgId: string, userId: string, slug: string, codec: Codec,
): Promise<{ scanned: number; inserted: number }> {
  const sources = scanBrokerSources(slug);
  let inserted = 0;
  for (const file of sources) {
    const { bytes, sha256 } = readBrokerSource(slug, file);
    const existing = await client.query<{ sha256: string; byte_count: string }>(
      `SELECT sha256,byte_count::text FROM finance.source_files
       WHERE org_id=$1 AND source_user_id=$2 AND raw_id=$3`,
      [orgId, userId, file.id],
    );
    if (existing.rowCount) {
      if (existing.rows[0].sha256 !== sha256 || Number(existing.rows[0].byte_count) !== bytes.length) {
        throw new Error(`Previously archived broker source changed: ${slug}/${file.id}`);
      }
      continue;
    }
    const account = await client.query<{ id: string }>(
      `SELECT id FROM finance.accounts WHERE org_id=$1 AND legacy_user_id=$2
       AND connector_id=$3 AND active ORDER BY id`,
      [orgId, userId, file.channel],
    );
    const accountId = account.rowCount === 1 ? account.rows[0].id : null;
    const id = randomUUID();
    const encrypted = codec.encrypt(bytes.toString('base64'),
      JSON.stringify([orgId, id, 'broker_source_file']));
    await client.query(
      `INSERT INTO finance.source_files
       (id,org_id,source_user_id,account_id,connector_id,source_kind,raw_id,
        sha256,byte_count,modified_at,encrypted_content)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, orgId, userId, accountId, file.channel, file.source_kind, file.id,
        sha256, bytes.length, file.modified_at, encrypted],
    );
    inserted += 1;
  }
  return { scanned: sources.length, inserted };
}
