/** Keep the legacy user view and the organization finance projection atomic. */
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { createSecretCodec } from 'utarus/database';
import type { InvestorState } from '../state/portfolio-state.js';
import { getCashes } from '../state/portfolio-state.js';
import type { HouseholdInvestorState } from '../state/household-state.js';
import { sourceHash, writeAccounts, writeSource } from './import-personal.js';

export async function syncPersonalFinance(
  client: PoolClient,
  orgId: string,
  state: InvestorState,
  nextRevision: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const userId = state.user.id;
  const codec = createSecretCodec({
    keyId: env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
    keyBase64: env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '',
  });
  await client.query(
    `DELETE FROM finance.option_executions WHERE org_id=$1 AND source_user_id=$2`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.account_credentials WHERE org_id=$1 AND source_user_id=$2`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.positions p USING finance.assets a
     WHERE p.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND p.asset_id=a.id`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.cash_balances c USING finance.accounts a
     WHERE c.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND c.account_id=a.id`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.deposits d USING finance.assets a
     WHERE d.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND d.asset_id=a.id`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.property_payments p USING finance.assets a
     WHERE p.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND p.property_asset_id=a.id`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.valuations v USING finance.assets a
     WHERE v.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND v.asset_id=a.id AND v.source='legacy_user_record'`, [orgId, userId],
  );
  await client.query(
    `DELETE FROM finance.properties p USING finance.assets a
     WHERE p.org_id=$1 AND a.org_id=$1 AND a.legacy_user_id=$2
       AND p.asset_id=a.id`, [orgId, userId],
  );
  await client.query('DELETE FROM finance.liabilities WHERE org_id=$1 AND legacy_user_id=$2', [orgId, userId]);
  await client.query('DELETE FROM finance.cash_flows WHERE org_id=$1 AND legacy_user_id=$2', [orgId, userId]);
  await client.query('DELETE FROM finance.planning_profiles WHERE org_id=$1 AND source_user_id=$2', [orgId, userId]);
  await client.query('UPDATE finance.accounts SET active=false WHERE org_id=$1 AND legacy_user_id=$2', [orgId, userId]);
  await client.query('UPDATE finance.assets SET active=false WHERE org_id=$1 AND legacy_user_id=$2', [orgId, userId]);
  const accounts = await writeAccounts(client, orgId, state, codec);
  await writeSource(client, orgId, { state, revision: nextRevision }, accounts);
}

export async function assertFinanceSourceCurrent(
  client: PoolClient, orgId: string, previous: InvestorState,
): Promise<void> {
  const checkpoint = await client.query<{ source_sha256: string }>(
    `SELECT source_sha256 FROM finance.legacy_migrations
     WHERE org_id=$1 AND source_user_id=$2 FOR UPDATE`,
    [orgId, previous.user.id],
  );
  if (checkpoint.rows[0]?.source_sha256 !== sourceHash(previous)) {
    throw new Error('Organization finance differs from the current user state; reconcile before writing');
  }
}

/** Audit the new org-owned snapshot without storing broker credentials in clear text. */
export async function recordFinanceChange(
  client: PoolClient, orgId: string, previous: InvestorState, state: InvestorState,
  sourceRevision: number, previousSha256: string, newSha256: string,
): Promise<void> {
  const household = state as HouseholdInvestorState;
  const before = new Map(getCashes(previous).map(cash =>
    [`${cash.channel ?? ''}\0${cash.currency}`, cash]));
  const after = new Map(getCashes(state).map(cash =>
    [`${cash.channel ?? ''}\0${cash.currency}`, cash]));
  const cashChanges = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(key => {
    const oldCash = before.get(key);
    const newCash = after.get(key);
    const prior = oldCash?.amount ?? 0;
    const current = newCash?.amount ?? 0;
    if (prior === current) return [];
    const cash = newCash ?? oldCash!;
    return [{ channel: cash.channel ?? null, currency: cash.currency,
      prior, current, delta: current - prior }];
  });
  const brokerConnections = Object.fromEntries(Object.entries(state.broker_connections ?? {})
    .map(([channel, connection]) => [channel, {
      enabled: connection.enabled,
      last_sync: connection.last_sync ?? null,
      metrics: connection.metrics ?? null,
      credential_keys: Object.keys(connection.credentials ?? {}).sort(),
    }]));
  const lastAction = state.log.at(-1) as Record<string, unknown> | undefined;
  const actionContext = lastAction ? Object.fromEntries(
    ['action', 'memo', 'contra', 'books_request_id']
      .filter(key => typeof lastAction[key] === 'string')
      .map(key => [key, lastAction[key]]),
  ) : null;
  const snapshot = {
    portfolio: state.portfolio ?? {}, cash: state.cash ?? null, deposits: state.deposits ?? [],
    properties: household.properties ?? [], liabilities: household.liabilities ?? [],
    cash_flows: household.cash_flows ?? [], treasury: household.treasury ?? null,
    projection_assumptions: household.projection_assumptions ?? null,
    scenarios: household.scenarios ?? null, playbook: state.playbook ?? null,
    option_executions: state.option_executions ?? [], broker_connections: brokerConnections,
    cash_changes: cashChanges,
    action_name: lastAction?.action ?? null,
    action_context: actionContext,
  };
  await client.query(
    `INSERT INTO finance.change_events
     (id,org_id,actor_user_id,source_revision,previous_sha256,new_sha256,snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), orgId, state.user.id, sourceRevision, previousSha256, newSha256, snapshot],
  );
}
