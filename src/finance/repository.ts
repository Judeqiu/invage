import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type FinanceRole = 'viewer' | 'editor' | 'manager';
export type FinanceOrgKind = 'family' | 'entity' | 'trust' | 'other';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const canWrite = new Set<FinanceRole>(['editor', 'manager']);

function uuid(value: string, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} must be a UUID`);
  return value.toLowerCase();
}

function currency(value: string): string {
  const normalized = value?.trim().toUpperCase();
  if (!CURRENCY.test(normalized)) throw new Error('Currency must be a three-letter code');
  return normalized;
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Finance transaction and rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

export interface FinanceScope {
  readonly orgId: string;
  readonly actorUserId: string;
  readonly role: FinanceRole;
  readonly client: PoolClient;
}

/** Authorization and RLS scope are bound to the same database transaction. */
export async function withFinanceScope<T>(
  pool: Pool,
  actorUserId: string,
  orgId: string,
  required: 'read' | 'write' | 'manage',
  work: (scope: FinanceScope) => Promise<T>,
): Promise<T> {
  const actor = uuid(actorUserId, 'Actor user ID');
  const org = uuid(orgId, 'Organization ID');
  return transaction(pool, async client => {
    if (required !== 'read') {
      const user = await client.query(
        'SELECT id FROM utarus.users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [actor],
      );
      if (!user.rowCount) throw new Error('Finance access denied');
    }
    const membership = await client.query(
      `SELECT 1 FROM utarus.org_memberships membership
       JOIN utarus.users users ON users.id=membership.user_id
       WHERE membership.org_id=$1 AND membership.user_id=$2 AND users.deleted_at IS NULL
       FOR SHARE OF membership`,
      [org, actor],
    );
    if (!membership.rowCount) throw new Error('Finance access denied');
    await client.query("SELECT set_config('app.finance_org_id', $1, true)", [org]);
    const access = await client.query<{ role: FinanceRole }>(
      `SELECT role FROM finance.access_grants
       WHERE org_id=$1 AND user_id=$2 FOR SHARE`,
      [org, actor],
    );
    const role = access.rows[0]?.role;
    if (!role || (required === 'write' && !canWrite.has(role)) || (required === 'manage' && role !== 'manager')) {
      throw new Error('Finance access denied');
    }
    if (required !== 'read') {
      const orgRow = await client.query(
        'SELECT org_id FROM finance.organizations WHERE org_id=$1 FOR UPDATE', [org],
      );
      if (!orgRow.rowCount) throw new Error('Finance organization unavailable');
    }
    return work(Object.freeze({ orgId: org, actorUserId: actor, role, client }));
  });
}

/** Establish a finance container only when the authenticated actor is an org admin. */
export async function initializeFinanceOrg(
  pool: Pool,
  actorUserId: string,
  orgId: string,
  kind: FinanceOrgKind,
  reportingCurrency?: string,
): Promise<void> {
  const actor = uuid(actorUserId, 'Actor user ID');
  const org = uuid(orgId, 'Organization ID');
  if (!['family', 'entity', 'trust', 'other'].includes(kind)) throw new Error('Invalid finance organization kind');
  const ccy = reportingCurrency == null ? null : currency(reportingCurrency);
  await transaction(pool, async client => {
    const membership = await client.query<{ role: string }>(
      `SELECT role FROM utarus.org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,
      [org, actor],
    );
    if (membership.rows[0]?.role !== 'admin') throw new Error('Organization admin required');
    await client.query("SELECT set_config('app.finance_org_id', $1, true)", [org]);
    const existing = await client.query<{ kind: string; reporting_currency: string | null }>(
      'SELECT kind, reporting_currency FROM finance.organizations WHERE org_id=$1 FOR UPDATE', [org],
    );
    if (existing.rowCount) {
      if (existing.rows[0].kind !== kind || existing.rows[0].reporting_currency !== ccy) {
        throw new Error('Finance organization already exists with different settings');
      }
      const manager = await client.query<{ role: FinanceRole }>(
        'SELECT role FROM finance.access_grants WHERE org_id=$1 AND user_id=$2',
        [org, actor],
      );
      if (manager.rows[0]?.role !== 'manager') throw new Error('Finance access denied');
      return;
    } else {
      await client.query(
        'INSERT INTO finance.organizations(org_id,kind,reporting_currency) VALUES($1,$2,$3)',
        [org, kind, ccy],
      );
    }
    await client.query(
      `INSERT INTO finance.access_grants(org_id,user_id,role,granted_by)
       VALUES($1,$2,'manager',$2)
       ON CONFLICT (org_id,user_id) DO NOTHING`,
      [org, actor],
    );
  });
}

export async function grantFinanceAccess(
  scope: FinanceScope,
  memberUserId: string,
  role: FinanceRole,
): Promise<void> {
  if (scope.role !== 'manager') throw new Error('Finance manager required');
  const member = uuid(memberUserId, 'Member user ID');
  if (!['viewer', 'editor', 'manager'].includes(role)) throw new Error('Invalid finance role');
  const membership = await scope.client.query(
    'SELECT 1 FROM utarus.org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
    [scope.orgId, member],
  );
  if (!membership.rowCount) throw new Error('User is not an organization member');
  await scope.client.query(
    `INSERT INTO finance.access_grants(org_id,user_id,role,granted_by)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (org_id,user_id) DO UPDATE SET role=EXCLUDED.role,
       granted_by=EXCLUDED.granted_by, granted_at=now()`,
    [scope.orgId, member, role, scope.actorUserId],
  );
}

export async function createFinanceAccount(
  scope: FinanceScope,
  input: { connectorId: string; brokerAccountId: string; label?: string },
): Promise<string> {
  if (!canWrite.has(scope.role)) throw new Error('Finance editor required');
  const connector = input.connectorId?.trim();
  const brokerAccount = input.brokerAccountId?.trim();
  if (!connector || !brokerAccount) throw new Error('Connector and broker account IDs are required');
  const id = randomUUID();
  const result = await scope.client.query<{ id: string }>(
    `INSERT INTO finance.accounts(id,org_id,connector_id,broker_account_id,label)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (org_id,connector_id,broker_account_id)
     DO UPDATE SET label=COALESCE(EXCLUDED.label,finance.accounts.label)
     RETURNING id`,
    [id, scope.orgId, connector, brokerAccount, input.label?.trim() || null],
  );
  return result.rows[0].id;
}

export async function createFinanceAsset(
  scope: FinanceScope,
  input: { kind: 'equity' | 'fund' | 'option' | 'deposit' | 'property' | 'other'; name: string },
): Promise<string> {
  if (!canWrite.has(scope.role)) throw new Error('Finance editor required');
  const name = input.name?.trim();
  if (!name) throw new Error('Asset name is required');
  const id = randomUUID();
  await scope.client.query(
    'INSERT INTO finance.assets(id,org_id,kind,name) VALUES($1,$2,$3,$4)',
    [id, scope.orgId, input.kind, name],
  );
  return id;
}

export async function listFinanceAssets(scope: FinanceScope): Promise<Array<{
  id: string; kind: string; name: string;
}>> {
  const result = await scope.client.query<{ id: string; kind: string; name: string }>(
    'SELECT id,kind,name FROM finance.assets WHERE org_id=$1 ORDER BY created_at,id',
    [scope.orgId],
  );
  return result.rows;
}
