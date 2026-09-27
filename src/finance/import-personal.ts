/**
 * Explicit, lossless-staging import of all financial records of one Utarus org.
 * Defaults to dry run. Apply is a single SQL transaction and leaves personal
 * source records intact until org-scoped product reads/writes are activated.
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { createDatabasePool, createSecretCodec, openDatabaseRuntime, readDatabaseConfig } from 'utarus/database';
import { syncUserSourceFiles } from './source-files.js';
import { getCashes, getDeposits, getPortfolio, type InvestorState } from '../state/portfolio-state.js';
import {
  getCashFlows, getLiabilities, getProperties,
  type HouseholdInvestorState,
} from '../state/household-state.js';

export type Source = { state: InvestorState; revision: number };
type OrgMember = { id: string; slug: string; role: string };
type CountKey = 'holdings' | 'cash' | 'deposits' | 'properties' | 'property_payments' |
  'liabilities' | 'cash_flows' | 'option_executions';
type Counts = Record<CountKey, number>;

const emptyCounts = (): Counts => ({ holdings: 0, cash: 0, deposits: 0, properties: 0,
  property_payments: 0, liabilities: 0, cash_flows: 0, option_executions: 0 });

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

export function sourceHash(state: InvestorState): string {
  const hh = state as HouseholdInvestorState;
  const financial = {
    portfolio: state.portfolio, cash: state.cash, deposits: state.deposits,
    playbook: state.playbook,
    properties: hh.properties, liabilities: hh.liabilities, cash_flows: hh.cash_flows,
    treasury: hh.treasury, projection_assumptions: hh.projection_assumptions,
    scenarios: hh.scenarios, option_executions: state.option_executions,
    broker_connections: state.broker_connections,
  };
  return createHash('sha256').update(JSON.stringify(canonicalJson(financial))).digest('hex');
}

export function counts(state: InvestorState): Counts {
  const hh = state as HouseholdInvestorState;
  const properties = getProperties(hh);
  return {
    holdings: Object.keys(getPortfolio(state)).length,
    cash: getCashes(state).length,
    deposits: getDeposits(state).length,
    properties: properties.length,
    property_payments: properties.reduce((n, p) => n + (p.payments?.length ?? 0), 0),
    liabilities: getLiabilities(hh).length,
    cash_flows: getCashFlows(hh).length,
    option_executions: state.option_executions?.length ?? 0,
  };
}

export function hasFinancialData(state: InvestorState): boolean {
  const hh = state as HouseholdInvestorState;
  return Object.values(counts(state)).some(value => value > 0) ||
    Object.keys(state.broker_connections ?? {}).length > 0 ||
    hh.treasury !== undefined || hh.projection_assumptions !== undefined ||
    hh.scenarios !== undefined;
}

function sumCounts(rows: Counts[]): Counts {
  const total = emptyCounts();
  for (const row of rows) for (const key of Object.keys(total) as CountKey[]) total[key] += row[key];
  return total;
}

export function plannedAccounts(state: InvestorState): Array<{
  channel: string; connector: string; nativeId: string; synthetic: boolean;
}> {
  const channels = new Set<string>();
  for (const holding of Object.values(getPortfolio(state))) channels.add(holding.channel?.trim() || '');
  for (const cash of getCashes(state)) channels.add(cash.channel?.trim() || '');
  for (const deposit of getDeposits(state)) channels.add(deposit.channel?.trim() || '');
  for (const execution of state.option_executions ?? []) channels.add(execution.channel);
  for (const channel of Object.keys(state.broker_connections ?? {})) channels.add(channel);
  const result = [];
  for (const channel of [...channels].sort()) {
    const connection = state.broker_connections?.[channel];
    const native = connection?.last_sync?.account_id?.trim();
    result.push({
      channel,
      connector: channel || 'manual',
      nativeId: native || `legacy:${state.user.id}:${channel || 'unassigned'}`,
      synthetic: !native,
    });
  }
  for (const execution of state.option_executions ?? []) {
    if (result.some(a => a.channel === execution.channel && a.nativeId === execution.account_id)) continue;
    result.push({ channel: execution.channel, connector: execution.channel,
      nativeId: execution.account_id, synthetic: false });
  }
  return result;
}

export interface FinanceImportReport {
  orgId: string;
  orgSlug: string;
  memberCount: number;
  accounts: number;
  counts: Counts;
  duplicateNativeAccounts: Array<{ connector: string; nativeId: string; sourceUsers: string[] }>;
  mode: 'dry-run' | 'applied' | 'already-applied';
}

export async function writeAccounts(
  client: PoolClient, orgId: string, state: InvestorState,
  codec: ReturnType<typeof createSecretCodec>,
): Promise<Map<string, string>> {
  const accounts = new Map<string, string>();
  for (const account of plannedAccounts(state)) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO finance.accounts(id,org_id,connector_id,broker_account_id,label,legacy_user_id)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id,connector_id,broker_account_id)
       DO UPDATE SET active=true,label=EXCLUDED.label
       WHERE finance.accounts.legacy_user_id=EXCLUDED.legacy_user_id
       RETURNING id`,
      [randomUUID(), orgId, account.connector, account.nativeId,
        `${state.user.slug} / ${account.channel || 'unassigned'}`, state.user.id],
    );
    if (inserted.rowCount !== 1) throw new Error(`Broker account belongs to a different source user: ${account.connector}`);
    const id = inserted.rows[0].id;
    if (!accounts.has(account.channel)) accounts.set(account.channel, id);
    accounts.set(`${account.channel}\0${account.nativeId}`, id);
    const connection = state.broker_connections?.[account.channel];
    if (connection && accounts.get(account.channel) === id) {
      const encrypted = codec.encrypt(
        JSON.stringify(connection.credentials),
        JSON.stringify([orgId, id, 'broker_credentials']),
      );
      await client.query(
      `INSERT INTO finance.account_credentials(org_id,account_id,encrypted_credentials,
         enabled,last_sync,metrics,source_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (org_id,account_id) DO UPDATE SET
           encrypted_credentials=EXCLUDED.encrypted_credentials,
           enabled=EXCLUDED.enabled,last_sync=EXCLUDED.last_sync,metrics=EXCLUDED.metrics`,
        [orgId, id, encrypted, connection.enabled, connection.last_sync ?? null,
          connection.metrics ?? null, state.user.id],
      );
    }
  }
  return accounts;
}

export async function writeSource(
  client: PoolClient, orgId: string, source: Source, accountByChannel: Map<string, string>,
): Promise<void> {
  const state = source.state;
  const userId = state.user.id;
  const hh = state as HouseholdInvestorState;
  const propertyIds = new Map<string, string>();
  for (const [key, holding] of Object.entries(getPortfolio(state))) {
    const assetId = randomUUID();
    const channel = holding.channel?.trim() || '';
    const accountId = accountByChannel.get(channel);
    if (!accountId) throw new Error(`Missing account for holding ${key}`);
    const kind = holding.instrument || 'equity';
    const asset = await client.query<{ id: string }>(
      `INSERT INTO finance.assets(id,org_id,kind,name,details,legacy_user_id,legacy_key)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (org_id,legacy_user_id,legacy_key)
       DO UPDATE SET kind=EXCLUDED.kind,name=EXCLUDED.name,details=EXCLUDED.details,active=true
       RETURNING id`,
      [assetId, orgId, kind, key, holding, userId, `holding:${key}`],
    );
    await client.query(
      `INSERT INTO finance.positions(org_id,account_id,asset_id,broker_lot_id,quantity,
       unit_cost,cost_currency,details,as_of) VALUES($1,$2,$3,$4,$5,NULL,NULL,$6,now())`,
      [orgId, accountId, asset.rows[0].id, key, String(holding.units), holding],
    );
  }
  for (const cash of getCashes(state)) {
    const accountId = accountByChannel.get(cash.channel?.trim() || '');
    if (!accountId) throw new Error(`Missing account for cash ${cash.currency}`);
    await client.query(
      `INSERT INTO finance.cash_balances(org_id,account_id,currency,amount,settled_amount,
       accrued_interest,as_of) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, accountId, cash.currency, String(cash.amount),
        cash.settled_amount == null ? null : String(cash.settled_amount),
        cash.accrued_interest == null ? null : String(cash.accrued_interest),
        `${cash.updated_at}T00:00:00Z`],
    );
  }
  for (const deposit of getDeposits(state)) {
    const accountId = accountByChannel.get(deposit.channel?.trim() || '');
    if (!accountId) throw new Error(`Missing account for deposit ${deposit.id}`);
    const assetId = randomUUID();
    const asset = await client.query<{ id: string }>(
      `INSERT INTO finance.assets(id,org_id,kind,name,details,legacy_user_id,legacy_key)
       VALUES($1,$2,'deposit',$3,$4,$5,$6)
       ON CONFLICT (org_id,legacy_user_id,legacy_key)
       DO UPDATE SET name=EXCLUDED.name,details=EXCLUDED.details,active=true
       RETURNING id`,
      [assetId, orgId, deposit.label || deposit.id, deposit, userId, `deposit:${deposit.id}`],
    );
    await client.query(
      `INSERT INTO finance.deposits(asset_id,org_id,account_id,principal,currency,
       interest_at_maturity,start_date,maturity_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [asset.rows[0].id, orgId, accountId, String(deposit.amount), deposit.currency,
        String(deposit.interest), deposit.start_date, deposit.end_date],
    );
  }
  for (const property of getProperties(hh)) {
    const assetId = randomUUID();
    const asset = await client.query<{ id: string }>(
      `INSERT INTO finance.assets(id,org_id,kind,name,details,legacy_user_id,legacy_key)
       VALUES($1,$2,'property',$3,$4,$5,$6)
       ON CONFLICT (org_id,legacy_user_id,legacy_key)
       DO UPDATE SET name=EXCLUDED.name,details=EXCLUDED.details,active=true
       RETURNING id`,
      [assetId, orgId, property.label || property.id, property, userId, `property:${property.id}`],
    );
    propertyIds.set(property.id, asset.rows[0].id);
    await client.query(
      'INSERT INTO finance.properties(asset_id,org_id,address_label) VALUES($1,$2,$3)',
      [asset.rows[0].id, orgId, property.label || null],
    );
    await client.query(
      `INSERT INTO finance.valuations(id,org_id,asset_id,amount,currency,observed_at,source)
       VALUES($1,$2,$3,$4,$5,$6,'legacy_user_record')`,
      [randomUUID(), orgId, asset.rows[0].id, String(property.value), property.currency,
        `${property.updated_at}T00:00:00Z`],
    );
    for (const payment of property.payments ?? []) {
      await client.query(
        `INSERT INTO finance.property_payments(id,org_id,property_asset_id,paid_on,amount,currency,label)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), orgId, asset.rows[0].id, payment.date, String(payment.amount), property.currency,
          payment.label || null],
      );
    }
  }
  for (const liability of getLiabilities(hh)) {
    await client.query(
      `INSERT INTO finance.liabilities(id,org_id,kind,label,principal,currency,secured_asset_id,
       details,legacy_user_id,legacy_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [randomUUID(), orgId, liability.kind, liability.label || null, String(liability.principal),
        liability.currency, liability.property_id ? propertyIds.get(liability.property_id) ?? null : null,
        liability, userId, liability.id],
    );
  }
  for (const flow of getCashFlows(hh)) {
    await client.query(
      `INSERT INTO finance.cash_flows(id,org_id,kind,amount,currency,frequency,
       start_date,end_date,label,details,legacy_user_id,legacy_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), orgId, flow.kind, String(flow.amount), flow.currency, flow.frequency,
        flow.start_date, flow.end_date || null, flow.label || null, flow, userId, flow.id],
    );
  }
  await client.query(
    'INSERT INTO finance.planning_profiles(org_id,source_user_id,data) VALUES($1,$2,$3)',
    [orgId, userId, {
      ...(hh.treasury == null ? {} : { treasury: hh.treasury }),
      ...(hh.projection_assumptions == null ? {} : { projection_assumptions: hh.projection_assumptions }),
      ...(hh.scenarios == null ? {} : { scenarios: hh.scenarios }),
      ...(state.playbook == null ? {} : { playbook: state.playbook }),
    }],
  );
  for (const execution of state.option_executions ?? []) {
    const accountId = accountByChannel.get(`${execution.channel}\0${execution.account_id}`) ??
      accountByChannel.get(execution.channel);
    if (!accountId) throw new Error(`Missing account for execution ${execution.execution_id}`);
    const inserted = await client.query(
      `INSERT INTO finance.option_executions(org_id,account_id,execution_id,payload,source_user_id)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (org_id,account_id,execution_id)
       DO UPDATE SET payload=EXCLUDED.payload
       WHERE finance.option_executions.payload=EXCLUDED.payload
       RETURNING execution_id`,
      [orgId, accountId, execution.execution_id, execution, userId],
    );
    if (inserted.rowCount !== 1) throw new Error(`Conflicting option execution ${execution.execution_id}`);
  }
  await client.query(
    `INSERT INTO finance.legacy_migrations(org_id,source_user_id,source_revision,source_sha256,counts)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (org_id,source_user_id) DO UPDATE SET
       source_revision=EXCLUDED.source_revision,source_sha256=EXCLUDED.source_sha256,
       counts=EXCLUDED.counts,imported_at=now()`,
    [orgId, userId, source.revision, sourceHash(state), counts(state)],
  );
}

/** Apply only to the exact current membership roster of the named organization. */
export async function importPersonalFinanceToOrg(
  orgSlug: string,
  apply = false,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FinanceImportReport> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(orgSlug)) throw new Error('Explicit organization slug required');
  const codec = createSecretCodec({
    keyId: env.UTARUS_DATABASE_ENCRYPTION_KEY_ID ?? '',
    keyBase64: env.UTARUS_DATABASE_ENCRYPTION_KEY ?? '',
  });
  const runtime = await openDatabaseRuntime({ env, mode: 'org', onError: error => { throw error; } });
  const pool = createDatabasePool(readDatabaseConfig(env), error => { throw error; });
  try {
    const orgResult = await pool.query<{ id: string }>('SELECT id FROM utarus.orgs WHERE slug=$1', [orgSlug]);
    if (orgResult.rowCount !== 1) throw new Error('Organization not found');
    const orgId = orgResult.rows[0].id;
    const membersResult = await pool.query<OrgMember>(
      `SELECT users.id,users.slug,membership.role FROM utarus.org_memberships membership
       JOIN utarus.users users ON users.id=membership.user_id
       WHERE membership.org_id=$1 AND users.deleted_at IS NULL ORDER BY users.slug`,
      [orgId],
    );
    const members = membersResult.rows;
    if (!members.length) throw new Error('Organization has no active members');
    const outsiders = await pool.query<{ slug: string }>(
      `SELECT users.slug FROM utarus.users users
       WHERE users.deleted_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM utarus.org_memberships membership
         WHERE membership.user_id=users.id AND membership.org_id=$1
       ) ORDER BY users.slug`, [orgId],
    );
    for (const outsider of outsiders.rows) {
      const other = await runtime.users.findBySlug(outsider.slug);
      if (!other || hasFinancialData(other.state as InvestorState)) {
        throw new Error(`Active user outside ${orgSlug} has financial data or could not be read: ${outsider.slug}`);
      }
    }
    const sources = new Map<string, Source>();
    for (const member of members) {
      const source = await runtime.users.findBySlug(member.slug);
      if (!source || source.state.user.id !== member.id || source.state.user.org_id !== orgId) {
        throw new Error(`Membership/state mismatch for ${member.slug}`);
      }
      sources.set(member.id, source as Source);
    }
    const accountPlans = members.flatMap(member => plannedAccounts(sources.get(member.id)!.state)
      .map(account => ({ ...account, sourceUserId: member.id, sourceSlug: member.slug })));
    const native = new Map<string, Set<string>>();
    for (const account of accountPlans.filter(row => !row.synthetic)) {
      const key = JSON.stringify([account.connector, account.nativeId]);
      const users = native.get(key) ?? new Set<string>();
      users.add(account.sourceSlug);
      native.set(key, users);
    }
    const duplicateNativeAccounts = [...native.entries()].filter(([, users]) => users.size > 1)
      .map(([key, users]) => { const [connector, nativeId] = JSON.parse(key) as [string, string];
        return { connector, nativeId, sourceUsers: [...users].sort() }; });
    const reportBase = {
      orgId, orgSlug, memberCount: members.length, accounts: accountPlans.length,
      counts: sumCounts([...sources.values()].map(source => counts(source.state))),
      duplicateNativeAccounts,
    };
    if (!apply) return { ...reportBase, mode: 'dry-run' };
    if (duplicateNativeAccounts.length) throw new Error('Duplicate native brokerage accounts require explicit reconciliation');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM utarus.orgs WHERE id=$1 FOR SHARE', [orgId]);
      const locked = await client.query<{ id: string; revision: string }>(
        'SELECT id,revision::text FROM utarus.users WHERE id=ANY($1::uuid[]) FOR SHARE',
        [members.map(member => member.id)],
      );
      if (locked.rowCount !== members.length || locked.rows.some(row =>
        Number(row.revision) !== sources.get(row.id)?.revision)) {
        throw new Error('Source user state changed during migration');
      }
      const liveMemberships = await client.query<{ user_id: string }>(
        'SELECT user_id FROM utarus.org_memberships WHERE org_id=$1 FOR SHARE', [orgId],
      );
      if (liveMemberships.rowCount !== members.length || liveMemberships.rows.some(row => !sources.has(row.user_id))) {
        throw new Error('Organization membership changed during migration');
      }
      await client.query("SELECT set_config('app.finance_org_id',$1,true)", [orgId]);
      const prior = await client.query<{ source_user_id: string; source_sha256: string }>(
        'SELECT source_user_id,source_sha256 FROM finance.legacy_migrations WHERE org_id=$1', [orgId],
      );
      if (prior.rowCount) {
        if (prior.rowCount !== members.length || prior.rows.some(row =>
          sourceHash(sources.get(row.source_user_id)!.state) !== row.source_sha256)) {
          throw new Error('Existing finance import differs from current source');
        }
        await client.query('COMMIT');
        return { ...reportBase, mode: 'already-applied' };
      }
      const admin = members.filter(member => member.role === 'admin');
      if (!admin.length) throw new Error('Organization has no admin for initial finance grant');
      await client.query(
        `INSERT INTO finance.organizations(org_id,kind) VALUES($1,'family')
         ON CONFLICT (org_id) DO NOTHING`, [orgId],
      );
      const orgKind = await client.query<{ kind: string }>(
        'SELECT kind FROM finance.organizations WHERE org_id=$1', [orgId],
      );
      if (orgKind.rows[0]?.kind !== 'family') throw new Error('qiu finance organization must be a family container');
      for (const member of members) {
        await client.query(
          `INSERT INTO finance.access_grants(org_id,user_id,role,granted_by)
           VALUES($1,$2,$3,$4) ON CONFLICT (org_id,user_id) DO NOTHING`,
          [orgId, member.id, member.role === 'admin' ? 'manager' : 'editor', admin[0].id],
        );
      }
      for (const member of members) {
        const state = sources.get(member.id)!.state;
        const accounts = await writeAccounts(client, orgId, state, codec);
        await writeSource(client, orgId, sources.get(member.id)!, accounts);
        await syncUserSourceFiles(client, orgId, member.id, member.slug, codec);
      }
      const actual = await client.query<{
        accounts: string; holdings: string; cash: string; deposits: string;
        properties: string; property_payments: string; liabilities: string;
        cash_flows: string; option_executions: string; planning_profiles: string;
      }>(
        `SELECT
         (SELECT count(*)::text FROM finance.accounts WHERE org_id=$1) AS accounts,
         (SELECT count(*)::text FROM finance.positions WHERE org_id=$1) AS holdings,
         (SELECT count(*)::text FROM finance.cash_balances WHERE org_id=$1) AS cash,
         (SELECT count(*)::text FROM finance.deposits WHERE org_id=$1) AS deposits,
         (SELECT count(*)::text FROM finance.properties WHERE org_id=$1) AS properties,
         (SELECT count(*)::text FROM finance.property_payments WHERE org_id=$1) AS property_payments,
         (SELECT count(*)::text FROM finance.liabilities WHERE org_id=$1) AS liabilities,
         (SELECT count(*)::text FROM finance.cash_flows WHERE org_id=$1) AS cash_flows,
         (SELECT count(*)::text FROM finance.option_executions WHERE org_id=$1) AS option_executions,
         (SELECT count(*)::text FROM finance.planning_profiles WHERE org_id=$1) AS planning_profiles`,
        [orgId],
      );
      const observed = actual.rows[0];
      if (Number(observed.accounts) !== reportBase.accounts ||
          Number(observed.planning_profiles) !== members.length ||
          (Object.keys(reportBase.counts) as CountKey[]).some(key =>
            Number(observed[key]) !== reportBase.counts[key])) {
        throw new Error('Finance import row counts do not reconcile with source');
      }
      await client.query('COMMIT');
      return { ...reportBase, mode: 'applied' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  } finally {
    await Promise.allSettled([pool.end(), runtime.close()]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [slug, mode] = process.argv.slice(2);
  if (mode !== undefined && mode !== '--apply') throw new Error('Only --apply is accepted after the organization slug');
  importPersonalFinanceToOrg(slug ?? '', mode === '--apply').then(report => {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
