/** Read-only organization finance view. Actor identity comes from the session. */
import { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadSessionState, type AuthUser } from 'utarus';
import { createSecretCodec, readDatabaseConfig } from 'utarus/database';
import { withFinanceScope } from '../finance/repository.js';

export function createOrgFinanceRouter(): Router {
  const router = Router();
  router.get('/org-finance', async (req: Request, res: Response) => {
    const session = (req as Request & { user?: AuthUser }).user;
    if (!session?.slug) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const pool = new pg.Pool({ ...readDatabaseConfig(process.env), max: 1 });
    try {
      const snapshot = await loadSessionState(req);
      const actorId = snapshot.state.user.id;
      const orgId = snapshot.state.user.org_id;
      if (!orgId) {
        res.status(404).json({ error: 'no_organization' });
        return;
      }
      const data = await withFinanceScope(pool, actorId, orgId, 'read', async ({ client, orgId }) => {
        const organization = await client.query(
          'SELECT org_id,kind,reporting_currency FROM finance.organizations WHERE org_id=$1', [orgId],
        );
        const accounts = await client.query(
          `SELECT id,connector_id,broker_account_id,label,legacy_user_id
           FROM finance.accounts WHERE org_id=$1 AND active ORDER BY connector_id,label,id`, [orgId],
        );
        const assets = await client.query(
          `SELECT id,kind,name,legacy_user_id,legacy_key FROM finance.assets
           WHERE org_id=$1 AND active ORDER BY kind,name,id`, [orgId],
        );
        const positions = await client.query(
          `SELECT account_id,asset_id,broker_lot_id,quantity::text,
           unit_cost::text,cost_currency,as_of FROM finance.positions
           WHERE org_id=$1 ORDER BY account_id,asset_id`, [orgId],
        );
        const cash = await client.query(
          `SELECT account_id,currency,amount::text,settled_amount::text,
           accrued_interest::text,as_of FROM finance.cash_balances
           WHERE org_id=$1 ORDER BY account_id,currency`, [orgId],
        );
        const deposits = await client.query(
          `SELECT asset_id,account_id,principal::text,currency,interest_at_maturity::text,
           start_date,maturity_date FROM finance.deposits WHERE org_id=$1 ORDER BY asset_id`, [orgId],
        );
        const properties = await client.query(
          `SELECT asset_id,address_label FROM finance.properties WHERE org_id=$1 ORDER BY asset_id`, [orgId],
        );
        const liabilities = await client.query(
          `SELECT id,kind,label,principal::text,currency,secured_asset_id
           FROM finance.liabilities WHERE org_id=$1 ORDER BY id`, [orgId],
        );
        const valuations = await client.query(
          `SELECT asset_id,amount::text,currency,observed_at,source
           FROM finance.valuations WHERE org_id=$1 ORDER BY asset_id,observed_at DESC`, [orgId],
        );
        const sources = await client.query(
          `SELECT id,source_user_id,account_id,connector_id,source_kind,raw_id,
            sha256,byte_count::text,modified_at,archived_at
           FROM finance.source_files WHERE org_id=$1 ORDER BY modified_at DESC,id`, [orgId],
        );
        const importStatus = await client.query<{
          imported_at: Date | null; sources: string; changed_sources: string; active_members: string;
        }>(
          `SELECT max(migration.imported_at) AS imported_at,
             count(*)::text AS sources,
             count(*) FILTER (WHERE users.revision <> migration.source_revision)::text AS changed_sources,
             (SELECT count(*)::text FROM utarus.org_memberships membership
              JOIN utarus.users member ON member.id=membership.user_id
              WHERE membership.org_id=$1 AND member.deleted_at IS NULL) AS active_members
           FROM finance.legacy_migrations migration
           JOIN utarus.users users ON users.id=migration.source_user_id
           WHERE migration.org_id=$1`, [orgId],
        );
        const status = importStatus.rows[0];
        return {
          organization: organization.rows[0] ?? null,
          importedAt: status?.imported_at ?? null,
          current: !!status && Number(status.sources) > 0 &&
            Number(status.changed_sources) === 0 && Number(status.sources) === Number(status.active_members),
          accounts: accounts.rows, assets: assets.rows, positions: positions.rows,
          cash: cash.rows, deposits: deposits.rows, properties: properties.rows,
          liabilities: liabilities.rows, valuations: valuations.rows, sources: sources.rows,
        };
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Finance access denied') res.status(403).json({ error: 'finance_access_denied' });
      else if (/relation "finance\./.test(message)) res.status(503).json({ error: 'finance_schema_unavailable' });
      else res.status(500).json({ error: 'org_finance_failed' });
    } finally {
      await pool.end();
    }
  });
  router.get('/org-finance/source-files/:id', async (req: Request, res: Response) => {
    const session = (req as Request & { user?: AuthUser }).user;
    if (!session?.slug) { res.status(401).json({ error: 'unauthorized' }); return; }
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ error: 'invalid_source_id' }); return;
    }
    const pool = new pg.Pool({ ...readDatabaseConfig(process.env), max: 1 });
    try {
      const snapshot = await loadSessionState(req);
      const orgId = snapshot.state.user.org_id;
      if (!orgId) { res.status(404).json({ error: 'no_organization' }); return; }
      const source = await withFinanceScope(pool, snapshot.state.user.id, orgId, 'read',
        async ({ client }) => {
          const result = await client.query<{
            id: string; raw_id: string; sha256: string; byte_count: string;
            encrypted_content: Record<string, unknown>;
          }>(
            `SELECT id,raw_id,sha256,byte_count::text,encrypted_content
             FROM finance.source_files WHERE org_id=$1 AND id=$2`, [orgId, id],
          );
          return result.rows[0] ?? null;
        });
      if (!source) { res.status(404).json({ error: 'source_not_found' }); return; }
      const codec = createSecretCodec({
        keyId: process.env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
        keyBase64: process.env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '',
      });
      const bytes = Buffer.from(codec.decrypt(source.encrypted_content,
        JSON.stringify([orgId, source.id, 'broker_source_file'])), 'base64');
      if (bytes.length !== Number(source.byte_count) ||
          createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
        throw new Error('Archived source integrity check failed');
      }
      const filename = source.raw_id.split('/').at(-1)!.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', filename.endsWith('.xml') ? 'application/xml' :
        filename.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(message === 'Finance access denied' ? 403 : 500)
        .json({ error: message === 'Finance access denied' ? 'finance_access_denied' : 'source_read_failed' });
    } finally {
      await pool.end();
    }
  });
  return router;
}
