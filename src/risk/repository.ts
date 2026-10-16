import { randomUUID } from 'node:crypto';
import { getPool } from '../books/db.js';
import { digest, RiskError } from './context.js';
import type { RiskAnalysis, RiskInputs, RiskJob, RiskRequest } from './types.js';

export const scopeKey = (r: RiskRequest) => digest([r.accountScope, r.horizonTradingDays, r.scenarioSet, r.mode]);
export class RiskRepository {
  async enqueue(owner: string, request: RiskRequest, inputs: RiskInputs): Promise<RiskJob> {
    const db = await getPool().connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['option-risk:' + owner]);
      const key = digest(inputs), scope = scopeKey(request);
      const found = await db.query(`SELECT id,status,result,error FROM option_risk_jobs WHERE owner_id=$1 AND dedup_key=$2 AND expires_at>now()
        AND (status IN ('queued','running') OR (status='complete' AND $3=false AND created_at>now()-interval '15 minutes')) ORDER BY created_at DESC LIMIT 1`, [owner, key, request.refresh]);
      if (found.rows[0]) { await db.query('COMMIT'); return found.rows[0]; }
      const active = await db.query("SELECT id FROM option_risk_jobs WHERE owner_id=$1 AND status IN ('queued','running')", [owner]);
      if (active.rowCount) throw new RiskError(429, 'An analysis is already in progress for this investor');
      const recent = await db.query("SELECT count(*) FROM option_risk_jobs WHERE owner_id=$1 AND created_at>now()-interval '1 minute'", [owner]);
      if (Number(recent.rows[0].count) >= 3) throw new RiskError(429, 'Please wait before recalculating');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('option-risk-pool'))");
      const capacity = await db.query("SELECT count(*) FROM option_risk_jobs WHERE status IN ('queued','running')");
      if (Number(capacity.rows[0].count) >= 100) throw new RiskError(429, 'Analysis queue is at capacity. Retry later.');
      const id = randomUUID();
      await db.query(`INSERT INTO option_risk_jobs(id,owner_id,context_id,scope_key,dedup_key,status,inputs) VALUES($1,$2,$3,$4,$5,'queued',$6)`, [id, owner, request.analysisContextId, scope, key, JSON.stringify(inputs)]);
      await db.query('COMMIT');
      return { id, status: 'queued' };
    } catch (e) { await db.query('ROLLBACK'); throw e; }
    finally { db.release(); }
  }
  async get(owner: string, id: string): Promise<RiskJob | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const r = await getPool().query('SELECT id,status,result,error FROM option_risk_jobs WHERE owner_id=$1 AND id=$2 AND expires_at>now()', [owner, id]);
    return r.rows[0] ?? null;
  }
  async latest(owner: string, request: RiskRequest): Promise<RiskJob | null> {
    const r = await getPool().query(`SELECT id,status,result,error FROM option_risk_jobs WHERE owner_id=$1 AND context_id=$2 AND scope_key=$3 AND expires_at>now() AND status='complete' ORDER BY created_at DESC LIMIT 1`, [owner, request.analysisContextId, scopeKey(request)]);
    return r.rows[0] ?? null;
  }
  async claim() {
    // Claim and recovery serialize across processes. One deployment-wide worker.
    const db = await getPool().connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT pg_advisory_xact_lock(hashtext('option-risk-pool'))");
      await db.query("DELETE FROM option_risk_jobs WHERE expires_at<=now()");
      await db.query(`UPDATE option_risk_jobs SET status=CASE WHEN attempts<2 THEN 'queued' ELSE 'failed' END,
        error='Worker lease expired',lease_token=NULL WHERE status='running' AND lease_until<now()`);
      const running = await db.query("SELECT id FROM option_risk_jobs WHERE status='running' LIMIT 1");
      if (running.rowCount) { await db.query('COMMIT'); return null; }
      const token = randomUUID();
      const r = await db.query(`UPDATE option_risk_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '15 seconds'
        WHERE id=(SELECT id FROM option_risk_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,owner_id,inputs`, [token]);
      await db.query('COMMIT');
      return r.rows[0] ? { ...r.rows[0], token } as { id: string; owner_id: string; inputs: RiskInputs; token: string } : null;
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }
  async heartbeat(id: string, token: string) {
    await getPool().query("UPDATE option_risk_jobs SET lease_until=now()+interval '15 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'", [id, token]);
  }
  async finish(id: string, token: string, result: RiskAnalysis | null) {
    await getPool().query(`UPDATE option_risk_jobs SET status=$3,result=$4,error=$5,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'`,
      [id, token, result ? 'complete' : 'failed', result ? JSON.stringify(result) : null, result ? null : 'Analysis failed or exceeded its 60-second deadline. Retry with validated inputs.']);
  }
  async pruneExpired() { await getPool().query('DELETE FROM option_risk_jobs WHERE expires_at<=now()'); }
  async cancelQueued() { await getPool().query("UPDATE option_risk_jobs SET status='cancelled' WHERE status='queued'"); }
  async deleteUser(owner: string) { await getPool().query('DELETE FROM option_risk_jobs WHERE owner_id=$1', [owner]); }
}
