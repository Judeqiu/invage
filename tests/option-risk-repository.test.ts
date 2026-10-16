/** Requires the same disposable PostgreSQL test admin database as books tests. */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RiskRepository } from '../src/risk/repository.js';
import type { RiskInputs, RiskRequest } from '../src/risk/types.js';

import { useTestDatabase } from './helpers/database.js';
import { migrateOptionRisk } from '../src/risk/migrate.js';
import { getPool } from '../src/books/db.js';
const enabled = !!process.env.UTARUS_TEST_DATABASE_URL;
if (enabled) await useTestDatabase({ books: true });
describe.skipIf(!enabled)('durable risk queue', () => {
  beforeAll(migrateOptionRisk);
  const repo = new RiskRepository();
  const owner = randomUUID(), other = randomUUID();
  const request: RiskRequest = { analysisContextId: 'a'.repeat(64), accountScope: { kind: 'all', accountIds: [] }, horizonTradingDays: 5,
    scenarioSet: 'equity-options-standard-v1', mode: 'conditional', refresh: false };
  const inputs: RiskInputs = { analysisContextId: request.analysisContextId, portfolioRevision: '1', marketSnapshotId: '1', metadataVersion: '1',
    marketAsOf: null, accountIds: ['ibkr'], horizonTradingDays: 5, contracts: [], accounts: [], coverage: { totalContracts: 0, supportedContracts: 0, totalQuantity: 0, supportedQuantity: 0, exclusions: [] } };
  it('deduplicates concurrent submissions, isolates reads and recovers expired leases', async () => {
    const [a,b] = await Promise.all([repo.enqueue(owner, request, inputs), repo.enqueue(owner, request, inputs)]);
    expect(a.id).toBe(b.id);
    expect(await repo.get(other,a.id)).toBeNull();
    const claim = await repo.claim(); expect(claim?.id).toBe(a.id);
    expect(await repo.freezeInputs(a.id,randomUUID(),inputs)).toBe(false);
    const frozen={...inputs,marketSnapshotId:'collected-market'};
    expect(await repo.freezeInputs(a.id,claim!.token,frozen)).toBe(true);
    expect((await getPool().query('SELECT inputs FROM option_risk_jobs WHERE id=$1',[a.id])).rows[0].inputs.marketSnapshotId).toBe('collected-market');
    expect(await repo.claim()).toBeNull();
    await expect(repo.enqueue(owner, request, { ...inputs, marketSnapshotId: '2' })).rejects.toThrow('already in progress');
    await getPool().query("UPDATE option_risk_jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [a.id]);
    const recovered=await repo.claim(); expect(recovered?.id).toBe(a.id);
    expect(await repo.freezeInputs(a.id,claim!.token,inputs)).toBe(false);
    // An expired worker cannot overwrite the replacement worker's result/status.
    await repo.finish(a.id,claim!.token,null);
    expect((await repo.get(owner,a.id))?.status).toBe('running');
    await repo.finish(a.id,recovered!.token,null);
    expect((await repo.get(owner,a.id))?.status).toBe('failed');
  });
  it('cancels queued jobs, applies retention and deletes a user corpus', async () => {
    const j=await repo.enqueue(other,request,inputs);
    await repo.cancelQueued(); expect((await repo.get(other,j.id))?.status).toBe('cancelled');
    await repo.deleteUser(other); expect(await repo.get(other,j.id)).toBeNull();
    const expired=await repo.enqueue(other,request,inputs);
    await getPool().query("UPDATE option_risk_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
    expect(await repo.get(other,expired.id)).toBeNull();
    await repo.claim();
    const remaining=await getPool().query('SELECT id FROM option_risk_jobs WHERE id=$1',[expired.id]);
    expect(remaining.rowCount).toBe(0);
  });
});
