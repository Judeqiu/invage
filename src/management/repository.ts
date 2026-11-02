import pg from 'pg';
import { readDatabaseConfig } from '../../node_modules/utarus/dist/database/config.js';

export const MANAGER_ROLE = 'velovest_manager' as const;
export class ManagementError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface ManagementIdentity {
  userId: string; displayName: string; email: string; admin: boolean | null;
  deleted: boolean; manager: boolean;
}

const identityQuery = `SELECT u.id AS "userId", p.display_name AS "displayName", p.contact_email AS email,
  u.admin, (u.deleted_at IS NOT NULL) AS deleted,
  EXISTS(SELECT 1 FROM velovest_management.role_assignments r WHERE r.user_id=u.id AND r.role='velovest_manager') AS manager
  FROM utarus.users u JOIN utarus.user_profiles p ON p.user_id=u.id`;

export class ManagementRepository {
  constructor(readonly pool: pg.Pool) {}
  async identity(userId: string): Promise<ManagementIdentity | null> {
    return (await this.pool.query<ManagementIdentity>(identityQuery + ' WHERE u.id=$1', [userId])).rows[0] ?? null;
  }
  async isManager(userId: string): Promise<boolean> {
    const identity = await this.identity(userId);
    return Boolean(identity && !identity.admin && !identity.deleted && identity.manager);
  }
  async setRole(userId: string, enabled: boolean, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const identity = (await client.query<ManagementIdentity>(identityQuery + ' WHERE u.id=$1 FOR UPDATE OF u', [userId])).rows[0];
      if (!identity) throw new ManagementError('User not found.', 404);
      if (enabled && (identity.admin || identity.deleted)) throw new ManagementError('Assign this role only to an active non-admin account.');
      const changed = enabled
        ? await client.query(`INSERT INTO velovest_management.role_assignments (user_id,role,granted_by)
            VALUES ($1,'velovest_manager',$2) ON CONFLICT (user_id) DO NOTHING`, [userId,actor])
        : await client.query('DELETE FROM velovest_management.role_assignments WHERE user_id=$1', [userId]);
      if (changed.rowCount) await client.query(`INSERT INTO velovest_management.role_events (user_id,role,enabled,actor)
        VALUES ($1,'velovest_manager',$2,$3)`, [userId,enabled,actor]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return this.identity(userId);
  }
  async subscribers(query = '', userId: string | null = null) {
    // Explicit projection: never load credentials, financial books, private logs,
    // connections or arbitrary profile/extension fields into this response.
    const result = await this.pool.query(`SELECT u.id AS "userId",p.display_name AS "displayName",
      p.contact_email AS email,u.created_at::text AS "createdAt",u.reference,u.beta,
      CASE WHEN b.user_id IS NULL THEN NULL ELSE jsonb_build_object(
        'planId',b.data->>'plan_id','status',b.data->>'status','currentPeriodEnd',b.data->>'current_period_end') END AS subscription,
      CASE WHEN a.user_id IS NULL THEN NULL ELSE jsonb_build_object(
        'period',a.state->>'period','periodCredits',a.state->'period_credits','lifetimeCredits',a.state->'lifetime_credits') END AS usage
      FROM utarus.users u JOIN utarus.user_profiles p ON p.user_id=u.id
      LEFT JOIN utarus.billing_states b ON b.user_id=u.id LEFT JOIN utarus.usage_accounts a ON a.user_id=u.id
      WHERE u.deleted_at IS NULL AND u.admin IS DISTINCT FROM true
        AND ($2::uuid IS NULL OR u.id=$2) AND ($1='' OR
          concat_ws(' ',u.id::text,p.display_name,p.contact_email,u.reference) ILIKE '%' || $1 || '%')
      ORDER BY u.created_at DESC,u.id`, [query,userId]);
    return result.rows;
  }
}

let repository: ManagementRepository | undefined;
export function managementRepository() {
  if (!repository) {
    const pool = new pg.Pool({...readDatabaseConfig(process.env),application_name:'velovest-management'});
    pool.on('error', () => console.error('[management database] connection failed'));
    repository = new ManagementRepository(pool);
  }
  return repository;
}
